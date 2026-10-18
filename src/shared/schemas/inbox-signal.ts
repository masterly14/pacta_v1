import { z } from "zod";
import { CalendarDateSchema, CurrencyCodeSchema, EntityIdSchema, UtcInstantSchema } from "./invoice-context";
import {
  FiscalObligationTypeSchema,
  MaskedAccountReferenceSchema,
} from "./obligation-config";

// Señal propuesta extraída de un correo (platform-core §6.4). Nunca habilita ni aprueba un pago.
// Nace `proposed`. Verificar o descartar es una acción humana.

// novedad_laboral | liquidacion_fiscal
export const InboxSignalKindSchema = z.enum(["employment_event", "tax_settlement"]);

// retiro | ingreso | cambio_cuenta | incapacidad | licencia | ajuste_salarial
export const EmploymentEventSubtypeSchema = z.enum([
  "termination",
  "hire",
  "account_change",
  "sick_leave",
  "leave",
  "salary_adjustment",
]);

// propuesta | verificada | descartada
export const InboxSignalStatusSchema = z.enum(["proposed", "verified", "dismissed"]);

export const InboxSubjectRefSchema = z.strictObject({
  type: z.enum(["counterparty", "obligation"]),
  id: EntityIdSchema,
});

export const InboxSignalEvidenceSchema = z.strictObject({
  excerpt: z.string().trim().min(1).max(1000),
  gmailInboundMessageId: EntityIdSchema,
});

const EmploymentPayloadSchema = z.strictObject({
  counterpartyHint: z.string().trim().min(1).max(200).nullable(),
});

const TaxSettlementPayloadSchema = z
  .strictObject({
    fiscalType: FiscalObligationTypeSchema,
    periodStart: CalendarDateSchema.nullable(),
    periodEnd: CalendarDateSchema.nullable(),
    amountMinor: z.int().positive().nullable(),
    currency: CurrencyCodeSchema.nullable(),
    paymentReference: MaskedAccountReferenceSchema.nullable(),
  })
  .superRefine((payload, ctx) => {
    const hasStart = payload.periodStart !== null;
    const hasEnd = payload.periodEnd !== null;
    if (hasStart !== hasEnd) {
      ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "El periodo de la liquidación va completo o queda desconocido" });
    }
    if (payload.periodStart !== null && payload.periodEnd !== null && payload.periodEnd < payload.periodStart) {
      ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "periodEnd no puede ser anterior a periodStart" });
    }
    if (payload.amountMinor !== null && payload.currency === null) {
      ctx.addIssue({ code: "custom", path: ["currency"], message: "Un importe requiere moneda explícita" });
    }
  });

const signalBase = {
  schemaVersion: z.literal(1),
  signalId: EntityIdSchema,
  organizationId: EntityIdSchema,
  gmailInboundMessageId: EntityIdSchema,
  subjectRef: InboxSubjectRefSchema.nullable(),
  status: InboxSignalStatusSchema,
  evidence: InboxSignalEvidenceSchema,
  reviewedBy: EntityIdSchema.nullable(),
  reviewedAt: UtcInstantSchema.nullable(),
};

export const InboxSignalSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      ...signalBase,
      kind: z.literal("employment_event"),
      subtype: EmploymentEventSubtypeSchema,
      payload: EmploymentPayloadSchema,
    }),
    z.strictObject({
      ...signalBase,
      kind: z.literal("tax_settlement"),
      payload: TaxSettlementPayloadSchema,
    }),
  ])
  .superRefine((signal, ctx) => {
    if (signal.evidence.gmailInboundMessageId !== signal.gmailInboundMessageId) {
      ctx.addIssue({
        code: "custom",
        path: ["evidence", "gmailInboundMessageId"],
        message: "La evidencia debe citar el mismo mensaje de Gmail",
      });
    }
    const reviewed = signal.status === "verified" || signal.status === "dismissed";
    if (reviewed && (signal.reviewedBy === null || signal.reviewedAt === null)) {
      ctx.addIssue({ code: "custom", path: ["reviewedBy"], message: "Verificar o descartar una señal requiere actor y momento" });
    }
    if (signal.status === "proposed" && (signal.reviewedBy !== null || signal.reviewedAt !== null)) {
      ctx.addIssue({ code: "custom", path: ["status"], message: "Una señal propuesta todavía no tiene revisión" });
    }
  });

// Una señal sin subjectRef puede existir en la bandeja, pero no entra en una línea de pago.
export const AttachableInboxSignalSchema = InboxSignalSchema.superRefine((signal, ctx) => {
  if (signal.subjectRef === null) {
    ctx.addIssue({
      code: "custom",
      path: ["subjectRef"],
      message: "Una señal adjunta a una línea requiere subjectRef",
    });
  }
});

// Clasificación del correo. La rama `invoice` sigue en processInvoice; no lleva señal.
export const InboundMailClassSchema = z
  .discriminatedUnion("class", [
    z.strictObject({ class: z.literal("invoice") }),
    z.strictObject({ class: z.literal("employment_event"), signal: InboxSignalSchema }),
    z.strictObject({ class: z.literal("tax_settlement"), signal: InboxSignalSchema }),
    z.strictObject({ class: z.literal("other"), reason: z.string().trim().min(1).max(500) }),
  ])
  .superRefine((mail, ctx) => {
    if (mail.class === "employment_event" && mail.signal.kind !== "employment_event") {
      ctx.addIssue({ code: "custom", path: ["signal"], message: "La clase employment_event exige una señal de novedad laboral" });
    }
    if (mail.class === "tax_settlement" && mail.signal.kind !== "tax_settlement") {
      ctx.addIssue({ code: "custom", path: ["signal"], message: "La clase tax_settlement exige una señal de liquidación fiscal" });
    }
  });

export type InboxSignalKind = z.infer<typeof InboxSignalKindSchema>;
export type EmploymentEventSubtype = z.infer<typeof EmploymentEventSubtypeSchema>;
export type InboxSignalStatus = z.infer<typeof InboxSignalStatusSchema>;
export type InboxSignal = z.infer<typeof InboxSignalSchema>;
export type InboundMailClass = z.infer<typeof InboundMailClassSchema>;
