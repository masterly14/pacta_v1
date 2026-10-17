import { RECURRENCE_LOOKBACK_MONTHS, RECURRENCE_MAX_ROWS } from "../config";
import type { RecurrenceSuggestion } from "../schemas/history-queries";
import { detectRecurrences, type RecurrenceInput } from "./detect-recurrence";

// Lectura de recurrencias sobre un puerto de solo lectura. El resultado es una SUGERENCIA: nunca
// autoriza un pago (historial ≠ autorización); el motor solo la usa para explicar el motivo de la escalada.

export interface RecurrenceStore {
  listOutflows(
    organizationId: string,
    filter: { since: string; supplierId?: string; limit: number },
  ): Promise<{ transactions: RecurrenceInput[]; truncated: boolean }>;
}

export type RecurrenceResult = { ok: true; suggestions: RecurrenceSuggestion[] } | { ok: false; error: string };

// Primer día de la ventana (fecha de calendario UTC, YYYY-MM-DD).
export function recurrenceWindowStart(now: Date): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - RECURRENCE_LOOKBACK_MONTHS, now.getUTCDate()));
  return start.toISOString().slice(0, 10);
}

export async function getRecurrenceSuggestions(
  store: RecurrenceStore,
  input: { organizationId: string; supplierId?: string; now: Date },
): Promise<RecurrenceResult> {
  const { transactions, truncated } = await store.listOutflows(input.organizationId, {
    since: recurrenceWindowStart(input.now),
    supplierId: input.supplierId,
    limit: RECURRENCE_MAX_ROWS,
  });
  // Fail-closed: con datos truncados no se afirma ni se descarta una recurrencia.
  if (truncated) return { ok: false, error: "Demasiados movimientos en la ventana; no se puede calcular la recurrencia." };

  const scoped = input.supplierId ? transactions.filter((transaction) => transaction.supplierId === input.supplierId) : transactions;
  return { ok: true, suggestions: detectRecurrences(scoped) };
}

// Insumo para `EngineFacts.recurrenceSuggested`: ¿el historial sugiere pagos recurrentes a este proveedor?
// Si no se puede calcular devuelve false: la regla del motor ya escala igual por falta de autorización.
export async function hasRecurrenceSuggestion(
  store: RecurrenceStore,
  input: { organizationId: string; supplierId: string; now: Date },
): Promise<boolean> {
  const result = await getRecurrenceSuggestions(store, input);
  return result.ok && result.suggestions.some((suggestion) => suggestion.supplierId === input.supplierId);
}
