import { z } from "zod";
import {
  AmountMinorSchema,
  CalendarDateSchema,
  CurrencyCodeSchema,
  DirectionSchema,
  RowNumberSchema,
} from "./primitives";

// Límites del import (PLAN: el body de una función de Vercel es de 4,5 MB).
export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_ROWS = 20_000;
export const MAX_CELL_LENGTH = 2000;

// Campos canónicos del formato recomendado (payment-history-infra.md §3.1).
export const CANONICAL_FIELDS = [
  "posted_on",
  "description",
  "counterparty",
  "amount",
  "direction",
  "currency",
  "external_ref",
] as const;
export const CanonicalFieldSchema = z.enum(CANONICAL_FIELDS);
export type CanonicalField = z.infer<typeof CanonicalFieldSchema>;

// Siempre obligatorios. `direction` es obligatorio por alguna vía (columna, signo o columnas débito/crédito).
export const REQUIRED_FIELDS = ["posted_on", "amount", "currency"] as const satisfies readonly CanonicalField[];

// Fila cruda tal como sale del parser: dato no confiable, solo cadenas acotadas.
export const RawCsvRowSchema = z.record(z.string(), z.string().max(MAX_CELL_LENGTH));
export type RawCsvRow = z.infer<typeof RawCsvRowSchema>;

// Fila ya normalizada y válida. Los desconocidos opcionales son `null`; nunca se rellenan con 0 ni con la fecha actual.
export const NormalizedBankRowSchema = z.strictObject({
  rowNumber: RowNumberSchema,
  postedOn: CalendarDateSchema,
  direction: DirectionSchema,
  amountMinor: AmountMinorSchema,
  currency: CurrencyCodeSchema,
  descriptionRaw: z.string().max(MAX_CELL_LENGTH).nullable(),
  counterpartyRaw: z.string().max(MAX_CELL_LENGTH).nullable(),
  externalRef: z.string().trim().min(1).max(200).nullable(),
});
export type NormalizedBankRow = z.infer<typeof NormalizedBankRowSchema>;

// Motivos por los que una fila se rechaza (se guardan en bank_import_rejections).
export const RowRejectionCodeSchema = z.enum([
  "MISSING_REQUIRED_FIELD",
  "INVALID_DATE",
  "AMBIGUOUS_DATE",
  "INVALID_AMOUNT",
  "NEGATIVE_OR_ZERO_AMOUNT",
  "UNKNOWN_CURRENCY",
  "INVALID_DIRECTION",
  "BOTH_DEBIT_AND_CREDIT",
  "NEITHER_DEBIT_NOR_CREDIT",
  "CELL_TOO_LONG",
  "FULL_ACCOUNT_NUMBER_DETECTED",
]);
export type RowRejectionCode = z.infer<typeof RowRejectionCodeSchema>;

export const RowRejectionSchema = z.strictObject({
  rowNumber: RowNumberSchema,
  errorCodes: z.array(RowRejectionCodeSchema).min(1),
});
export type RowRejection = z.infer<typeof RowRejectionSchema>;
