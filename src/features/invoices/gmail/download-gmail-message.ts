import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { createComposioGmailPort } from "./composio-adapter.ts";
import { planDocumentGroups } from "./group-documents.ts";
import { createPrismaMailboxRepo, type IgnoredItemInput, type MailboxRepo } from "./mailbox-repo.ts";
import type { BlobStorePort, GmailComposioPort } from "./ports.ts";
import { createR2Store } from "./r2-store.ts";

export const INVOICE_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isUsefulBody(text: string | null): text is string {
  return Boolean(text && text.trim().length >= 1);
}

export async function downloadGmailMessage(
  inboundId: string,
  deps?: { composio?: GmailComposioPort; repo?: MailboxRepo; blob?: BlobStorePort },
): Promise<{ status: "received" | "ignored" | "failed" }> {
  const composio = deps?.composio ?? createComposioGmailPort();
  const repo = deps?.repo ?? createPrismaMailboxRepo();
  const blob = deps?.blob ?? createR2Store();

  const inbound = await repo.getInboundById(inboundId);
  if (!inbound) {
    return { status: "failed" };
  }
  if (inbound.processingStatus === "processed") {
    return { status: "failed" };
  }

  const mailbox = await repo.getById(inbound.gmailConnectionId);
  if (!mailbox || mailbox.status !== "active") {
    await repo.setInboundStatus(inbound.id, "failed");
    return { status: "failed" };
  }

  await repo.setInboundStatus(inbound.id, "processing");

  try {
    const fetched = await composio.fetchMessage({
      userId: mailbox.composioUserId,
      connectedAccountId: mailbox.composioConnectedAccountId,
      messageId: inbound.gmailMessageId,
    });

    // Un reintento reutiliza lo ya guardado; solo lo repetido dentro de este intento es duplicado.
    const existingDocs = await repo.listDocumentsByInbound(inbound.id);
    const existingSha = new Set(existingDocs.map((doc) => doc.sha256));
    const seenSha = new Set<string>();
    const ignored: IgnoredItemInput[] = [];
    let fetchFailed = false;

    if (isUsefulBody(fetched.text) && !existingDocs.some((doc) => doc.source === "email_body")) {
      const bytes = new TextEncoder().encode(fetched.text);
      const documentId = `doc_${nanoid()}`;
      const stored = await blob.put({
        pathname: `org/${inbound.organizationId}/gmail/${inbound.id}/${documentId}.txt`,
        body: bytes,
        contentType: "text/plain; charset=utf-8",
      });
      await repo.createDocument({
        id: documentId,
        organizationId: inbound.organizationId,
        gmailInboundMessageId: inbound.id,
        fileRef: stored.fileRef,
        publicUrl: stored.publicUrl,
        mimeType: "text/plain",
        sha256: sha256Hex(bytes),
        originalFilename: "body.txt",
        source: "email_body",
        byteSize: bytes.byteLength,
        receivedAt: inbound.receivedAt,
      });
    }

    for (const meta of fetched.attachments) {
      const ignore = (
        reason: IgnoredItemInput["reason"],
        detail: { mimeType?: string | null; filename?: string | null; byteSize?: number | null } = {},
      ) => {
        ignored.push({
          kind: "attachment",
          gmailAttachmentId: meta.attachmentId,
          filename: detail.filename ?? meta.filename,
          mimeType: detail.mimeType ?? meta.mimeType,
          byteSize: detail.byteSize ?? null,
          reason,
        });
      };

      let attachment: Awaited<ReturnType<GmailComposioPort["fetchAttachment"]>>;
      try {
        attachment = await composio.fetchAttachment({
          userId: mailbox.composioUserId,
          connectedAccountId: mailbox.composioConnectedAccountId,
          messageId: inbound.gmailMessageId,
          attachmentId: meta.attachmentId,
        });
      } catch {
        // Fallo transitorio: se registra y el correo queda `failed` para poder reintentarlo.
        ignore("fetch_failed");
        fetchFailed = true;
        continue;
      }

      const mimeType = (attachment.mimeType ?? meta.mimeType ?? "").toLowerCase();
      const filename = attachment.filename ?? meta.filename;
      const byteSize = attachment.bytes?.byteLength ?? null;
      if (!INVOICE_MIME_TYPES.has(mimeType)) {
        ignore("unsupported_mime_type", { mimeType: mimeType || null, filename, byteSize });
        continue;
      }
      if (!attachment.bytes) {
        ignore("missing_content", { mimeType, filename });
        continue;
      }
      if (attachment.bytes.byteLength === 0) {
        ignore("empty_file", { mimeType, filename, byteSize });
        continue;
      }
      if (attachment.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        ignore("file_too_large", { mimeType, filename, byteSize });
        continue;
      }

      const sha256 = sha256Hex(attachment.bytes);
      if (seenSha.has(sha256)) {
        ignore("duplicate_content", { mimeType, filename, byteSize });
        continue;
      }
      seenSha.add(sha256);
      if (existingSha.has(sha256)) {
        continue;
      }

      const documentId = `doc_${nanoid()}`;
      const extension = mimeType === "application/pdf" ? "pdf" : mimeType.split("/")[1] ?? "bin";
      const stored = await blob.put({
        pathname: `org/${inbound.organizationId}/gmail/${inbound.id}/${documentId}.${extension}`,
        body: attachment.bytes,
        contentType: mimeType,
      });
      await repo.createDocument({
        id: documentId,
        organizationId: inbound.organizationId,
        gmailInboundMessageId: inbound.id,
        fileRef: stored.fileRef,
        publicUrl: stored.publicUrl,
        mimeType,
        sha256,
        originalFilename: filename,
        source: "invoice_document",
        byteSize: attachment.bytes.byteLength,
        receivedAt: inbound.receivedAt,
      });
    }

    const documents = await repo.listDocumentsByInbound(inbound.id);
    if (documents.length === 0 && !fetchFailed) {
      ignored.push({
        kind: "message",
        gmailAttachmentId: null,
        filename: null,
        mimeType: null,
        byteSize: null,
        reason: "no_usable_content",
      });
    }
    await repo.replaceIgnoredItems({
      organizationId: inbound.organizationId,
      inboundId: inbound.id,
      items: ignored,
    });
    await repo.replaceDocumentGroups({
      organizationId: inbound.organizationId,
      inboundId: inbound.id,
      groups: planDocumentGroups(documents).map((group) => ({ ...group, id: `grp_${nanoid()}` })),
    });

    if (fetchFailed) {
      await repo.setInboundStatus(inbound.id, "failed");
      return { status: "failed" };
    }
    if (documents.length === 0) {
      await repo.setInboundStatus(inbound.id, "ignored");
      return { status: "ignored" };
    }
    await repo.setInboundStatus(inbound.id, "received");
    return { status: "received" };
  } catch (error) {
    console.error("[gmail] downloadGmailMessage", inbound.id, error);
    await repo.setInboundStatus(inbound.id, "failed");
    return { status: "failed" };
  }
}

export async function retryGmailDownload(
  input: { inboundId: string; organizationId: string },
  deps?: { composio?: GmailComposioPort; repo?: MailboxRepo; blob?: BlobStorePort },
): Promise<{ status: "received" | "ignored" | "failed" }> {
  const repo = deps?.repo ?? createPrismaMailboxRepo();
  const inbound = await repo.getInboundById(input.inboundId);
  if (!inbound || inbound.organizationId !== input.organizationId || inbound.processingStatus !== "failed") {
    return { status: "failed" };
  }
  return downloadGmailMessage(input.inboundId, deps);
}
