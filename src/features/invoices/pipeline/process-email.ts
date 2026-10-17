/**
 * Purpose: turn a downloaded Gmail message into invoices: one processInvoice() call per
 *   `invoice_candidate` document group, reading the documents back from R2.
 * Runs in: server (Node).
 * Triggered by: the Composio webhook and the download retry route, after downloadGmailMessage()
 *   leaves the message `received`; also reprocessInvoice() for a failed email invoice.
 * Receives → Returns: inboundId → { status, results } (one ProcessResult per candidate group).
 * Talks to: db (GmailInboundMessage, DocumentGroup, Document, Invoice), gmail/r2-store (BlobStorePort),
 *   extraction/ai-deps#createExtractDeps, ./process-invoice.ts.
 */
import { db } from "@/lib/db";
import { createExtractDeps } from "../extraction/ai-deps";
import type { ExtractDeps } from "../extraction/extract-invoice";
import type { SourceDocument } from "../extraction/read-document";
import type { EmailMetadata } from "../extraction/to-invoice-context";
import type { BlobStorePort } from "../gmail/ports";
import { createR2Store } from "../gmail/r2-store";
import { processInvoice, type ProcessResult } from "./process-invoice";

export type EmailPipelineDeps = {
  blob?: BlobStorePort;
  extract?: (context: { organizationId: string; inboundMessageId: string }) => ExtractDeps;
};

// "Proveedor X <facturas@x.com>" → nombre y correo; un correo suelto no trae nombre.
export function parseSender(sender: string | null): { senderName: string | null; senderEmail: string | null } {
  if (sender === null || sender.trim() === "") return { senderName: null, senderEmail: null };
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(sender);
  if (match) return { senderName: match[1].trim() || null, senderEmail: match[2].trim() };
  return sender.includes("@") ? { senderName: null, senderEmail: sender.trim() } : { senderName: sender.trim(), senderEmail: null };
}

function documentKind(source: string, mimeType: string): SourceDocument["kind"] {
  if (source === "email_body") return "email_body";
  return mimeType === "application/pdf" ? "pdf" : "image";
}

const withoutMillis = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

type GroupWithDocuments = Awaited<ReturnType<typeof loadCandidateGroups>>[number];

function loadCandidateGroups(inboundId: string) {
  return db.documentGroup.findMany({
    where: { gmailInboundMessageId: inboundId, kind: "invoice_candidate" },
    orderBy: { createdAt: "asc" },
    include: { documents: true },
  });
}

async function processGroup(
  inbound: { id: string; organizationId: string; gmailConnectionId: string; gmailMessageId: string; sender: string | null; subject: string | null; receivedAt: Date },
  group: GroupWithDocuments,
  blob: BlobStorePort,
  extract: ExtractDeps,
): Promise<ProcessResult> {
  const primary = group.documents.find((d) => d.groupRole === "primary") ?? group.documents[0];
  const documents: SourceDocument[] = [];
  for (const doc of group.documents) {
    const stored = await blob.get(doc.fileRef);
    const kind = documentKind(doc.source, doc.mimeType);
    documents.push(
      kind === "email_body"
        ? { documentId: doc.id, kind, mediaType: "text/plain", bytes: null, text: new TextDecoder().decode(stored.body) }
        : { documentId: doc.id, kind, mediaType: doc.mimeType, bytes: stored.body, text: null },
    );
  }
  const metadata: EmailMetadata = {
    ...parseSender(inbound.sender),
    subject: inbound.subject,
    attachmentFilenames: group.documents.filter((d) => d.source !== "email_body").map((d) => d.originalFilename ?? "adjunto"),
  };
  const primaryKind = primary === undefined ? "email_body" : documentKind(primary.source, primary.mimeType);

  return processInvoice(
    {
      // Determinístico por grupo: reprocesar el mismo correo no crea otra factura.
      invoiceId: `inv_${group.id}`,
      organizationId: inbound.organizationId,
      source: "email",
      documentGroupId: group.id,
      gmailInboundMessageId: inbound.id,
      primaryDocumentId: primary?.id ?? null,
      documents,
      metadata,
      meta: {
        sourceAccountId: inbound.gmailConnectionId,
        sourceMessageId: inbound.gmailMessageId,
        documentId: primary?.id ?? null,
        documentType: primaryKind,
        receivedAt: withoutMillis(inbound.receivedAt),
      },
    },
    { extract },
  );
}

export async function processInboundMessage(
  inboundId: string,
  deps: EmailPipelineDeps = {},
): Promise<{ status: "processed" | "skipped"; results: ProcessResult[] }> {
  const inbound = await db.gmailInboundMessage.findUnique({ where: { id: inboundId } });
  // Solo correos ya descargados; `failed`/`ignored` los gestiona la descarga de Gmail.
  if (inbound === null || (inbound.processingStatus !== "received" && inbound.processingStatus !== "processing")) {
    return { status: "skipped", results: [] };
  }
  await db.gmailInboundMessage.update({ where: { id: inbound.id }, data: { processingStatus: "processing" } });

  const blob = deps.blob ?? createR2Store();
  const extract = (deps.extract ?? createExtractDeps)({ organizationId: inbound.organizationId, inboundMessageId: inbound.id });
  const results: ProcessResult[] = [];
  for (const group of await loadCandidateGroups(inbound.id)) {
    try {
      results.push(await processGroup(inbound, group, blob, extract));
    } catch (error) {
      console.error("[invoices/email] grupo no procesado", { inboundId: inbound.id, groupId: group.id, error });
      results.push({ ok: false, invoiceId: `inv_${group.id}`, stage: "extraction", error: "No se pudo leer el documento" });
    }
  }
  // El fallo de una factura queda en la factura (reintentable desde el inbox), no en el correo:
  // marcar el correo `failed` haría que la descarga regenere grupos y duplique facturas.
  await db.gmailInboundMessage.update({ where: { id: inbound.id }, data: { processingStatus: "processed" } });
  return { status: "processed", results };
}

// Reintento de una factura de correo que falló: vuelve a procesar solo su grupo.
export async function reprocessEmailInvoice(invoiceId: string, organizationId: string, deps: EmailPipelineDeps = {}): Promise<ProcessResult | null> {
  const invoice = await db.invoice.findFirst({ where: { id: invoiceId, organizationId, source: "email" } });
  if (invoice === null || invoice.documentGroupId === null || invoice.gmailInboundMessageId === null) return null;
  const inbound = await db.gmailInboundMessage.findUnique({ where: { id: invoice.gmailInboundMessageId } });
  const group = await db.documentGroup.findUnique({ where: { id: invoice.documentGroupId }, include: { documents: true } });
  if (inbound === null || group === null) return null;
  const blob = deps.blob ?? createR2Store();
  const extract = (deps.extract ?? createExtractDeps)({ organizationId, inboundMessageId: inbound.id });
  return processGroup(inbound, group, blob, extract);
}
