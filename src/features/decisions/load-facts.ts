/**
 * Purpose: load from the database every fact the engine needs to decide on one invoice,
 *   always scoped by organizationId, inside the caller's transaction.
 * Runs in: server (Node), inside evaluateInvoice()'s transaction.
 * Triggered by: server.ts#evaluateInvoice.
 * Receives → Returns: (tx, InvoiceContext, { now, decisionId }) → EngineFacts (plain data for decide()).
 * Talks to: PaymentPolicy, PaymentAuthorization, PaymentDecision, Document, GmailInboundMessage,
 *   BankTransaction (read only, via the payment-history recurrence store); ./periods.ts.
 */
import type { Prisma } from "@prisma/client";
import { hasRecurrenceSuggestion, type RecurrenceStore } from "@/features/payment-history/recurrence/recurrence-service";
import { createPrismaRecurrenceStore } from "@/features/payment-history/suppliers/prisma-store";
import type { InvoiceContext } from "@/shared/schemas/invoice-context";
import type { EngineAuthorization, EngineFacts, EnginePriorDecision } from "./engine/facts";
import { monthBoundsUtc, periodBounds } from "./periods";

type Tx = Prisma.TransactionClient;

// Fechas de calendario (@db.Date) se guardan como medianoche UTC.
function toDbDate(calendarDate: string): Date {
  return new Date(`${calendarDate}T00:00:00.000Z`);
}

function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function loadEngineFacts(
  tx: Tx,
  invoice: InvoiceContext,
  options: { now: Date; decisionId: string },
): Promise<EngineFacts> {
  const organizationId = invoice.organizationId;
  const { now, decisionId } = options;

  const policy = await tx.paymentPolicy.findFirst({
    where: { organizationId, effectiveFrom: { lte: now } },
    orderBy: { version: "desc" },
  });

  // Secuencial a propósito: una transacción interactiva usa una sola conexión.
  const authorizations = await loadAuthorizations(tx, invoice, now);
  const priorDecisions = await loadPriorDecisions(tx, invoice);
  const documentDuplicateInvoiceIds = await loadDocumentDuplicates(tx, invoice);
  const budgetUsedMinor = policy === null ? null : await loadBudgetUsed(tx, organizationId, policy.currency, now);
  const recurrenceSuggested = await loadRecurrenceSuggested(createPrismaRecurrenceStore(tx), invoice, now);

  return {
    policy:
      policy === null
        ? null
        : {
            policyId: policy.id,
            version: policy.version,
            autoApprovalLimitMinor: policy.autoApprovalLimitMinor,
            monthlyBudgetMinor: policy.monthlyBudgetMinor,
            currency: policy.currency,
          },
    authorizations,
    priorDecisions,
    documentDuplicateInvoiceIds,
    budgetUsedMinor,
    recurrenceSuggested,
    now: now.toISOString(),
    decisionId,
    traceId: null,
  };
}

// Autorizaciones del proveedor. El motor decide cuáles aplican; aquí se cuenta su uso:
// una aprobación por periodo calendario de la factura (one_time: una en total).
async function loadAuthorizations(tx: Tx, invoice: InvoiceContext, now: Date): Promise<EngineAuthorization[]> {
  if (invoice.supplierId === null) return [];
  const rows = await tx.paymentAuthorization.findMany({
    where: { organizationId: invoice.organizationId, supplierId: invoice.supplierId },
  });
  const referenceDate = invoice.invoiceDate ?? now.toISOString().slice(0, 10);

  const result: EngineAuthorization[] = [];
  for (const auth of rows) {
    // Sin frecuencia solo puede ser one_time (CHECK en la tabla): se cuenta todo su uso.
    const period = auth.scope === "recurring" && auth.frequency !== null ? periodBounds(auth.frequency, referenceDate) : null;
    const approvalsInCurrentPeriod = await tx.paymentDecision.count({
      where: {
        authorizationId: auth.id,
        decision: "approved",
        ...(period === null ? {} : { invoiceDate: { gte: toDbDate(period.start), lte: toDbDate(period.end) } }),
      },
    });
    result.push({
      authorizationId: auth.id,
      supplierId: auth.supplierId,
      beneficiaryAccountRef: auth.beneficiaryAccountRef,
      currency: auth.currency,
      maxAmountMinor: auth.maxAmountMinor,
      scope: auth.scope,
      frequency: auth.frequency,
      validFrom: fromDbDate(auth.validFrom),
      validUntil: fromDbDate(auth.validUntil),
      status: auth.status,
      approvalsInCurrentPeriod,
    });
  }
  return result;
}

async function loadPriorDecisions(tx: Tx, invoice: InvoiceContext): Promise<EnginePriorDecision[]> {
  if (invoice.supplierId === null) return [];
  const rows = await tx.paymentDecision.findMany({
    where: { organizationId: invoice.organizationId, supplierId: invoice.supplierId },
    select: {
      id: true,
      evaluatedAt: true,
      invoiceId: true,
      supplierId: true,
      invoiceNumber: true,
      amountMinor: true,
      invoiceDate: true,
      decision: true,
    },
  });
  return rows.map((row) => ({
    decisionId: row.id,
    evaluatedAt: row.evaluatedAt.toISOString(),
    invoiceId: row.invoiceId,
    supplierId: row.supplierId,
    invoiceNumber: row.invoiceNumber,
    amountMinor: row.amountMinor,
    invoiceDate: row.invoiceDate === null ? null : fromDbDate(row.invoiceDate),
    decision: row.decision,
  }));
}

// Otras facturas con el mismo archivo (sha256) cuya última decisión no es `blocked`.
// Una copia aún sin decisión no cuenta: si no, la primera factura se bloquearía por la segunda.
async function loadDocumentDuplicates(tx: Tx, invoice: InvoiceContext): Promise<string[]> {
  if (invoice.documentId === null) return [];
  const document = await tx.document.findFirst({
    where: { id: invoice.documentId, organizationId: invoice.organizationId },
    select: { id: true, sha256: true },
  });
  if (document === null) return [];

  const sameFile = await tx.document.findMany({
    where: { organizationId: invoice.organizationId, sha256: document.sha256, id: { not: document.id } },
    select: { gmailInboundMessageId: true },
  });
  if (sameFile.length === 0) return [];

  const messages = await tx.gmailInboundMessage.findMany({
    where: { id: { in: sameFile.map((d) => d.gmailInboundMessageId) }, invoiceId: { not: null } },
    select: { invoiceId: true },
  });
  const invoiceIds = [...new Set(messages.map((m) => m.invoiceId).filter((id): id is string => id !== null && id !== invoice.invoiceId))];
  if (invoiceIds.length === 0) return [];

  const decisions = await tx.paymentDecision.findMany({
    where: { organizationId: invoice.organizationId, invoiceId: { in: invoiceIds } },
    orderBy: { evaluatedAt: "desc" },
    select: { invoiceId: true, decision: true },
  });
  const latest = new Map<string, string>();
  for (const d of decisions) if (!latest.has(d.invoiceId)) latest.set(d.invoiceId, d.decision);
  return invoiceIds.filter((id) => latest.has(id) && latest.get(id) !== "blocked");
}

// Presupuesto consumido = aprobaciones del mes calendario UTC en la moneda de la política.
// El historial CSV no cuenta (evita contar dos veces el mismo pago).
async function loadBudgetUsed(tx: Tx, organizationId: string, currency: string, now: Date): Promise<number> {
  const { start, endExclusive } = monthBoundsUtc(now);
  const result = await tx.paymentDecision.aggregate({
    where: { organizationId, decision: "approved", currency, evaluatedAt: { gte: start, lt: endExclusive } },
    _sum: { amountMinor: true },
  });
  return result._sum.amountMinor ?? 0;
}

// Sugerencia del historial CSV. Solo cambia el motivo (RECURRENCE_NOT_AUTHORIZED); nunca autoriza.
// Usa el detector de payment-history (cadencia y tolerancia de monto). Si no se puede calcular, false:
// la regla del motor escala igual por falta de autorización.
export async function loadRecurrenceSuggested(
  store: RecurrenceStore,
  invoice: Pick<InvoiceContext, "organizationId" | "supplierId">,
  now: Date,
): Promise<boolean> {
  if (invoice.supplierId === null) return false;
  return hasRecurrenceSuggestion(store, {
    organizationId: invoice.organizationId,
    supplierId: invoice.supplierId,
    now,
  });
}
