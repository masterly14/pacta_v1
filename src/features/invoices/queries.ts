/**
 * Purpose: read invoices for the platform: the inbox (with each invoice's latest decision) and
 *   one invoice's detail (extracted context, evidence, decisions, pending approval).
 * Runs in: server (Node).
 * Triggered by: /platform/invoices and /platform/invoices/[id].
 * Receives → Returns: organizationId → inbox rows; (organizationId, invoiceId) → detail | null.
 * Talks to: db (Invoice, Supplier, PaymentDecision, ApprovalRequest), shared Zod schemas.
 */
import { db } from "@/lib/db";
import { InvoiceContextSchema } from "@/shared/schemas/invoice-context";
import { PaymentDecisionSchema } from "@/shared/schemas/payment-decision";

export async function listInvoices(organizationId: string, take = 50) {
  const invoices = await db.invoice.findMany({
    where: { organizationId },
    orderBy: { receivedAt: "desc" },
    take,
    include: { supplier: { select: { name: true } } },
  });
  const decisions = await db.paymentDecision.findMany({
    where: { organizationId, invoiceId: { in: invoices.map((i) => i.id) } },
    orderBy: { evaluatedAt: "desc" },
    select: { invoiceId: true, decision: true, decisionSource: true },
  });
  const latest = new Map<string, (typeof decisions)[number]>();
  for (const d of decisions) if (!latest.has(d.invoiceId)) latest.set(d.invoiceId, d);

  return invoices.map((invoice) => ({
    id: invoice.id,
    source: invoice.source,
    receivedAt: invoice.receivedAt.toISOString(),
    extractionStatus: invoice.extractionStatus,
    extractionError: invoice.extractionError,
    supplierName: invoice.supplier?.name ?? null,
    extractedName: invoice.name,
    supplierMatchStatus: invoice.supplierMatchStatus,
    invoiceNumber: invoice.invoiceNumber,
    amountMinor: invoice.amountMinor,
    currency: invoice.currency,
    decision: latest.get(invoice.id) ?? null,
  }));
}

export type InvoiceRow = Awaited<ReturnType<typeof listInvoices>>[number];

export async function getInvoiceDetail(organizationId: string, invoiceId: string) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: { supplier: { select: { name: true } } },
  });
  if (invoice === null) return null;

  const parsed = invoice.contextJson === null ? null : InvoiceContextSchema.safeParse(invoice.contextJson);
  const decisions = await db.paymentDecision.findMany({
    where: { organizationId, invoiceId },
    orderBy: { evaluatedAt: "desc" },
  });
  const pendingRequest = await db.approvalRequest.findFirst({
    where: { organizationId, invoiceId, status: "pendiente" },
    select: { id: true },
  });

  return {
    id: invoice.id,
    source: invoice.source,
    receivedAt: invoice.receivedAt.toISOString(),
    extractionStatus: invoice.extractionStatus,
    extractionError: invoice.extractionError,
    supplierName: invoice.supplier?.name ?? null,
    hasOriginal: invoice.primaryDocumentId !== null,
    context: parsed?.success ? parsed.data : null,
    decisions: decisions.map((d) => ({ ...PaymentDecisionSchema.parse(d.payload), actorId: d.actorId })),
    hasPendingApproval: pendingRequest !== null,
  };
}

export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoiceDetail>>>;
