"use server";
/**
 * Purpose: server actions for /platform/invoices: manual upload (A-05: PDF, image or pasted text
 *   through the same pipeline as email) and retry of a failed email invoice.
 * Runs in: server (Next.js server actions; the page sets maxDuration for the AI calls).
 * Triggered by: the upload form and the "Reintentar" button (via useFormAction).
 * Receives → Returns: (previous state, FormData) → { ok, message } | null.
 * Talks to: ensureWorkspaceFromSession, extraction/ai-deps, pipeline (process-invoice,
 *   process-email); next/cache refresh().
 */
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";
import type { FormActionState } from "@/shared/forms/use-form-action";
import { createExtractDeps } from "./extraction/ai-deps";
import type { SourceDocument } from "./extraction/read-document";
import { INVOICE_MIME_TYPES, MAX_ATTACHMENT_BYTES } from "./gmail/download-gmail-message";
import { reprocessEmailInvoice } from "./pipeline/process-email";
import { processInvoice, type ProcessResult } from "./pipeline/process-invoice";

const OUTCOME_LABEL = { aprobada: "✅ aprobada", bloqueada: "🔴 bloqueada", requiere_aprobacion: "🟡 requiere aprobación" } as const;
const MAX_TEXT_LENGTH = 50_000;

function describe(result: ProcessResult): FormActionState {
  if (!result.ok) {
    return result.stage === "extraction"
      ? { ok: false, message: "No se pudo leer la factura con IA. Quedó como fallida en el inbox; revisa el archivo o inténtalo de nuevo." }
      : { ok: false, message: "La factura se extrajo pero no se pudo evaluar. Reintenta en unos segundos." };
  }
  if ("skipped" in result) return { ok: true, message: "Esta factura ya estaba procesada." };
  const reasons = result.decision.reasonCodes.filter((c) => c !== "REQUIERE_APROBACION_HUMANA").join(", ");
  return { ok: true, message: `Factura procesada · ${OUTCOME_LABEL[result.decision.decision]} · ${reasons}` };
}

export async function uploadInvoiceAction(_previous: FormActionState, formData: FormData): Promise<FormActionState> {
  const file = formData.get("file");
  const text = String(formData.get("text") ?? "").trim();
  const hasFile = file instanceof File && file.size > 0;
  if (!hasFile && text === "") return { ok: false, message: "Sube un PDF o una imagen, o pega el texto de la factura." };
  if (hasFile && text !== "") return { ok: false, message: "Usa un archivo o texto, no ambos." };

  let document: SourceDocument;
  let documentType: "pdf" | "image" | "manual_entry";
  if (hasFile) {
    // Mismos tipos y tamaño que los adjuntos de correo.
    if (!INVOICE_MIME_TYPES.has(file.type)) return { ok: false, message: "Solo se aceptan PDF, JPEG, PNG o WEBP." };
    if (file.size > MAX_ATTACHMENT_BYTES) return { ok: false, message: "El archivo supera 10 MB." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = file.type === "application/pdf" ? "pdf" : "image";
    document = { documentId: "upload", kind, mediaType: file.type, bytes, text: null };
    documentType = kind;
  } else {
    if (text.length > MAX_TEXT_LENGTH) return { ok: false, message: "El texto supera 50,000 caracteres." };
    document = { documentId: "upload", kind: "email_body", mediaType: "text/plain", bytes: null, text };
    documentType = "manual_entry";
  }

  try {
    const workspace = await ensureWorkspaceFromSession();
    const invoiceId = `inv_${randomUUID()}`;
    const result = await processInvoice(
      {
        invoiceId,
        organizationId: workspace.organization.id,
        source: "dashboard",
        documentGroupId: null,
        gmailInboundMessageId: null,
        primaryDocumentId: null,
        documents: [document],
        metadata: { senderName: null, senderEmail: null, subject: null, attachmentFilenames: hasFile ? [file.name] : [] },
        meta: { sourceAccountId: null, sourceMessageId: null, documentId: null, documentType, receivedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") },
      },
      { extract: createExtractDeps({ organizationId: workspace.organization.id, inboundMessageId: invoiceId }) },
    );
    refresh();
    return describe(result);
  } catch (error) {
    if (error instanceof OrganizationRequiredError) return { ok: false, message: error.message };
    // Fail-closed: un error nunca aprueba. Sin contenido de la factura en el log.
    console.error("[invoices/upload] falló el procesamiento", { error });
    return { ok: false, message: "No se pudo procesar la factura. Intenta de nuevo." };
  }
}

export async function retryInvoiceAction(_previous: FormActionState, formData: FormData): Promise<FormActionState> {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (invoiceId === "") return { ok: false, message: "Factura no indicada." };
  try {
    const workspace = await ensureWorkspaceFromSession();
    const result = await reprocessEmailInvoice(invoiceId, workspace.organization.id);
    if (result === null) {
      return { ok: false, message: "Solo se pueden reintentar facturas de correo; una carga manual se vuelve a subir." };
    }
    refresh();
    return describe(result);
  } catch (error) {
    if (error instanceof OrganizationRequiredError) return { ok: false, message: error.message };
    console.error("[invoices/retry] falló el reintento", { invoiceId, error });
    return { ok: false, message: "No se pudo reintentar. Intenta de nuevo." };
  }
}
