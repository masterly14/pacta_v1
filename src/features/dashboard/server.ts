/**
 * Purpose: load everything the platform dashboard shows for one organization: this month's
 *   decisions and autonomy, budget use, safety catches, pending approvals, payments already made
 *   outside Pacta (receipts) and recurring charges without a recurring authorization.
 * Runs in: server (Node).
 * Triggered by: /platform (dashboard page).
 * Receives → Returns: (organizationId, now) → Dashboard view model.
 * Talks to: db (PaymentDecision, PaymentPolicy, ApprovalRequest, Invoice, PaymentAuthorization,
 *   BankTransaction, Supplier), decisions/load-facts#loadBudgetUsed, payment-history recurrence, ./metrics.ts.
 */
import { db } from "@/lib/db";
import { loadBudgetUsed } from "@/features/decisions/load-facts";
import { monthBoundsUtc } from "@/features/decisions/periods";
import { getRecurrenceSuggestions, recurrenceWindowStart } from "@/features/payment-history/recurrence/recurrence-service";
import { createPrismaRecurrenceStore } from "@/features/payment-history/suppliers/prisma-store";
import { ReasonCodeSchema, type ReasonCode } from "@/shared/schemas/payment-decision";
import {
  classifyReceipt,
  latestPerInvoice,
  receiptDate,
  sumByCurrency,
  summarizeDecisions,
  topReasonCodes,
  type ReceiptFacts,
  type ReceiptRow,
} from "./metrics";

const RECEIPTS_SHOWN = 50;
const TOP_REASONS = 6;

// Fechas de calendario (@db.Date) se guardan como medianoche UTC.
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

function parseReasonCodes(value: unknown): ReasonCode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((code) => {
    const parsed = ReasonCodeSchema.safeParse(code);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function getDashboard(organizationId: string, now: Date = new Date()) {
  const { start, endExclusive } = monthBoundsUtc(now);
  const today = fromDbDate(now);
  const monthStart = fromDbDate(start);

  // Decisiones del mes: la más reciente de cada factura.
  const monthDecisions = await db.paymentDecision.findMany({
    where: { organizationId, evaluatedAt: { gte: start, lt: endExclusive } },
    select: { invoiceId: true, decision: true, decisionSource: true, reasonCodes: true, evaluatedAt: true },
  });
  const latest = latestPerInvoice(monthDecisions.map((d) => ({ ...d, reasonCodes: parseReasonCodes(d.reasonCodes) })));

  const policy = await db.paymentPolicy.findFirst({
    where: { organizationId, effectiveFrom: { lte: now } },
    orderBy: { version: "desc" },
  });
  const budgetUsedMinor = policy === null ? null : await loadBudgetUsed(db, organizationId, policy.currency, now);

  const pendingRequests = await db.approvalRequest.findMany({
    where: { organizationId, status: "pending" },
    orderBy: { requestedAt: "asc" },
    select: { requestedAt: true, decision: { select: { amountMinor: true, currency: true } } },
  });

  // Autorizaciones recurrentes activas: cubren recibos y descartan suscripciones "sin autorizar".
  const authorizations = await db.paymentAuthorization.findMany({
    where: { organizationId, status: "active", scope: "recurring" },
    select: { supplierId: true, currency: true, maxAmountMinor: true, validFrom: true, validUntil: true },
  });
  const recurringAuthorizations = authorizations.map((a) => ({
    supplierId: a.supplierId,
    currency: a.currency,
    maxAmountMinor: a.maxAmountMinor,
    validFrom: fromDbDate(a.validFrom),
    validUntil: fromDbDate(a.validUntil),
  }));

  const recurrence = await getRecurrenceSuggestions(createPrismaRecurrenceStore(), { organizationId, now });
  const suggestions = recurrence.ok ? recurrence.suggestions : [];

  // Recibos: pagos que el documento acredita como ya realizados.
  const receiptRows = await db.invoice.findMany({
    where: { organizationId, documentKind: "receipt" },
    orderBy: { receivedAt: "desc" },
    take: RECEIPTS_SHOWN,
    include: { supplier: { select: { name: true } } },
  });
  const receiptSupplierIds = [...new Set(receiptRows.map((r) => r.supplierId).filter((id): id is string => id !== null))];
  const approvedDecisions = receiptSupplierIds.length === 0
    ? []
    : await db.paymentDecision.findMany({
        where: { organizationId, decision: "approved", supplierId: { in: receiptSupplierIds } },
        select: { supplierId: true, invoiceNumber: true },
      });
  const bankOutflows = receiptSupplierIds.length === 0
    ? []
    : await db.bankTransaction.findMany({
        where: { organizationId, supplierId: { in: receiptSupplierIds }, amountMinor: { lt: 0 }, postedOn: { gte: new Date(`${recurrenceWindowStart(now)}T00:00:00Z`) } },
        select: { supplierId: true, amountMinor: true, currency: true, postedOn: true },
      });
  const receiptCounts = await db.invoice.groupBy({
    by: ["supplierId"],
    where: { organizationId, documentKind: "receipt", supplierId: { not: null } },
    _count: { _all: true },
  });

  const facts: ReceiptFacts = {
    approvedDecisions,
    recurringAuthorizations,
    recurringSupplierIds: new Set(suggestions.map((s) => s.supplierId).filter((id): id is string => id !== null)),
    bankOutflows: bankOutflows.map((t) => ({ supplierId: t.supplierId as string, amountMinor: -t.amountMinor, currency: t.currency, postedOn: fromDbDate(t.postedOn) })),
    receiptCountBySupplier: new Map(receiptCounts.map((c) => [c.supplierId as string, c._count._all])),
  };

  const receipts = receiptRows.map((r) => {
    const row: ReceiptRow = {
      invoiceId: r.id,
      supplierId: r.supplierId,
      invoiceNumber: r.invoiceNumber,
      amountMinor: r.amountMinor,
      currency: r.currency,
      paidOn: r.paidOn === null ? null : fromDbDate(r.paidOn),
      receivedOn: fromDbDate(r.receivedAt),
    };
    return {
      ...row,
      supplierName: r.supplier?.name ?? null,
      extractedName: r.name,
      paymentMethod: r.paymentMethod,
      ...classifyReceipt(row, facts),
    };
  });
  const unapprovedThisMonth = receipts.filter((r) => r.status === "unapproved" && receiptDate(r) >= monthStart && receiptDate(r) <= today);

  // Suscripciones del historial sin autorización recurrente vigente para ese proveedor.
  const authorizedToday = new Set(recurringAuthorizations.filter((a) => a.validFrom <= today && today <= a.validUntil).map((a) => a.supplierId));
  const unauthorized = suggestions.filter((s) => s.supplierId === null || !authorizedToday.has(s.supplierId));
  const supplierIds = unauthorized.map((s) => s.supplierId).filter((id): id is string => id !== null);
  const suppliers = supplierIds.length === 0
    ? []
    : await db.supplier.findMany({ where: { organizationId, id: { in: supplierIds } }, select: { id: true, name: true } });
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

  return {
    month: monthStart.slice(0, 7),
    decisions: summarizeDecisions(latest),
    safetyCatches: topReasonCodes(latest, TOP_REASONS),
    budget: policy === null || budgetUsedMinor === null
      ? null
      : { currency: policy.currency, monthlyBudgetMinor: policy.monthlyBudgetMinor, usedMinor: budgetUsedMinor, policyVersion: policy.version },
    pending: {
      count: pendingRequests.length,
      oldestRequestedAt: pendingRequests[0]?.requestedAt.toISOString() ?? null,
      amountByCurrency: sumByCurrency(pendingRequests.map((p) => p.decision)),
    },
    receipts,
    unapprovedThisMonth: { count: unapprovedThisMonth.length, amountByCurrency: sumByCurrency(unapprovedThisMonth) },
    subscriptions: {
      available: recurrence.ok,
      unauthorized: unauthorized.map((s) => ({
        supplierId: s.supplierId,
        name: s.supplierId === null ? s.counterpartyNormalized : (supplierName.get(s.supplierId) ?? s.counterpartyNormalized),
        cadence: s.cadence,
        typicalAmountMinor: s.typicalAmountMinor,
        currency: s.currency,
        occurrences: s.occurrences,
        lastPostedOn: s.lastPostedOn,
      })),
    },
  };
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;
