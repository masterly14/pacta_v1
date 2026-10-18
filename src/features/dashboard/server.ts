/**
 * Purpose: load everything the platform dashboard shows for one organization: this month's
 *   decisions and autonomy, budget use, safety catches, pending approvals, totals of payments
 *   already made outside Pacta (receipts) and recurring charges without a recurring authorization;
 *   plus the full list of those outside payments for their detail page.
 * Runs in: server (Node).
 * Triggered by: /platform (dashboard) and /platform/outside-payments (detail).
 * Receives → Returns: (organizationId, now) → Dashboard; (organizationId, filters) → OutsidePayments.
 * Talks to: db (PaymentDecision, PaymentPolicy, ApprovalRequest, Invoice, PaymentAuthorization,
 *   BankTransaction, Supplier), decisions/load-facts#loadBudgetUsed, payment-history recurrence, ./metrics.ts.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { loadBudgetUsed } from "@/features/decisions/load-facts";
import { monthBoundsUtc } from "@/features/decisions/periods";
import { getRecurrenceSuggestions, recurrenceWindowStart } from "@/features/payment-history/recurrence/recurrence-service";
import { createPrismaRecurrenceStore } from "@/features/payment-history/suppliers/prisma-store";
import type { RecurrenceSuggestion } from "@/features/payment-history/schemas/history-queries";
import { ReasonCodeSchema, type ReasonCode } from "@/shared/schemas/payment-decision";
import {
  classifyReceipt,
  dailyCounts,
  dailyDecisionSeries,
  latestPerInvoice,
  sumByCurrency,
  summarizeDecisions,
  summarizeReceipts,
  topReasonCodes,
  utcDayRange,
  type ClassifiedReceipt,
  type ReceiptFacts,
  type ReceiptStatus,
} from "./metrics";

const TOP_REASONS = 6;
const TOP_SUPPLIERS = 3;
const TREND_DAYS = 30;
// Tope de seguridad de recibos por consulta; el resumen avisa si se alcanza.
const MAX_RECEIPTS = 1000;
export const OUTSIDE_PAYMENTS_PAGE = 200;

// Fechas de calendario (@db.Date) se guardan como medianoche UTC.
const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

function parseReasonCodes(value: unknown): ReasonCode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((code) => {
    const parsed = ReasonCodeSchema.safeParse(code);
    return parsed.success ? [parsed.data] : [];
  });
}

type RecurringContext = {
  recurringAuthorizations: ReceiptFacts["recurringAuthorizations"];
  recurrence: { ok: true; suggestions: RecurrenceSuggestion[] } | { ok: false; error: string };
};

// Autorizaciones recurrentes activas y recurrencias sugeridas por el historial CSV.
async function loadRecurringContext(organizationId: string, now: Date): Promise<RecurringContext> {
  const authorizations = await db.paymentAuthorization.findMany({
    where: { organizationId, status: "active", scope: "recurring" },
    select: { supplierId: true, currency: true, maxAmountMinor: true, validFrom: true, validUntil: true },
  });
  const recurrence = await getRecurrenceSuggestions(createPrismaRecurrenceStore(), { organizationId, now });
  return {
    recurringAuthorizations: authorizations.map((a) => ({
      supplierId: a.supplierId,
      currency: a.currency,
      maxAmountMinor: a.maxAmountMinor,
      validFrom: fromDbDate(a.validFrom),
      validUntil: fromDbDate(a.validUntil),
    })),
    recurrence,
  };
}

// Recibos (pagos que el documento acredita como ya realizados) clasificados frente a Pacta.
async function loadClassifiedReceipts(
  organizationId: string,
  now: Date,
  context: RecurringContext,
  where: Prisma.InvoiceWhereInput,
  take: number,
): Promise<{ receipts: (ClassifiedReceipt & { extractedName: string | null; paymentMethod: string | null })[]; truncated: boolean }> {
  const rows = await db.invoice.findMany({
    where: { ...where, organizationId, documentKind: "receipt" },
    orderBy: [{ paidOn: { sort: "desc", nulls: "last" } }, { receivedAt: "desc" }],
    take: take + 1,
    include: { supplier: { select: { name: true } } },
  });
  const truncated = rows.length > take;
  const receiptRows = rows.slice(0, take);

  const supplierIds = [...new Set(receiptRows.map((r) => r.supplierId).filter((id): id is string => id !== null))];
  const approvedDecisions = supplierIds.length === 0
    ? []
    : await db.paymentDecision.findMany({
        where: { organizationId, decision: "approved", supplierId: { in: supplierIds } },
        select: { supplierId: true, invoiceNumber: true },
      });
  const bankOutflows = supplierIds.length === 0
    ? []
    : await db.bankTransaction.findMany({
        where: { organizationId, supplierId: { in: supplierIds }, amountMinor: { lt: 0 }, postedOn: { gte: new Date(`${recurrenceWindowStart(now)}T00:00:00Z`) } },
        select: { supplierId: true, amountMinor: true, currency: true, postedOn: true },
      });
  const receiptCounts = await db.invoice.groupBy({
    by: ["supplierId"],
    where: { organizationId, documentKind: "receipt", supplierId: { not: null } },
    _count: { _all: true },
  });

  const suggestions = context.recurrence.ok ? context.recurrence.suggestions : [];
  const facts: ReceiptFacts = {
    approvedDecisions,
    recurringAuthorizations: context.recurringAuthorizations,
    recurringSupplierIds: new Set(suggestions.map((s) => s.supplierId).filter((id): id is string => id !== null)),
    bankOutflows: bankOutflows.map((t) => ({ supplierId: t.supplierId as string, amountMinor: -t.amountMinor, currency: t.currency, postedOn: fromDbDate(t.postedOn) })),
    receiptCountBySupplier: new Map(receiptCounts.map((c) => [c.supplierId as string, c._count._all])),
  };

  const receipts = receiptRows.map((r) => {
    const row = {
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
  return { receipts, truncated };
}

// Recibos del mes: fecha de pago en el mes o, si no consta, fecha de recepción en el mes.
function receiptsInMonth(now: Date): Prisma.InvoiceWhereInput {
  const { start, endExclusive } = monthBoundsUtc(now);
  return {
    OR: [
      { paidOn: { gte: start, lt: endExclusive } },
      { paidOn: null, receivedAt: { gte: start, lt: endExclusive } },
    ],
  };
}

export async function getDashboard(organizationId: string, now: Date = new Date()) {
  const { start, endExclusive } = monthBoundsUtc(now);
  const today = fromDbDate(now);

  // Decisiones del mes: la más reciente de cada factura.
  const monthDecisions = await db.paymentDecision.findMany({
    where: { organizationId, evaluatedAt: { gte: start, lt: endExclusive } },
    select: { invoiceId: true, decision: true, decisionSource: true, reasonCodes: true, evaluatedAt: true },
  });
  const latest = latestPerInvoice(monthDecisions.map((d) => ({ ...d, reasonCodes: parseReasonCodes(d.reasonCodes) })));

  // Tendencias de los últimos 30 días: decisiones por día (la más reciente de cada factura) y facturas recibidas.
  const days = utcDayRange(now, TREND_DAYS);
  const trendStart = new Date(`${days[0]}T00:00:00Z`);
  const trendDecisions = await db.paymentDecision.findMany({
    where: { organizationId, evaluatedAt: { gte: trendStart } },
    select: { invoiceId: true, decision: true, evaluatedAt: true },
  });
  const received = await db.invoice.findMany({
    where: { organizationId, receivedAt: { gte: trendStart } },
    select: { receivedAt: true },
  });

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

  const context = await loadRecurringContext(organizationId, now);
  const month = await loadClassifiedReceipts(organizationId, now, context, receiptsInMonth(now), MAX_RECEIPTS);
  const allReceipts = await db.invoice.count({ where: { organizationId, documentKind: "receipt" } });

  // Suscripciones del historial sin autorización recurrente vigente para ese proveedor.
  const suggestions = context.recurrence.ok ? context.recurrence.suggestions : [];
  const authorizedToday = new Set(context.recurringAuthorizations.filter((a) => a.validFrom <= today && today <= a.validUntil).map((a) => a.supplierId));
  const unauthorized = suggestions.filter((s) => s.supplierId === null || !authorizedToday.has(s.supplierId));
  const supplierIds = unauthorized.map((s) => s.supplierId).filter((id): id is string => id !== null);
  const suppliers = supplierIds.length === 0
    ? []
    : await db.supplier.findMany({ where: { organizationId, id: { in: supplierIds } }, select: { id: true, name: true } });
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

  return {
    month: fromDbDate(start).slice(0, 7),
    decisions: summarizeDecisions(latest),
    trends: {
      days: TREND_DAYS,
      decisionsByDay: dailyDecisionSeries(latestPerInvoice(trendDecisions), days),
      receivedByDay: dailyCounts(received.map((r) => r.receivedAt), days),
    },
    safetyCatches: topReasonCodes(latest, TOP_REASONS),
    budget: policy === null || budgetUsedMinor === null
      ? null
      : { currency: policy.currency, monthlyBudgetMinor: policy.monthlyBudgetMinor, usedMinor: budgetUsedMinor, policyVersion: policy.version },
    pending: {
      count: pendingRequests.length,
      oldestRequestedAt: pendingRequests[0]?.requestedAt.toISOString() ?? null,
      amountByCurrency: sumByCurrency(pendingRequests.map((p) => p.decision)),
    },
    outsidePayments: {
      month: summarizeReceipts(month.receipts, TOP_SUPPLIERS),
      truncated: month.truncated,
      allTimeCount: allReceipts,
    },
    subscriptions: {
      available: context.recurrence.ok,
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

// Detalle: los recibos más recientes (hasta OUTSIDE_PAYMENTS_PAGE), opcionalmente de un estado.
// El estado se calcula en código (cruza decisiones, autorizaciones y banco), así que se filtra
// después de clasificar sobre una ventana de MAX_RECEIPTS recibos.
export async function listOutsidePayments(organizationId: string, filters: { status: ReceiptStatus | null }, now: Date = new Date()) {
  const context = await loadRecurringContext(organizationId, now);
  const { receipts, truncated } = await loadClassifiedReceipts(organizationId, now, context, {}, MAX_RECEIPTS);
  const matching = filters.status === null ? receipts : receipts.filter((r) => r.status === filters.status);
  return {
    summary: summarizeReceipts(receipts, TOP_SUPPLIERS),
    receipts: matching.slice(0, OUTSIDE_PAYMENTS_PAGE),
    matchingCount: matching.length,
    // true si hay más recibos de los que se pudieron clasificar o mostrar.
    truncated: truncated || matching.length > OUTSIDE_PAYMENTS_PAGE,
  };
}

export type OutsidePayments = Awaited<ReturnType<typeof listOutsidePayments>>;
