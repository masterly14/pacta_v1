import { z } from "zod";
import {
  AmountMinorSchema,
  CalendarDateSchema,
  CurrencyCodeSchema,
  EntityIdSchema,
  TagsSchema,
} from "./primitives.ts";

// Contrato entre el historial y el motor determinístico de B. Fail-closed: lo que no se puede
// afirmar es `unknown` con razón; nunca se expresa como 0 ni como "sin gasto".

export const HistoryFilterSchema = z.strictObject({
  tags: TagsSchema.optional(), // sin filtro = toda la organización (lo que usa el presupuesto)
});
export type HistoryFilter = z.infer<typeof HistoryFilterSchema>;

// ---------------------------------------------------------------------------
// Gasto del periodo (getSpentInPeriod)
// ---------------------------------------------------------------------------

export const HistoryUnknownReasonSchema = z.enum([
  "NO_COMMITTED_BATCHES",
  "PERIOD_NOT_COVERED",
  "REJECTED_ROWS_IN_PERIOD",
]);
export type HistoryUnknownReason = z.infer<typeof HistoryUnknownReasonSchema>;

export const HistorySpendResultSchema = z.discriminatedUnion("status", [
  z
    .strictObject({
      status: z.literal("known"),
      amountMinor: AmountMinorSchema,
      currency: CurrencyCodeSchema,
      from: CalendarDateSchema,
      to: CalendarDateSchema,
      batchIds: z.array(EntityIdSchema).min(1), // un gasto "conocido" sin lotes que lo respalden no existe
    })
    .superRefine((result, ctx) => {
      if (result.from > result.to) {
        ctx.addIssue({ code: "custom", path: ["from"], message: "from no puede ser posterior a to" });
      }
    }),
  z.strictObject({
    status: z.literal("unknown"),
    reason: HistoryUnknownReasonSchema,
  }),
]);
export type HistorySpendResult = z.infer<typeof HistorySpendResultSchema>;

// ---------------------------------------------------------------------------
// Cobertura del histórico (getHistoryCoverage)
// ---------------------------------------------------------------------------

export const HistoryCoverageSchema = z
  .strictObject({
    firstPostedOn: CalendarDateSchema.nullable(), // null = sin histórico confirmado
    lastPostedOn: CalendarDateSchema.nullable(),
    rejectedRows: z.int().nonnegative(), // filas rechazadas en lotes confirmados
  })
  .superRefine((coverage, ctx) => {
    if ((coverage.firstPostedOn === null) !== (coverage.lastPostedOn === null)) {
      ctx.addIssue({ code: "custom", path: ["lastPostedOn"], message: "firstPostedOn y lastPostedOn van juntos o ambos null" });
    } else if (coverage.firstPostedOn !== null && coverage.lastPostedOn !== null && coverage.firstPostedOn > coverage.lastPostedOn) {
      ctx.addIssue({ code: "custom", path: ["firstPostedOn"], message: "firstPostedOn no puede ser posterior a lastPostedOn" });
    }
  });
export type HistoryCoverage = z.infer<typeof HistoryCoverageSchema>;

// ---------------------------------------------------------------------------
// Duplicados candidatos (findDuplicateCandidates): evidencia para el motor, no veredicto
// ---------------------------------------------------------------------------

export const DuplicateCandidateSchema = z.strictObject({
  transactionId: EntityIdSchema,
  postedOn: CalendarDateSchema,
  amountMinor: AmountMinorSchema,
  currency: CurrencyCodeSchema,
  matchBasis: z.enum(["external_ref", "amount_counterparty_window"]),
});
export type DuplicateCandidate = z.infer<typeof DuplicateCandidateSchema>;

// ---------------------------------------------------------------------------
// Recurrencias (getRecurrenceSuggestions): SUGERENCIA, nunca autorización
// ---------------------------------------------------------------------------

export const RecurrenceCadenceSchema = z.enum(["weekly", "monthly", "quarterly", "yearly"]);

export const RecurrenceSuggestionSchema = z
  .strictObject({
    // `supplier`: movimientos ya vinculados a un proveedor. `unlinked_counterparty`: aún sin proveedor,
    // agrupados por clave de contraparte (candidato a crear/vincular proveedor).
    groupKind: z.enum(["supplier", "unlinked_counterparty"]),
    counterpartyNormalized: z.string().min(1),
    supplierId: EntityIdSchema.nullable(),
    cadence: RecurrenceCadenceSchema,
    typicalAmountMinor: AmountMinorSchema, // mediana en valor absoluto
    currency: CurrencyCodeSchema,
    occurrences: z.int().min(2),
    transactionIds: z.array(EntityIdSchema).min(2),
    firstPostedOn: CalendarDateSchema,
    lastPostedOn: CalendarDateSchema,
    // Marca de tipo: historial ≠ autorización. Una autorización solo nace de una acción humana explícita.
    isSuggestionOnly: z.literal(true),
  })
  .superRefine((suggestion, ctx) => {
    if (suggestion.transactionIds.length !== suggestion.occurrences) {
      ctx.addIssue({ code: "custom", path: ["transactionIds"], message: "transactionIds debe tener exactamente 'occurrences' elementos" });
    }
    if (suggestion.firstPostedOn > suggestion.lastPostedOn) {
      ctx.addIssue({ code: "custom", path: ["firstPostedOn"], message: "firstPostedOn no puede ser posterior a lastPostedOn" });
    }
    if ((suggestion.groupKind === "supplier") !== (suggestion.supplierId !== null)) {
      ctx.addIssue({ code: "custom", path: ["supplierId"], message: "supplierId es obligatorio con groupKind 'supplier' y null con 'unlinked_counterparty'" });
    }
  });
export type RecurrenceSuggestion = z.infer<typeof RecurrenceSuggestionSchema>;
