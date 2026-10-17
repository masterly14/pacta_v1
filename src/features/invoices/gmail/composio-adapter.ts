import { COMPOSIO_GMAIL_NEW_MESSAGE_SLUG } from "../../../shared/schemas/composio-webhook.ts";
import { COMPOSIO_GMAIL_TOOLKIT_VERSION, getComposio } from "../../../lib/composio.ts";
import type { FetchedGmailAttachment, FetchedGmailMessage, GmailComposioPort } from "./ports.ts";

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function nestedString(value: unknown, keys: string[]): string | null {
  const record = asRecord(value);
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  const data = asRecord(record.data);
  for (const key of keys) {
    const candidate = data[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  const response = asRecord(record.response_data ?? record.responseData);
  for (const key of keys) {
    const candidate = response[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function decodeBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return new Uint8Array(value);
  }
  if (typeof value === "string" && value.length > 0) {
    try {
      return Uint8Array.from(Buffer.from(value, "base64"));
    } catch {
      return new TextEncoder().encode(value);
    }
  }
  return null;
}

async function bytesFromUnknown(value: unknown): Promise<Uint8Array | null> {
  const direct = decodeBytes(value);
  if (direct) {
    return direct;
  }
  const record = asRecord(value);
  const nested = decodeBytes(record.data ?? record.content ?? record.bytes ?? record.file);
  if (nested) {
    return nested;
  }
  const url = nestedString(value, ["s3url", "s3Url", "url", "file_url", "fileUrl"]);
  if (url?.startsWith("https://")) {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  return null;
}

function parseAttachmentsMeta(value: unknown): FetchedGmailAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const attachments: FetchedGmailAttachment[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const attachmentId = nestedString(record, ["attachmentId", "attachment_id", "id", "gmailAttachmentId"]);
    if (!attachmentId) {
      continue;
    }
    attachments.push({
      attachmentId,
      filename: nestedString(record, ["filename", "name"]),
      mimeType: nestedString(record, ["mimeType", "mime_type", "contentType"]),
      bytes: null,
    });
  }
  return attachments;
}

export function createComposioGmailPort(): GmailComposioPort {
  return {
    async linkAccount(input) {
      const composio = getComposio();
      const request = await composio.connectedAccounts.link(input.userId, input.authConfigId, {
        callbackUrl: input.callbackUrl,
        allowMultiple: true,
      });
      const redirectUrl = request.redirectUrl;
      if (!redirectUrl?.startsWith("https://")) {
        throw new Error("Composio no devolvió un redirectUrl https");
      }
      const connectedAccountId = request.id;
      if (!connectedAccountId.startsWith("ca_")) {
        throw new Error("Composio no devolvió un connected_account_id válido");
      }
      return { connectedAccountId, redirectUrl };
    },

    async waitForAccount(connectedAccountId, timeoutMs) {
      const composio = getComposio();
      const account = await composio.connectedAccounts.waitForConnection(connectedAccountId, timeoutMs);
      return { id: account.id, status: String(account.status) };
    },

    async getAccount(connectedAccountId) {
      const composio = getComposio();
      try {
        const account = await composio.connectedAccounts.get(connectedAccountId);
        return { id: account.id, status: String(account.status) };
      } catch {
        return null;
      }
    },

    async getGmailProfile(input) {
      const composio = getComposio();
      const result = await composio.tools.execute("GMAIL_GET_PROFILE", {
        userId: input.userId,
        connectedAccountId: input.connectedAccountId,
        version: COMPOSIO_GMAIL_TOOLKIT_VERSION,
        arguments: {},
      });
      return {
        email: nestedString(result, ["emailAddress", "email_address", "email", "address"]),
      };
    },

    async createInboxTrigger(input) {
      const composio = getComposio();
      const trigger = await composio.triggers.create(input.userId, COMPOSIO_GMAIL_NEW_MESSAGE_SLUG, {
        connectedAccountId: input.connectedAccountId,
        triggerConfig: { labelIds: "INBOX" },
      });
      const triggerId = "triggerId" in trigger ? String(trigger.triggerId) : String((trigger as { id?: string }).id ?? "");
      if (!triggerId.startsWith("ti_")) {
        throw new Error("Composio no devolvió un trigger_id válido");
      }
      return { triggerId };
    },

    async deleteTrigger(triggerId) {
      const composio = getComposio();
      await composio.triggers.delete(triggerId);
    },

    async deleteAccount(connectedAccountId) {
      const composio = getComposio();
      await composio.connectedAccounts.delete(connectedAccountId);
    },

    async parseWebhook(request, secret) {
      const composio = getComposio();
      const result = await composio.triggers.parse(request, { verifySecret: secret });
      const raw = (result as { rawPayload?: unknown; raw_payload?: unknown }).rawPayload
        ?? (result as { raw_payload?: unknown }).raw_payload
        ?? result;
      const type = nestedString(raw, ["type"]) ?? "";
      return { type, rawPayload: raw };
    },

    async fetchMessage(input) {
      const composio = getComposio();
      const result = await composio.tools.execute("GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", {
        userId: input.userId,
        connectedAccountId: input.connectedAccountId,
        version: COMPOSIO_GMAIL_TOOLKIT_VERSION,
        arguments: { message_id: input.messageId, user_id: "me" },
      });
      return {
        messageId: nestedString(result, ["messageId", "message_id", "id"]) ?? input.messageId,
        threadId: nestedString(result, ["threadId", "thread_id"]),
        sender: nestedString(result, ["sender", "from"]),
        subject: nestedString(result, ["subject"]),
        text: nestedString(result, ["messageText", "message_text", "message_body", "body"]),
        attachments: parseAttachmentsMeta(
          asRecord(result).attachment_list
            ?? asRecord(result).attachments
            ?? asRecord(asRecord(result).data).attachment_list
            ?? asRecord(asRecord(result).data).attachments,
        ),
      } satisfies FetchedGmailMessage;
    },

    async fetchAttachment(input) {
      const composio = getComposio();
      const result = await composio.tools.execute("GMAIL_GET_ATTACHMENT", {
        userId: input.userId,
        connectedAccountId: input.connectedAccountId,
        version: COMPOSIO_GMAIL_TOOLKIT_VERSION,
        arguments: {
          message_id: input.messageId,
          attachment_id: input.attachmentId,
        },
      });
      const bytes = await bytesFromUnknown(result);
      return {
        attachmentId: input.attachmentId,
        filename: nestedString(result, ["filename", "name", "file_name"]),
        mimeType: nestedString(result, ["mimeType", "mime_type", "contentType"]),
        bytes,
      };
    },
  };
}
