/**
 * Purpose: read invoices for the platform: the inbox (with each invoice's latest decision) and
 *   one invoice's detail (extracted context, evidence, decisions, pending approval). Receipts
 *   (payments already made) carry their paid date and masked method instead of a decision.
 * Runs in: server (Node).
 * Triggered by: /platform/invoices and /platform/invoices/[id].
 * Receives → Returns: (organizationId, { page }) → one page of inbox rows + totals;
 *   (organizationId, invoiceId) → detail | null.
 * Talks to: db (Invoice, Supplier, PaymentDecision, ApprovalRequest), shared Zod schemas.
 */
import { clampPage } from "@/components/platform/page-window";
import { db } from "@/lib/db";
import { notArchived } from "@/features/decisions/archive";
import { InvoiceContextSchema } from "@/shared/schemas/invoice-context";
import { PaymentDecisionSchema } from "@/shared/schemas/payment-decision";

export const INVOICES_PAGE_SIZE = 20;

export async function listInvoices(organizationId: string, options: { page?: unknown; pageSize?: number } = {}) {
  const pageSize = options.pageSize ?? INVOICES_PAGE_SIZE;
  // Las archivadas (pruebas, correos que no son facturas) no se listan; siguen en la base.
  const where = { organizationId, id: await notArchived(organizationId) };
  const total = await db.invoice.count({ where });
  const { page, pageCount } = clampPage(options.page, total, pageSize);
  const invoices = await db.invoice.findMany({
    where,
    // id desempata facturas recibidas en el mismo instante: el orden entre páginas es estable.
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { supplier: { select: { name: true } } },
  });
  const decisions = await db.paymentDecision.findMany({
    where: { organizationId, invoiceId: { in: invoices.map((i) => i.id) } },
    orderBy: { evaluatedAt: "desc" },
    select: { invoiceId: true, decision: true, decisionSource: true },
  });
  const latest = new Map<string, (typeof decisions)[number]>();
  for (const d of decisions) if (!latest.has(d.invoiceId)) latest.set(d.invoiceId, d);

  const rows = invoices.map((invoice) => ({
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
    documentKind: invoice.documentKind,
    paidOn: invoice.paidOn?.toISOString().slice(0, 10) ?? null,
    paymentMethod: invoice.paymentMethod,
    decision: latest.get(invoice.id) ?? null,
  }));
  return { rows, total, page, pageCount, pageSize };
}

export type InvoiceRow = Awaited<ReturnType<typeof listInvoices>>["rows"][number];

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
    where: { organizationId, invoiceId, status: "pending" },
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
    documentKind: invoice.documentKind,
    paidOn: invoice.paidOn?.toISOString().slice(0, 10) ?? null,
    paymentMethod: invoice.paymentMethod,

    context: parsed?.success ? parsed.data : null,
    decisions: decisions.map((d) => ({ ...PaymentDecisionSchema.parse(d.payload), actorId: d.actorId })),
    hasPendingApproval: pendingRequest !== null,
  };
}

export type InvoiceDetail = NonNullable<Awaited<ReturnType<typeof getInvoiceDetail>>>;
