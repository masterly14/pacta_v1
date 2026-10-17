import { AMOUNT_TOLERANCE_PERCENT, CADENCE_BANDS, RECURRENCE_MIN_OCCURRENCES, type RecurrenceCadence } from "../config";
import type { BankTransaction } from "../schemas/bank-transaction";
import type { RecurrenceSuggestion } from "../schemas/history-queries";
import { extractCounterpartyKey } from "../suppliers/counterparty-key";

// Detección determinística de pagos recurrentes a partir del historial bancario.
// El resultado es una SUGERENCIA (historial ≠ autorización): solo una acción humana explícita
// puede crear o cambiar una autorización recurrente (CLAUDE.md §6.2).

export type RecurrenceInput = Pick<BankTransaction, "id" | "postedOn" | "amountMinor" | "currency" | "supplierId" | "description">;

export type RecurrenceConfig = {
  minOccurrences: number;
  tolerancePercent: number;
  bands: Record<RecurrenceCadence, { minDays: number; maxDays: number }>;
};

export const DEFAULT_RECURRENCE_CONFIG: RecurrenceConfig = {
  minOccurrences: RECURRENCE_MIN_OCCURRENCES,
  tolerancePercent: AMOUNT_TOLERANCE_PERCENT,
  bands: CADENCE_BANDS,
};

type Payment = { id: string; postedOn: string; amount: number; descriptionKey: string | null };

const MS_PER_DAY = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.floor((sorted[middle - 1] + sorted[middle]) / 2);
}

function cadenceOf(days: number, config: RecurrenceConfig): RecurrenceCadence | null {
  for (const [cadence, band] of Object.entries(config.bands) as [RecurrenceCadence, { minDays: number; maxDays: number }][]) {
    if (days >= band.minDays && days <= band.maxDays) return cadence;
  }
  return null;
}

// Aritmética entera: |a − m| ≤ m × tolerancia %, sin floats.
function withinTolerance(amount: number, reference: number, tolerancePercent: number): boolean {
  return Math.abs(amount - reference) * 100 <= reference * tolerancePercent;
}

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

type Run = { payments: Payment[]; cadence: RecurrenceCadence; typical: number };

// Última racha válida: termina lo más tarde posible, con intervalos en una misma banda y montos ±tolerancia.
function findLatestRun(payments: Payment[], config: RecurrenceConfig): Run | null {
  for (let end = payments.length - 1; end >= config.minOccurrences - 1; end--) {
    const cadence = cadenceOf(daysBetween(payments[end - 1].postedOn, payments[end].postedOn), config);
    if (cadence === null) continue;

    let start = end;
    while (start > 0 && cadenceOf(daysBetween(payments[start - 1].postedOn, payments[start].postedOn), config) === cadence) {
      start--;
    }
    const candidate = payments.slice(start, end + 1);
    const reference = median(candidate.map((payment) => payment.amount));

    // Se conserva el tramo final cuyos montos están dentro de la tolerancia.
    let from = candidate.length;
    while (from > 0 && withinTolerance(candidate[from - 1].amount, reference, config.tolerancePercent)) from--;
    const run = candidate.slice(from);
    if (run.length < config.minOccurrences) continue;

    return { payments: run, cadence, typical: median(run.map((payment) => payment.amount)) };
  }
  return null;
}

export function detectRecurrences(
  transactions: readonly RecurrenceInput[],
  config: RecurrenceConfig = DEFAULT_RECURRENCE_CONFIG,
): RecurrenceSuggestion[] {
  type Group = { supplierId: string | null; currency: string; key: string | null; items: Payment[] };
  const groups = new Map<string, Group>();

  for (const transaction of transactions) {
    if (transaction.amountMinor >= 0) continue; // solo salidas
    const descriptionKey = extractCounterpartyKey(transaction.description);
    const identity = transaction.supplierId ? `s:${transaction.supplierId}` : descriptionKey ? `k:${descriptionKey}` : null;
    if (identity === null) continue; // sin contraparte identificable no se puede agrupar

    const groupId = `${identity}|${transaction.currency}`;
    const group = groups.get(groupId) ?? {
      supplierId: transaction.supplierId,
      currency: transaction.currency,
      key: transaction.supplierId ? null : descriptionKey,
      items: [],
    };
    group.items.push({
      id: transaction.id,
      postedOn: transaction.postedOn,
      amount: Math.abs(transaction.amountMinor),
      descriptionKey,
    });
    groups.set(groupId, group);
  }

  const suggestions: RecurrenceSuggestion[] = [];
  for (const group of groups.values()) {
    const sorted = [...group.items].sort((a, b) => (a.postedOn === b.postedOn ? a.id.localeCompare(b.id) : a.postedOn < b.postedOn ? -1 : 1));

    // Mismo día y mismo monto = una sola ocurrencia (cargo duplicado o doble apunte del banco).
    const seen = new Set<string>();
    const payments = sorted.filter((payment) => {
      const signature = `${payment.postedOn}|${payment.amount}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
    if (payments.length < config.minOccurrences) continue;

    const run = findLatestRun(payments, config);
    if (run === null) continue;

    const counterparty =
      group.key ?? mostCommon(run.payments.map((payment) => payment.descriptionKey)) ?? `supplier:${group.supplierId}`;
    suggestions.push({
      groupKind: group.supplierId ? "supplier" : "unlinked_counterparty",
      counterpartyNormalized: counterparty,
      supplierId: group.supplierId,
      cadence: run.cadence,
      typicalAmountMinor: run.typical,
      currency: group.currency,
      occurrences: run.payments.length,
      transactionIds: run.payments.map((payment) => payment.id),
      firstPostedOn: run.payments[0].postedOn,
      lastPostedOn: run.payments[run.payments.length - 1].postedOn,
      isSuggestionOnly: true,
    });
  }

  return suggestions.sort((a, b) =>
    a.lastPostedOn === b.lastPostedOn
      ? a.counterpartyNormalized.localeCompare(b.counterpartyNormalized)
      : a.lastPostedOn < b.lastPostedOn
        ? 1
        : -1,
  );
}
