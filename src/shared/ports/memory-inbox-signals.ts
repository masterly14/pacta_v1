import { InboxSignalSchema, type InboxSignal } from "../schemas/inbox-signal";
import type { InboxSignalPeriod, InboxSignals } from "./inbox-signals";

export function createMemoryInboxSignals(signals: readonly unknown[]): InboxSignals {
  const stored = signals.map((signal) => InboxSignalSchema.parse(signal));
  return {
    listForCounterparties(organizationId, refs, period) {
      const wanted = new Set(refs);
      return stored.filter((signal) => matches(signal, organizationId, wanted, period));
    },
  };
}

function matches(signal: InboxSignal, organizationId: string, refs: ReadonlySet<string>, period: InboxSignalPeriod): boolean {
  if (signal.organizationId !== organizationId) return false;
  if (signal.status === "dismissed") return false;
  if (signal.subjectRef === null || signal.subjectRef.type !== "counterparty" || !refs.has(signal.subjectRef.id)) return false;
  if (signal.kind !== "tax_settlement") return true;
  const { periodStart, periodEnd } = signal.payload;
  if (periodStart === null || periodEnd === null) return true;
  return periodStart <= period.periodEnd && periodEnd >= period.periodStart;
}
