import type { InboxSignal } from "../schemas/inbox-signal";

// Lectura de señales ya validadas. El motor no abre Gmail.
// Una señal descartada no se entrega: la revisión humana ya la retiró.
// Las que se entregan solo pueden aumentar la cautela.

export type InboxSignalPeriod = {
  periodStart: string;
  periodEnd: string;
};

export type InboxSignals = {
  listForCounterparties(organizationId: string, refs: readonly string[], period: InboxSignalPeriod): readonly InboxSignal[];
};
