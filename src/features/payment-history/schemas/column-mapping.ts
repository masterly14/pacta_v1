import { z } from "zod";
import { CurrencyCodeSchema } from "./primitives.ts";
import { CanonicalFieldSchema } from "./csv-fields.ts";

// Mapeo de columnas confirmado por una persona cuando las cabeceras del archivo no coinciden
// con el formato recomendado (payment-history-infra.md §3.2). Ninguna sugerencia se aplica sola.
// Se modela como unión discriminada para que no existan combinaciones imposibles.

const HeaderSchema = z.string().trim().min(1).max(200);
const OptionalColumnSchema = z.strictObject({ header: HeaderSchema }).nullable();

// El formato de fecha se elige explícitamente: nunca se adivina (03/04/2026 es ambiguo).
export const DATE_FORMATS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"] as const;
export const DateFormatSchema = z.enum(DATE_FORMATS);
export type DateFormat = z.infer<typeof DateFormatSchema>;

export const DecimalSeparatorSchema = z.enum([".", ","]);

// Tres vías para obtener importe + sentido del movimiento.
export const AmountLayoutSchema = z.discriminatedUnion("layout", [
  // importe sin signo + columna con debit/credit
  z.strictObject({ layout: z.literal("amount_and_direction"), amountHeader: HeaderSchema, directionHeader: HeaderSchema }),
  // una sola columna con signo: negativo = débito, positivo = crédito
  z.strictObject({ layout: z.literal("signed_amount"), amountHeader: HeaderSchema }),
  // dos columnas: exactamente una debe traer valor en cada fila
  z.strictObject({ layout: z.literal("debit_credit_columns"), debitHeader: HeaderSchema, creditHeader: HeaderSchema }),
]);

// Moneda por columna, o una moneda fija para todo el archivo elegida a mano.
export const CurrencySourceSchema = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("column"), header: HeaderSchema }),
  z.strictObject({ source: z.literal("fixed"), code: CurrencyCodeSchema }),
]);

const ColumnMappingBaseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  date: z.strictObject({ header: HeaderSchema, format: DateFormatSchema }),
  amount: AmountLayoutSchema,
  decimalSeparator: DecimalSeparatorSchema,
  currency: CurrencySourceSchema,
  description: OptionalColumnSchema,
  counterparty: OptionalColumnSchema,
  externalRef: OptionalColumnSchema,
});

type ColumnMappingBase = z.infer<typeof ColumnMappingBaseSchema>;

// Todas las cabeceras que referencia el mapeo, en orden estable.
export function mappingHeaders(mapping: ColumnMappingBase): string[] {
  const headers: string[] = [mapping.date.header];
  switch (mapping.amount.layout) {
    case "amount_and_direction":
      headers.push(mapping.amount.amountHeader, mapping.amount.directionHeader);
      break;
    case "signed_amount":
      headers.push(mapping.amount.amountHeader);
      break;
    case "debit_credit_columns":
      headers.push(mapping.amount.debitHeader, mapping.amount.creditHeader);
      break;
  }
  if (mapping.currency.source === "column") headers.push(mapping.currency.header);
  for (const optional of [mapping.description, mapping.counterparty, mapping.externalRef]) {
    if (optional) headers.push(optional.header);
  }
  return headers;
}

export const ColumnMappingSchema = ColumnMappingBaseSchema.superRefine((mapping, ctx) => {
  const seen = new Set<string>();
  for (const header of mappingHeaders(mapping)) {
    if (seen.has(header)) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: `La cabecera '${header}' está asignada a más de un campo` });
    }
    seen.add(header);
  }
});
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

// ---------------------------------------------------------------------------
// Cabeceras detectadas en el archivo
// ---------------------------------------------------------------------------

// Clave de comparación: sin tildes, minúsculas, sin espacios extra.
export function normalizeHeaderKey(header: string): string {
  return header.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase().replace(/\s+/g, " ");
}

export const DetectedHeadersSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    headers: z.array(HeaderSchema).min(1).max(200),
  })
  .superRefine((detected, ctx) => {
    const keys = new Set<string>();
    for (const header of detected.headers) {
      const key = normalizeHeaderKey(header);
      if (keys.has(key)) {
        ctx.addIssue({ code: "custom", path: ["headers"], message: `Cabecera duplicada: '${header}'; el mapeo sería ambiguo` });
      }
      keys.add(key);
    }
  });
export type DetectedHeaders = z.infer<typeof DetectedHeadersSchema>;

export type MappingHeaderCheck = { ok: true } | { ok: false; missingHeaders: string[] };

// La estructura se valida con ColumnMappingSchema; que las cabeceras existan depende del archivo.
export function validateMappingAgainstHeaders(mapping: ColumnMapping, detected: DetectedHeaders): MappingHeaderCheck {
  const available = new Set(detected.headers);
  const missingHeaders = mappingHeaders(mapping).filter((header) => !available.has(header));
  return missingHeaders.length === 0 ? { ok: true } : { ok: false, missingHeaders };
}

// Sugerencia determinística (alias/coincidencia exacta). Solo se muestra preseleccionada: no se aplica sin confirmación.
export const MappingSuggestionSchema = z.strictObject({
  field: CanonicalFieldSchema,
  header: HeaderSchema,
  matchedBy: z.enum(["exact", "alias"]),
});
export type MappingSuggestion = z.infer<typeof MappingSuggestionSchema>;
