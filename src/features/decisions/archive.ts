/**
 * Purpose: hide invoices from the platform's lists, charts and approvals without deleting anything
 *   (old tests, simulator runs, non-invoice emails). Read side: the ids to exclude. Write side:
 *   archive a set of invoice ids with a reason and an audit event. The decision engine does NOT
 *   read this: duplicates and budget keep counting archived invoices (stricter, never looser).
 * Runs in: server (Node).
 * Triggered by: invoices, approvals, audit and dashboard queries; maintenance scripts.
 * Receives → Returns: organizationId → archived invoice ids; (organizationId, ids, reason) → count.
 * Talks to: db (ArchivedInvoice, AuditEvent).
 */
import { db } from "@/lib/db";

export async function listArchivedInvoiceIds(organizationId: string): Promise<string[]> {
  const rows = await db.archivedInvoice.findMany({ where: { organizationId }, select: { invoiceId: true } });
  return rows.map((row) => row.invoiceId);
}

// Filtro Prisma para excluir las archivadas de un campo `invoiceId` (o `id` en la tabla invoices).
export async function notArchived(organizationId: string): Promise<{ notIn: string[] }> {
  return { notIn: await listArchivedInvoiceIds(organizationId) };
}

export async function archiveInvoices(
  organizationId: string,
  invoiceIds: readonly string[],
  reason: string,
  archivedBy: string | null,
): Promise<number> {
  const unique = [...new Set(invoiceIds)];
  if (unique.length === 0) return 0;
  return db.$transaction(async (tx) => {
    const created = await tx.archivedInvoice.createMany({
      data: unique.map((invoiceId) => ({ organizationId, invoiceId, reason, archivedBy })),
      skipDuplicates: true,
    });
    await tx.auditEvent.create({
      data: {
        organizationId,
        entityType: "archived_invoice",
        entityId: organizationId,
        eventType: "invoices.archived",
        actorId: archivedBy,
        payload: { reason, count: created.count, invoiceIds: unique },
      },
    });
    return created.count;
  });
}
