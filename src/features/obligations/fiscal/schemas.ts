/**
 * Purpose: Zod schemas for the fiscal obligation (platform-core §7.2.1): the "Impuestos"
 *   template a person activates, the snapshot of the simulated accounting system (draft
 *   amount per tax and period), settlements, run context, scenarios and the engine output.
 *   Facts and configuration only: nothing here authorizes a payment.
 * Runs in: server and tests (pure, no I/O).
 * Triggered by: fixture-source.ts when loading a scenario; the fiscal engine for types.
 * Receives → Returns: unknown JSON → parsed, typed fiscal data (or a ZodError).
 * Talks to: the shared primitives in @/shared/schemas/invoice-context (imported, not changed).
 */
import { z } from "zod";
import {
  AmountMinorSchema,
  CalendarDateSchema,
  CurrencyCodeSchema,
  EntityIdSchema,
  UtcInstantSchema,
} from "@/shared/schemas/invoice-context";

// Mismos valores que el PR #58 (obligation-config.ts), para alinear sin renombrar.
// retencion_fuente | iva | ica | aportes_seguridad_social | aportes_parafiscales
export const FiscalTypeSchema = z.enum(["withholding", "vat", "ica", "social_security", "parafiscal"]);

// borrador | activa | pausada
export const FiscalTemplateStatusSchema = z.enum(["draft", "active", "paused"]);

// fixture = dato de demo, se etiqueta como tal en la UI y los logs (CLAUDE.md §6.14).
export const DataOriginSchema = z.literal("fixture");

// Mismos códigos que el PR #58 + los de main que reutiliza el flujo fiscal.
export const FiscalReasonCodeSchema = z.enum([
  "AUTO_APPROVAL_RULES_PASSED",
  "HUMAN_APPROVAL_REQUIRED",
  "INSUFFICIENT_DATA",
  "BENEFICIARY_CHANGED",
  "OBLIGATION_NOT_AUTHORIZED",
  "STALE_EVIDENCE",
  "SETTLEMENT_UNCONFIRMED",
  "SETTLEMENT_AMOUNT_MISMATCH",
  "VARIANCE_EXCEEDED",
  "DUPLICATE_LINE",
  "DEADLINE_PASSED",
  "DEADLINE_AT_RISK",
  "FUNDS_INSUFFICIENT",
  // Nuevo (no está en el PR #58): el total supera la provisión que fijó la organización.
  "PROVISION_EXCEEDED",
]);

export const FiscalOutcomeSchema = z.enum(["approved", "requires_approval", "blocked"]);

// La referencia de pago va enmascarada: lleva al menos un asterisco, nunca la cuenta completa.
export const MaskedReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/\*/, "La referencia de pago debe ir enmascarada");

const PositiveAmountMinorSchema = z.int().positive();

// ---------------------------------------------------------------------------
// Plantilla "Impuestos": reglas de control que fija la organización (no tributarias)
// ---------------------------------------------------------------------------

export const FiscalTemplateTaxSchema = z.strictObject({
  fiscalType: FiscalTypeSchema,
  authorizedPaymentReference: MaskedReferenceSchema,
});

export const FiscalTemplateSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    obligationId: EntityIdSchema,
    organizationId: EntityIdSchema,
    version: z.int().positive(),
    status: FiscalTemplateStatusSchema,
    activatedBy: EntityIdSchema.nullable(),
    activatedAt: UtcInstantSchema.nullable(),
    currency: CurrencyCodeSchema,
    taxes: z.array(FiscalTemplateTaxSchema).min(1),
    varianceToleranceBps: z.int().nonnegative().max(10_000), // 1000 = 10 %
    runCapMinor: PositiveAmountMinorSchema,
    // Provisión de la organización: "reservar X % de los ingresos para impuestos". Plan de caja,
    // no cálculo tributario: solo dimensiona la reserva y puede escalar, nunca fija el monto a pagar.
    // null = la organización no definió provisión.
    provisionBps: z.int().positive().max(10_000).nullable(),
    evidenceMaxAgeDays: z.int().positive().max(365),
    earlyAlertDays: z.int().positive().max(90), // T-7
    urgentAlertDays: z.int().positive().max(90), // T-3
    dataOrigin: DataOriginSchema,
  })
  .superRefine((template, ctx) => {
    if (template.earlyAlertDays <= template.urgentAlertDays) {
      ctx.addIssue({ code: "custom", path: ["earlyAlertDays"], message: "El aviso temprano tiene que ser anterior al urgente" });
    }
    const activated = template.status !== "draft";
    if (activated && (template.activatedBy === null || template.activatedAt === null)) {
      ctx.addIssue({ code: "custom", path: ["activatedBy"], message: "Una plantilla activa o pausada requiere quién y cuándo la activó" });
    }
    if (!activated && (template.activatedBy !== null || template.activatedAt !== null)) {
      ctx.addIssue({ code: "custom", path: ["status"], message: "Un borrador no tiene activación" });
    }
    if (new Set(template.taxes.map((tax) => tax.fiscalType)).size !== template.taxes.length) {
      ctx.addIssue({ code: "custom", path: ["taxes"], message: "Impuesto repetido en la plantilla" });
    }
  });

// ---------------------------------------------------------------------------
// Instantánea de la contabilidad (simulada)
// ---------------------------------------------------------------------------

// El borrador lo calculó la contabilidad; Pacta solo lo compara. null = no existe.
export const AccountingItemSchema = z
  .strictObject({
    fiscalType: FiscalTypeSchema,
    displayName: z.string().trim().min(1).max(200),
    periodStart: CalendarDateSchema,
    periodEnd: CalendarDateSchema,
    dueDate: CalendarDateSchema,
    draftAmountMinor: PositiveAmountMinorSchema.nullable(),
    accountingPeriodClosed: z.boolean(),
    previousConfirmedAmountMinor: PositiveAmountMinorSchema.nullable(),
    paymentReference: MaskedReferenceSchema.nullable(),
  })
  .superRefine((item, ctx) => {
    if (item.periodEnd < item.periodStart) {
      ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "periodEnd no puede ser anterior a periodStart" });
    }
  });

export const AccountingSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    snapshotId: EntityIdSchema,
    organizationId: EntityIdSchema,
    sourceLabel: z.literal("Contabilidad (simulada)"),
    dataOrigin: DataOriginSchema,
    currency: CurrencyCodeSchema,
    capturedAt: UtcInstantSchema,
    // Ingresos del último mes cerrado según la contabilidad. null = no los reporta.
    income: z
      .strictObject({
        periodStart: CalendarDateSchema,
        periodEnd: CalendarDateSchema,
        amountMinor: AmountMinorSchema,
      })
      .nullable(),
    items: z.array(AccountingItemSchema),
  })
  .superRefine((snapshot, ctx) => {
    const keys = snapshot.items.map((item) => periodKey(item.fiscalType, item.periodStart));
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: "custom", path: ["items"], message: "Impuesto repetido para el mismo periodo" });
    }
  });

// ---------------------------------------------------------------------------
// Liquidación: la confirma una persona o llega por el Inbox como propuesta
// ---------------------------------------------------------------------------

// propuesta | confirmada
export const SettlementStatusSchema = z.enum(["proposed", "confirmed"]);

export const SettlementSchema = z
  .strictObject({
    settlementId: EntityIdSchema,
    fiscalType: FiscalTypeSchema,
    periodStart: CalendarDateSchema,
    status: SettlementStatusSchema,
    amountMinor: PositiveAmountMinorSchema,
    source: z.enum(["human", "inbox"]),
    confirmedBy: EntityIdSchema.nullable(),
    confirmedAt: UtcInstantSchema.nullable(),
  })
  .superRefine((settlement, ctx) => {
    const confirmed = settlement.status === "confirmed";
    if (confirmed && (settlement.confirmedBy === null || settlement.confirmedAt === null)) {
      ctx.addIssue({ code: "custom", path: ["confirmedBy"], message: "Una liquidación confirmada requiere quién y cuándo la confirmó" });
    }
    if (!confirmed && (settlement.confirmedBy !== null || settlement.confirmedAt !== null)) {
      ctx.addIssue({ code: "custom", path: ["status"], message: "Una liquidación propuesta no tiene confirmación" });
    }
  });

// ---------------------------------------------------------------------------
// Corrida: fondos y periodos ya pagados
// ---------------------------------------------------------------------------

export const PaidPeriodSchema = z.strictObject({
  fiscalType: FiscalTypeSchema,
  periodStart: CalendarDateSchema,
});

export const FiscalRunContextSchema = z.strictObject({
  fundsAvailableMinor: AmountMinorSchema,
  fundsReservedMinor: AmountMinorSchema,
  paidPeriods: z.array(PaidPeriodSchema),
});

// ---------------------------------------------------------------------------
// Escenario de demo con su oracle (resultado esperado escrito antes de correr el motor)
// ---------------------------------------------------------------------------

export const ExpectedLineSchema = z.strictObject({
  fiscalType: FiscalTypeSchema,
  periodStart: CalendarDateSchema,
  decision: FiscalOutcomeSchema,
  reasonCodes: z.array(FiscalReasonCodeSchema).min(1),
});

export const FiscalScenarioSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    asOf: UtcInstantSchema,
    template: FiscalTemplateSchema,
    snapshot: AccountingSnapshotSchema,
    settlements: z.array(SettlementSchema),
    run: FiscalRunContextSchema,
    expected: z.array(ExpectedLineSchema),
  })
  .superRefine((scenario, ctx) => {
    if (scenario.template.organizationId !== scenario.snapshot.organizationId) {
      ctx.addIssue({ code: "custom", path: ["snapshot"], message: "La contabilidad pertenece a otra organización" });
    }
    const settlementKeys = scenario.settlements.map((s) => periodKey(s.fiscalType, s.periodStart));
    if (new Set(settlementKeys).size !== settlementKeys.length) {
      ctx.addIssue({ code: "custom", path: ["settlements"], message: "Más de una liquidación para el mismo impuesto y periodo" });
    }
  });

// ---------------------------------------------------------------------------
// Salida del motor. Local hasta que PaymentDecision v2 (PR #58) esté en main.
// ---------------------------------------------------------------------------

export const FiscalRuleEvaluationSchema = z.strictObject({
  ruleId: z.string().min(1),
  result: z.enum(["pass", "fail", "unknown"]),
  reasonCode: FiscalReasonCodeSchema.nullable(),
  explanation: z.string().min(1),
});

export const FiscalEvidenceReferenceSchema = z.strictObject({
  type: z.enum(["obligation_template", "accounting_snapshot", "settlement"]),
  id: EntityIdSchema,
});

export const FiscalLineDecisionSchema = z.strictObject({
  lineId: EntityIdSchema,
  organizationId: EntityIdSchema,
  obligationId: EntityIdSchema,
  obligationVersion: z.int().positive(),
  fiscalType: FiscalTypeSchema,
  periodStart: CalendarDateSchema,
  dueDate: CalendarDateSchema,
  amountMinor: PositiveAmountMinorSchema.nullable(),
  currency: CurrencyCodeSchema,
  asOf: UtcInstantSchema,
  decision: FiscalOutcomeSchema,
  reasonCodes: z.array(FiscalReasonCodeSchema).min(1),
  explanation: z.string().min(1),
  rulesEvaluated: z.array(FiscalRuleEvaluationSchema).min(1),
  evidenceReferences: z.array(FiscalEvidenceReferenceSchema),
  dataOrigin: DataOriginSchema,
  isSimulated: z.literal(true),
});

export function periodKey(fiscalType: FiscalType, periodStart: string): string {
  return `${fiscalType}:${periodStart}`;
}

export type FiscalType = z.infer<typeof FiscalTypeSchema>;
export type FiscalReasonCode = z.infer<typeof FiscalReasonCodeSchema>;
export type FiscalOutcome = z.infer<typeof FiscalOutcomeSchema>;
export type FiscalTemplate = z.infer<typeof FiscalTemplateSchema>;
export type AccountingItem = z.infer<typeof AccountingItemSchema>;
export type AccountingSnapshot = z.infer<typeof AccountingSnapshotSchema>;
export type Settlement = z.infer<typeof SettlementSchema>;
export type FiscalRunContext = z.infer<typeof FiscalRunContextSchema>;
export type FiscalScenario = z.infer<typeof FiscalScenarioSchema>;
export type FiscalRuleEvaluation = z.infer<typeof FiscalRuleEvaluationSchema>;
export type FiscalEvidenceReference = z.infer<typeof FiscalEvidenceReferenceSchema>;
export type FiscalLineDecision = z.infer<typeof FiscalLineDecisionSchema>;
