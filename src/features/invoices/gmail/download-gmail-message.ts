import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { createComposioGmailPort } from "./composio-adapter.ts";
import { createPrismaMailboxRepo, type MailboxRepo } from "./mailbox-repo.ts";
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

    let storedCount = 0;
    const bodyText = fetched.text;
    if (isUsefulBody(bodyText)) {
      const bytes = new TextEncoder().encode(bodyText);
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
      storedCount += 1;
    }

    for (const meta of fetched.attachments) {
      const attachment = await composio.fetchAttachment({
        userId: mailbox.composioUserId,
        connectedAccountId: mailbox.composioConnectedAccountId,
        messageId: inbound.gmailMessageId,
        attachmentId: meta.attachmentId,
      });
      const mimeType = (attachment.mimeType ?? meta.mimeType ?? "").toLowerCase();
      if (!INVOICE_MIME_TYPES.has(mimeType) || !attachment.bytes) {
        continue;
      }
      if (attachment.bytes.byteLength === 0 || attachment.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
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
        sha256: sha256Hex(attachment.bytes),
        originalFilename: attachment.filename ?? meta.filename,
        source: "invoice_document",
        byteSize: attachment.bytes.byteLength,
        receivedAt: inbound.receivedAt,
      });
      storedCount += 1;
    }

    if (storedCount === 0) {
      await repo.setInboundStatus(inbound.id, "ignored");
      return { status: "ignored" };
    }
    await repo.setInboundStatus(inbound.id, "received");
    return { status: "received" };
  } catch {
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
