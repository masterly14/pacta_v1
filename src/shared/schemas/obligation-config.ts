import { z } from "zod";
import { AmountMinorSchema, CalendarDateSchema, CurrencyCodeSchema, EntityIdSchema, UtcInstantSchema } from "./invoice-context";

// Plantilla y datos configurados del Core proactivo (platform-core §5 y §6).
// Hechos de configuración: no autorizan un pago. `draft` no opera en automático.
// `fixture` en dataOrigin etiqueta datos de demo; `user` es configuración de la organización.

export const DEFAULT_VARIANCE_TOLERANCE_BPS = 1000; // 10 %
export const DEFAULT_EVIDENCE_MAX_AGE_DAYS = 7;
export const DEFAULT_EARLY_ALERT_DAYS = 7; // T-7
export const DEFAULT_URGENT_ALERT_DAYS = 3; // T-3

// fixture | user. El documento llama "fixture" a la implementación de demo de esta fuente.
export const DataOriginSchema = z.enum(["fixture", "user"]);

// nomina | fiscal
export const ObligationKindSchema = z.enum(["payroll", "fiscal"]);

// borrador | activa | pausada
export const ObligationStatusSchema = z.enum(["draft", "active", "paused"]);

// activo | licencia | desvinculado
export const EmployeeStatusSchema = z.enum(["active", "on_leave", "terminated"]);

// retencion_fuente | iva | ica | aportes_seguridad_social | aportes_parafiscales
export const FiscalObligationTypeSchema = z.enum(["withholding", "vat", "ica", "social_security", "parafiscal"]);

// salario | prima | cesantias | liquidacion_final | impuesto | aporte_seguridad_social | aporte_parafiscal
export const PAYROLL_LINE_TYPES = ["salary", "bonus", "severance", "final_settlement"] as const;
export const FISCAL_LINE_TYPES = ["tax", "social_security", "parafiscal"] as const;
export const ObligationLineTypeSchema = z.enum([...PAYROLL_LINE_TYPES, ...FISCAL_LINE_TYPES]);

// La referencia enmascarada lleva al menos un asterisco. Nunca la cuenta completa.
export const MaskedAccountReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/\*/, "La referencia de cuenta debe ir enmascarada");

export const PositiveAmountMinorSchema = z.int().positive();

const PayrollCalendarSchema = z.strictObject({
  kind: z.literal("payroll"),
  frequency: z.literal("monthly"),
  anchor: z.literal("month_end"), // fin de mes
});

const FiscalCalendarSchema = z.strictObject({
  kind: z.literal("fiscal"),
  frequency: z.literal("monthly"),
});

export const ObligationCalendarSchema = z.discriminatedUnion("kind", [PayrollCalendarSchema, FiscalCalendarSchema]);

export const ObligationTemplateSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    obligationId: EntityIdSchema,
    organizationId: EntityIdSchema,
    kind: ObligationKindSchema,
    calendar: ObligationCalendarSchema,
    currency: CurrencyCodeSchema,
    varianceToleranceBps: z.int().nonnegative().max(10_000).default(DEFAULT_VARIANCE_TOLERANCE_BPS),
    runCapMinor: PositiveAmountMinorSchema,
    evidenceMaxAgeDays: z.int().positive().max(365).default(DEFAULT_EVIDENCE_MAX_AGE_DAYS),
    earlyAlertDays: z.int().positive().max(90).default(DEFAULT_EARLY_ALERT_DAYS),
    urgentAlertDays: z.int().positive().max(90).default(DEFAULT_URGENT_ALERT_DAYS),
    version: z.int().positive(),
    status: ObligationStatusSchema,
    activatedBy: EntityIdSchema.nullable(),
    activatedAt: UtcInstantSchema.nullable(),
    dataOrigin: DataOriginSchema,
  })
  .superRefine((template, ctx) => {
    if (template.calendar.kind !== template.kind) {
      ctx.addIssue({ code: "custom", path: ["calendar"], message: "El calendario debe ser del mismo tipo que la obligación" });
    }
    if (template.earlyAlertDays <= template.urgentAlertDays) {
      ctx.addIssue({ code: "custom", path: ["earlyAlertDays"], message: "El aviso temprano tiene que ser anterior al aviso urgente" });
    }
    const activated = template.status === "active" || template.status === "paused";
    if (activated && (template.activatedBy === null || template.activatedAt === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["activatedBy"],
        message: "Una plantilla activa o pausada requiere la persona que la activó y el momento",
      });
    }
    if (template.status === "draft" && (template.activatedBy !== null || template.activatedAt !== null)) {
      ctx.addIssue({ code: "custom", path: ["status"], message: "Un borrador no tiene activación" });
    }
  });

export const PayrollEmployeeSchema = z.strictObject({
  counterpartyRef: EntityIdSchema,
  displayName: z.string().trim().min(1).max(200),
  status: EmployeeStatusSchema,
  baseSalaryMinor: PositiveAmountMinorSchema,
  beneficiaryAccountReference: MaskedAccountReferenceSchema.nullable(),
  lastConfirmedBeneficiaryReference: MaskedAccountReferenceSchema.nullable(),
  lastConfirmedAmountMinor: PositiveAmountMinorSchema.nullable(),
});

// Qué mes toca prima o cesantías, y el monto esperado por el fixture. No es cálculo laboral.
export const BenefitExpectationSchema = z.strictObject({
  counterpartyRef: EntityIdSchema,
  lineType: z.enum(["bonus", "severance"]),
  periodStart: CalendarDateSchema,
  expectedAmountMinor: PositiveAmountMinorSchema,
});

export const PayrollDatasetSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("payroll"),
    organizationId: EntityIdSchema,
    currency: CurrencyCodeSchema,
    capturedAt: UtcInstantSchema,
    dataOrigin: DataOriginSchema,
    fundsAvailableMinor: AmountMinorSchema,
    fundsReservedMinor: AmountMinorSchema,
    employees: z.array(PayrollEmployeeSchema),
    benefits: z.array(BenefitExpectationSchema),
  })
  .superRefine((dataset, ctx) => {
    assertUnique(dataset.employees.map((employee) => employee.counterpartyRef), ctx, ["employees"], "counterpartyRef de empleado repetido");
    assertUnique(
      dataset.benefits.map((benefit) => `${benefit.counterpartyRef}:${benefit.lineType}:${benefit.periodStart}`),
      ctx,
      ["benefits"],
      "beneficio repetido para la misma persona y periodo",
    );
  });

// propuesta | confirmada. null en el ítem significa que no hay liquidación.
export const SettlementStatusSchema = z.enum(["proposed", "confirmed"]);

export const FiscalItemSchema = z
  .strictObject({
    counterpartyRef: EntityIdSchema,
    displayName: z.string().trim().min(1).max(200),
    fiscalType: FiscalObligationTypeSchema,
    periodStart: CalendarDateSchema,
    periodEnd: CalendarDateSchema,
    dueDate: CalendarDateSchema,
    settlementStatus: SettlementStatusSchema.nullable(),
    settlementAmountMinor: PositiveAmountMinorSchema.nullable(),
    authorizedPaymentReference: MaskedAccountReferenceSchema.nullable(),
    beneficiaryAccountReference: MaskedAccountReferenceSchema.nullable(),
  })
  .superRefine((item, ctx) => {
    if (item.periodEnd < item.periodStart) {
      ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "periodEnd no puede ser anterior a periodStart" });
    }
    if (item.settlementStatus === null && item.settlementAmountMinor !== null) {
      ctx.addIssue({ code: "custom", path: ["settlementAmountMinor"], message: "Sin liquidación el monto queda null, no un importe" });
    }
    if (item.settlementStatus === "confirmed" && item.settlementAmountMinor === null) {
      ctx.addIssue({ code: "custom", path: ["settlementAmountMinor"], message: "Una liquidación confirmada requiere monto" });
    }
  });

export const FiscalDatasetSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("fiscal"),
    organizationId: EntityIdSchema,
    currency: CurrencyCodeSchema,
    capturedAt: UtcInstantSchema,
    dataOrigin: DataOriginSchema,
    fundsAvailableMinor: AmountMinorSchema,
    fundsReservedMinor: AmountMinorSchema,
    items: z.array(FiscalItemSchema),
  })
  .superRefine((dataset, ctx) => {
    assertUnique(dataset.items.map((item) => item.counterpartyRef), ctx, ["items"], "counterpartyRef fiscal repetido");
  });

export const ConfiguredDatasetSchema = z.discriminatedUnion("kind", [PayrollDatasetSchema, FiscalDatasetSchema]);

// Plantilla + dataset del mismo tipo, organización y moneda. Sin conversión.
export const ConfiguredObligationSourceSchema = z
  .strictObject({
    template: ObligationTemplateSchema,
    dataset: ConfiguredDatasetSchema,
  })
  .superRefine((source, ctx) => {
    if (source.template.kind !== source.dataset.kind) {
      ctx.addIssue({ code: "custom", path: ["dataset"], message: "El dataset debe ser del mismo tipo que la plantilla" });
    }
    if (source.template.organizationId !== source.dataset.organizationId) {
      ctx.addIssue({ code: "custom", path: ["dataset"], message: "El dataset pertenece a otra organización" });
    }
    if (source.template.currency !== source.dataset.currency) {
      ctx.addIssue({ code: "custom", path: ["dataset"], message: "La obligación no convierte moneda" });
    }
  });

function assertUnique(
  values: readonly string[],
  ctx: { addIssue: (issue: { code: "custom"; path: (string | number)[]; message: string }) => void },
  path: (string | number)[],
  message: string,
) {
  if (new Set(values).size !== values.length) {
    ctx.addIssue({ code: "custom", path, message });
  }
}

export type DataOrigin = z.infer<typeof DataOriginSchema>;
export type ObligationKind = z.infer<typeof ObligationKindSchema>;
export type ObligationStatus = z.infer<typeof ObligationStatusSchema>;
export type EmployeeStatus = z.infer<typeof EmployeeStatusSchema>;
export type FiscalObligationType = z.infer<typeof FiscalObligationTypeSchema>;
export type ObligationLineType = z.infer<typeof ObligationLineTypeSchema>;
export type ObligationTemplate = z.infer<typeof ObligationTemplateSchema>;
export type PayrollEmployee = z.infer<typeof PayrollEmployeeSchema>;
export type BenefitExpectation = z.infer<typeof BenefitExpectationSchema>;
export type PayrollDataset = z.infer<typeof PayrollDatasetSchema>;
export type FiscalItem = z.infer<typeof FiscalItemSchema>;
export type FiscalDataset = z.infer<typeof FiscalDatasetSchema>;
export type ConfiguredDataset = z.infer<typeof ConfiguredDatasetSchema>;
export type ConfiguredObligationSource = z.infer<typeof ConfiguredObligationSourceSchema>;
