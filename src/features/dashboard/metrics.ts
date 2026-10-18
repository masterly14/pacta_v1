/**
 * Purpose: turn decisions, receipts, authorizations and bank history into dashboard metrics:
 *   decision counts and autonomy, safety catches (reason codes), and the classification of
 *   payments already made outside Pacta (receipts). Facts only: nothing here authorizes a payment.
 * Runs in: anywhere (pure functions, no I/O).
 * Triggered by: dashboard/server.ts#getDashboard.
 * Receives → Returns: plain rows → view models (counts, per-currency sums, receipt status).
 * Talks to: nothing.
 */
import type { DecisionOutcome, PaymentDecision, ReasonCode } from "@/shared/schemas/payment-decision";

type DecisionSource = PaymentDecision["decisionSource"];

export type DecisionRow = {
  invoiceId: string;
  decision: DecisionOutcome;
  decisionSource: DecisionSource;
  reasonCodes: ReasonCode[];
  evaluatedAt: Date;
};

// Las decisiones son append-only: cuenta solo la más reciente de cada factura.
export function latestPerInvoice<T extends Pick<DecisionRow, "invoiceId" | "evaluatedAt">>(rows: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const current = latest.get(row.invoiceId);
    if (current === undefined || row.evaluatedAt > current.evaluatedAt) latest.set(row.invoiceId, row);
  }
  return [...latest.values()];
}

export type DecisionSummary = {
  total: number;
  approved: number;
  requiresApproval: number;
  blocked: number;
  autoApproved: number;
  // Aprobadas automáticamente ÷ facturas decididas; null sin facturas (nunca 0/0).
  autonomyRate: number | null;
};

export function summarizeDecisions(latest: readonly DecisionRow[]): DecisionSummary {
  const count = (outcome: DecisionOutcome) => latest.filter((d) => d.decision === outcome).length;
  const autoApproved = latest.filter((d) => d.decision === "approved" && d.decisionSource === "automatic").length;
  return {
    total: latest.length,
    approved: count("approved"),
    requiresApproval: count("requires_approval"),
    blocked: count("blocked"),
    autoApproved,
    autonomyRate: latest.length === 0 ? null : autoApproved / latest.length,
  };
}

// Motivos que no describen un riesgo detenido: el genérico de escalada y el de aprobación.
const NOT_A_CATCH: ReadonlySet<ReasonCode> = new Set(["HUMAN_APPROVAL_REQUIRED", "AUTO_APPROVAL_RULES_PASSED"]);

export function topReasonCodes(latest: readonly DecisionRow[], limit: number): { code: ReasonCode; count: number }[] {
  const counts = new Map<ReasonCode, number>();
  for (const d of latest) {
    if (d.decision === "approved") continue;
    for (const code of new Set(d.reasonCodes)) {
      if (!NOT_A_CATCH.has(code)) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
    .slice(0, limit);
}

// Importes por moneda en unidades menores enteras; nunca se suman monedas distintas.
export function sumByCurrency(rows: readonly { amountMinor: number | null; currency: string | null }[]): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const { amountMinor, currency } of rows) {
    if (amountMinor === null || currency === null) continue;
    sums[currency] = (sums[currency] ?? 0) + amountMinor;
  }
  return sums;
}

// ---------------------------------------------------------------------------
// Pagos realizados fuera de Pacta (recibos)
// ---------------------------------------------------------------------------

export type ReceiptRow = {
  invoiceId: string;
  supplierId: string | null;
  invoiceNumber: string | null;
  amountMinor: number | null;
  currency: string | null;
  // Fechas de calendario YYYY-MM-DD; paidOn puede faltar en el documento.
  paidOn: string | null;
  receivedOn: string;
};

export type ReceiptFacts = {
  approvedDecisions: readonly { supplierId: string | null; invoiceNumber: string | null }[];
  // Solo autorizaciones recurrentes activas.
  recurringAuthorizations: readonly {
    supplierId: string;
    currency: string;
    maxAmountMinor: number;
    validFrom: string;
    validUntil: string;
  }[];
  // Proveedores con recurrencia sugerida por el historial CSV (sugerencia, no permiso).
  recurringSupplierIds: ReadonlySet<string>;
  // Salidas del banco en valor absoluto.
  bankOutflows: readonly { supplierId: string; amountMinor: number; currency: string; postedOn: string }[];
  receiptCountBySupplier: ReadonlyMap<string, number>;
};

export type ReceiptStatus = "approved_in_pacta" | "covered_by_authorization" | "unapproved";
export type ReceiptSignal = "likely_recurring" | "bank_confirmed" | "supplier_unknown";

export const BANK_MATCH_WINDOW_DAYS = 5;

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;

// Fecha efectiva del pago: la del recibo o, si no consta, la de recepción del correo.
export const receiptDate = (receipt: Pick<ReceiptRow, "paidOn" | "receivedOn">) => receipt.paidOn ?? receipt.receivedOn;

export function classifyReceipt(receipt: ReceiptRow, facts: ReceiptFacts): { status: ReceiptStatus; signals: ReceiptSignal[] } {
  const { supplierId, invoiceNumber, amountMinor, currency } = receipt;
  const date = receiptDate(receipt);

  let status: ReceiptStatus = "unapproved";
  if (
    supplierId !== null &&
    invoiceNumber !== null &&
    facts.approvedDecisions.some((d) => d.supplierId === supplierId && d.invoiceNumber?.trim() === invoiceNumber.trim())
  ) {
    status = "approved_in_pacta";
  } else if (
    supplierId !== null &&
    amountMinor !== null &&
    facts.recurringAuthorizations.some(
      (a) => a.supplierId === supplierId && a.currency === currency && amountMinor <= a.maxAmountMinor && a.validFrom <= date && date <= a.validUntil,
    )
  ) {
    status = "covered_by_authorization";
  }

  const signals: ReceiptSignal[] = [];
  if (supplierId === null) {
    signals.push("supplier_unknown");
  } else {
    if (facts.recurringSupplierIds.has(supplierId) || (facts.receiptCountBySupplier.get(supplierId) ?? 0) >= 2) {
      signals.push("likely_recurring");
    }
    if (
      amountMinor !== null &&
      facts.bankOutflows.some(
        (t) => t.supplierId === supplierId && t.currency === currency && t.amountMinor === amountMinor && daysBetween(t.postedOn, date) <= BANK_MATCH_WINDOW_DAYS,
      )
    ) {
      signals.push("bank_confirmed");
    }
  }
  return { status, signals };
}
