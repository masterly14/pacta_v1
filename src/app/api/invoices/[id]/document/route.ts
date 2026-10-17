/**
 * Purpose: GET /api/invoices/[id]/document — stream an invoice's original document from private
 *   storage to an authenticated member of its organization, without exposing the storage URL.
 * Runs in: server (Next.js route handler, Node).
 * Triggered by: the "Ver original" link on /platform/invoices/[id].
 * Receives → Returns: invoice id → file bytes (inline) | 401/403 | 404.
 * Talks to: ensureWorkspaceFromSession, db (Invoice, Document), gmail/r2-store (BlobStorePort.get).
 */
import { NextResponse } from "next/server";
import { createR2Store } from "@/features/invoices/gmail/r2-store";
import { db } from "@/lib/db";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  let organizationId: string;
  try {
    organizationId = (await ensureWorkspaceFromSession()).organization.id;
  } catch (error) {
    if (error instanceof OrganizationRequiredError) return NextResponse.json({ error: error.message }, { status: 403 });
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { id } = await context.params;
  // Factura y documento acotados a la organización de la sesión.
  const invoice = await db.invoice.findFirst({ where: { id, organizationId }, select: { primaryDocumentId: true } });
  const document = invoice?.primaryDocumentId
    ? await db.document.findFirst({ where: { id: invoice.primaryDocumentId, organizationId }, select: { fileRef: true, mimeType: true } })
    : null;
  if (document === null) return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });

  try {
    const stored = await createR2Store().get(document.fileRef);
    return new Response(Buffer.from(stored.body), {
      headers: {
        "Content-Type": document.mimeType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[invoices/document] no se pudo leer el documento", { invoiceId: id, error });
    return NextResponse.json({ error: "No se pudo leer el documento" }, { status: 502 });
  }
}
