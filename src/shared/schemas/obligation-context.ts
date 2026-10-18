import { z } from "zod";
import {
  CalendarDateSchema,
  CurrencyCodeSchema,
  EntityIdSchema,
  UtcInstantSchema,
} from "./invoice-context";
import {
  FISCAL_LINE_TYPES,
  MaskedAccountReferenceSchema,
  ObligationKindSchema,
  ObligationLineTypeSchema,
  PAYROLL_LINE_TYPES,
  type ObligationKind,
  type ObligationLineType,
} from "./obligation-config";
import { InboxSignalKindSchema, InboxSignalStatusSchema } from "./inbox-signal";

// Hechos de una línea y de una corrida (platform-core §6.1). No son una autorización.
// Un importe desconocido es null. 0 no sustituye a null.

export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "sha256 hex de 64 caracteres");

// configured = configuración o fixture detrás del puerto. inbox = correo.
export const EvidenceSourceSchema = z.enum(["configured", "inbox"]);

export const EvidenceKindSchema = z.enum(["payroll_roster", "benefit_calendar", "fiscal_calendar", "funds", "inbox_excerpt"]);

export const EvidenceSnapshotRefSchema = z.strictObject({
  snapshotId: EntityIdSchema,
  source: EvidenceSourceSchema,
  kind: EvidenceKindSchema,
  capturedAt: UtcInstantSchema,
  sha256: Sha256Schema,
});

export const ObligationSignalRefSchema = z.strictObject({
  signalId: EntityIdSchema,
  kind: InboxSignalKindSchema,
  status: InboxSignalStatusSchema,
});

export const AmountComponentSchema = z.strictObject({
  code: z.string().trim().min(1).max(40),
  amountMinor: z.int().positive(),
});

export const ObligationWarningSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  field: z.string().min(1).nullable(),
});

export const OBLIGATION_MISSING_FIELDS = [
  "beneficiaryAccountReference",
  "lastConfirmedBeneficiaryReference",
  "amountMinor",
  "currency",
  "lastConfirmedAmountMinor",
] as const;

export const ObligationMissingFieldSchema = z.enum(OBLIGATION_MISSING_FIELDS);

export const ObligationPeriodSchema = z
  .strictObject({
    periodStart: CalendarDateSchema,
    periodEnd: CalendarDateSchema,
    dueDate: CalendarDateSchema,
  })
  .superRefine((period, ctx) => {
    if (period.periodEnd < period.periodStart) {
      ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "periodEnd no puede ser anterior a periodStart" });
    }
  });

export const ObligationContextSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    lineId: EntityIdSchema,
    occurrenceId: EntityIdSchema,
    obligationId: EntityIdSchema,
    obligationVersion: z.int().positive(),
    organizationId: EntityIdSchema,
    kind: ObligationKindSchema,
    asOf: UtcInstantSchema,
    periodStart: CalendarDateSchema,
    periodEnd: CalendarDateSchema,
    dueDate: CalendarDateSchema,
    counterpartyRef: EntityIdSchema,
    displayName: z.string().trim().min(1).max(200),
    beneficiaryAccountReference: MaskedAccountReferenceSchema.nullable(),
    lastConfirmedBeneficiaryReference: MaskedAccountReferenceSchema.nullable(),
    lineType: ObligationLineTypeSchema,
    amountMinor: z.int().positive().nullable(),
    currency: CurrencyCodeSchema.nullable(),
    components: z.array(AmountComponentSchema),
    lastConfirmedAmountMinor: z.int().positive().nullable(),
    evidence: z.array(EvidenceSnapshotRefSchema),
    signals: z.array(ObligationSignalRefSchema),
    missingFields: z.array(ObligationMissingFieldSchema),
    warnings: z.array(ObligationWarningSchema),
  })
  .superRefine((line, ctx) => {
    if (line.periodEnd < line.periodStart) {
      ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "periodEnd no puede ser anterior a periodStart" });
    }
    if (!lineTypeMatchesKind(line.kind, line.lineType)) {
      ctx.addIssue({ code: "custom", path: ["lineType"], message: "lineType no corresponde al tipo de obligación" });
    }
    if (line.amountMinor !== null && line.currency === null) {
      ctx.addIssue({ code: "custom", path: ["currency"], message: "Un importe requiere moneda explícita" });
    }
    if (line.amountMinor === null && line.components.length > 0) {
      ctx.addIssue({ code: "custom", path: ["components"], message: "Sin importe no hay componentes" });
    }
    if (line.amountMinor !== null && line.components.length > 0) {
      const sum = line.components.reduce((total, component) => total + component.amountMinor, 0);
      if (sum !== line.amountMinor) {
        ctx.addIssue({ code: "custom", path: ["components"], message: "Los componentes no suman el importe de la línea" });
      }
    }
    assertMissingFields(line, OBLIGATION_MISSING_FIELDS, line.missingFields, ctx);
    assertUnique(line.signals.map((signal) => signal.signalId), ctx, ["signals"], "signalId repetido en la línea");
    for (const [index, signal] of line.signals.entries()) {
      if (signal.status === "dismissed") {
        ctx.addIssue({
          code: "custom",
          path: ["signals", index, "status"],
          message: "Una señal descartada no se adjunta a una línea",
        });
      }
    }
  });

export const OccurrenceLinePresenceSchema = z.strictObject({
  lineId: EntityIdSchema,
  counterpartyRef: EntityIdSchema,
  lineType: ObligationLineTypeSchema,
  amountMinor: z.int().positive().nullable(),
  currency: CurrencyCodeSchema.nullable(),
});

export const OCCURRENCE_MISSING_FIELDS = ["fundsAvailableMinor", "fundsReservedMinor", "evidenceCapturedAt"] as const;

export const OccurrenceMissingFieldSchema = z.enum(OCCURRENCE_MISSING_FIELDS);

// programada → recolectando_evidencia → evaluada → en_aprobacion → lista_para_ejecutar → ejecutada_simulada
// Laterales: retenida, fallida, cancelada.
export const OccurrenceStatusSchema = z.enum([
  "scheduled",
  "collecting_evidence",
  "evaluated",
  "in_approval",
  "ready_to_execute",
  "simulated_executed",
  "held",
  "failed",
  "cancelled",
]);

export const OccurrenceContextSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    occurrenceId: EntityIdSchema,
    obligationId: EntityIdSchema,
    obligationVersion: z.int().positive(),
    organizationId: EntityIdSchema,
    kind: ObligationKindSchema,
    asOf: UtcInstantSchema,
    periodStart: CalendarDateSchema,
    periodEnd: CalendarDateSchema,
    dueDate: CalendarDateSchema,
    expectedCounterparties: z.array(EntityIdSchema),
    lines: z.array(OccurrenceLinePresenceSchema),
    fundsAvailableMinor: z.int().nonnegative().nullable(),
    fundsReservedMinor: z.int().nonnegative().nullable(),
    evidenceCapturedAt: UtcInstantSchema.nullable(),
    missingFields: z.array(OccurrenceMissingFieldSchema),
  })
  .superRefine((occurrence, ctx) => {
    if (occurrence.periodEnd < occurrence.periodStart) {
      ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "periodEnd no puede ser anterior a periodStart" });
    }
    assertMissingFields(occurrence, OCCURRENCE_MISSING_FIELDS, occurrence.missingFields, ctx);
    assertUnique(occurrence.expectedCounterparties, ctx, ["expectedCounterparties"], "contraparte esperada repetida");
    assertUnique(occurrence.lines.map((line) => line.lineId), ctx, ["lines"], "lineId repetido en la corrida");
    for (const [index, line] of occurrence.lines.entries()) {
      if (!lineTypeMatchesKind(occurrence.kind, line.lineType)) {
        ctx.addIssue({ code: "custom", path: ["lines", index, "lineType"], message: "lineType no corresponde al tipo de la corrida" });
      }
      if (line.amountMinor !== null && line.currency === null) {
        ctx.addIssue({ code: "custom", path: ["lines", index, "currency"], message: "Un importe requiere moneda explícita" });
      }
    }
  });

export const DecisionKeySchema = z.strictObject({
  occurrenceId: EntityIdSchema,
  lineId: EntityIdSchema,
  evidenceSha256: Sha256Schema,
});

// Clave de idempotencia: occurrenceId + lineId + hash(evidencia).
export function decisionKey(occurrenceId: string, lineId: string, evidenceSha256: string): DecisionKey {
  return DecisionKeySchema.parse({ occurrenceId, lineId, evidenceSha256 });
}

export function obligationMissingFields(input: {
  beneficiaryAccountReference: string | null;
  lastConfirmedBeneficiaryReference: string | null;
  amountMinor: number | null;
  currency: string | null;
  lastConfirmedAmountMinor: number | null;
}): ObligationMissingField[] {
  return OBLIGATION_MISSING_FIELDS.filter((field) => input[field] === null);
}

export function occurrenceMissingFields(input: {
  fundsAvailableMinor: number | null;
  fundsReservedMinor: number | null;
  evidenceCapturedAt: string | null;
}): OccurrenceMissingField[] {
  return OCCURRENCE_MISSING_FIELDS.filter((field) => input[field] === null);
}

export function lineTypeMatchesKind(kind: ObligationKind, lineType: ObligationLineType): boolean {
  const allowed = kind === "payroll" ? PAYROLL_LINE_TYPES : FISCAL_LINE_TYPES;
  return (allowed as readonly string[]).includes(lineType);
}

type IssueCtx = {
  addIssue: (issue: { code: "custom"; path: (string | number)[]; message: string }) => void;
};

function assertMissingFields<T extends string>(
  value: Record<T, unknown>,
  fields: readonly T[],
  listed: readonly T[],
  ctx: IssueCtx,
) {
  const set = new Set(listed);
  if (set.size !== listed.length) {
    ctx.addIssue({ code: "custom", path: ["missingFields"], message: "missingFields contiene duplicados" });
  }
  for (const field of fields) {
    const isNull = value[field] === null;
    if (isNull && !set.has(field)) {
      ctx.addIssue({ code: "custom", path: ["missingFields"], message: `${field} es null y debe figurar en missingFields` });
    }
    if (!isNull && set.has(field)) {
      ctx.addIssue({ code: "custom", path: ["missingFields"], message: `${field} tiene valor y no puede figurar en missingFields` });
    }
  }
}

function assertUnique(values: readonly string[], ctx: IssueCtx, path: (string | number)[], message: string) {
  if (new Set(values).size !== values.length) {
    ctx.addIssue({ code: "custom", path, message });
  }
}

export type EvidenceSnapshotRef = z.infer<typeof EvidenceSnapshotRefSchema>;
export type ObligationSignalRef = z.infer<typeof ObligationSignalRefSchema>;
export type ObligationMissingField = z.infer<typeof ObligationMissingFieldSchema>;
export type ObligationContext = z.infer<typeof ObligationContextSchema>;
export type ObligationPeriod = z.infer<typeof ObligationPeriodSchema>;
export type OccurrenceMissingField = z.infer<typeof OccurrenceMissingFieldSchema>;
export type OccurrenceStatus = z.infer<typeof OccurrenceStatusSchema>;
export type OccurrenceContext = z.infer<typeof OccurrenceContextSchema>;
export type DecisionKey = z.infer<typeof DecisionKeySchema>;
