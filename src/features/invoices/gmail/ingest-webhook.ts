import { nanoid } from "nanoid";
import {
  COMPOSIO_CONNECTED_ACCOUNT_EXPIRED_TYPE,
  COMPOSIO_TRIGGER_MESSAGE_TYPE,
  ComposioConnectedAccountExpiredSchema,
  parseGmailNewMessageEvent,
} from "../../../shared/schemas/composio-webhook.ts";
import { gmailInboundFromTrigger } from "../../../shared/schemas/gmail-inbound-message.ts";
import { createPrismaMailboxRepo, type MailboxRepo } from "./mailbox-repo.ts";

export type IngestResult =
  | { outcome: "expired"; connectionId: string | null }
  | { outcome: "ignored"; reason: string }
  | { outcome: "duplicate"; inboundId: string }
  | { outcome: "received"; inboundId: string; organizationId: string };

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function coerceWebhookPayload(rawPayload: unknown): unknown {
  const record = asRecord(rawPayload);
  if (record.rawPayload) {
    return coerceWebhookPayload(record.rawPayload);
  }
  if (record.raw_payload) {
    return coerceWebhookPayload(record.raw_payload);
  }
  return rawPayload;
}

export async function ingestComposioWebhook(
  rawPayload: unknown,
  deps?: { repo?: MailboxRepo },
): Promise<IngestResult> {
  const repo = deps?.repo ?? createPrismaMailboxRepo();
  const payload = coerceWebhookPayload(rawPayload);
  const expired = ComposioConnectedAccountExpiredSchema.safeParse(payload);
  if (expired.success) {
    const updated = await repo.markExpired(expired.data.data.connected_account_id);
    return { outcome: "expired", connectionId: updated?.id ?? null };
  }

  if (
    typeof payload === "object"
    && payload !== null
    && "type" in payload
    && payload.type === COMPOSIO_CONNECTED_ACCOUNT_EXPIRED_TYPE
  ) {
    return { outcome: "ignored", reason: "expired_payload_invalid" };
  }

  const parsed = parseGmailNewMessageEvent(payload);
  if (!parsed.ok) {
    return { outcome: "ignored", reason: parsed.reason };
  }
  if (
    typeof payload === "object"
    && payload !== null
    && "type" in payload
    && payload.type !== COMPOSIO_TRIGGER_MESSAGE_TYPE
  ) {
    return { outcome: "ignored", reason: "wrong_type" };
  }

  const mailbox = await repo.getByConnectedAccountId(parsed.event.connectedAccountId);
  if (!mailbox || mailbox.status !== "active") {
    return { outcome: "ignored", reason: "unknown_or_inactive_mailbox" };
  }

  const inbound = gmailInboundFromTrigger({
    id: `inb_${nanoid()}`,
    organizationId: mailbox.organizationId,
    gmailConnectionId: mailbox.id,
    event: parsed.event,
  });

  const saved = await repo.createInbound({
    id: inbound.id,
    organizationId: inbound.organizationId,
    gmailConnectionId: inbound.gmailConnectionId,
    composioEventId: inbound.composioEventId,
    gmailMessageId: inbound.gmailMessageId,
    gmailThreadId: inbound.gmailThreadId,
    sender: inbound.sender,
    subject: inbound.subject,
    receivedAt: new Date(inbound.receivedAt),
  });

  if (!saved.created) {
    return { outcome: "duplicate", inboundId: saved.row.id };
  }
  return { outcome: "received", inboundId: saved.row.id, organizationId: saved.row.organizationId };
}

export async function ingestSignedWebhook(
  parse: () => Promise<unknown>,
  deps?: { repo?: MailboxRepo },
): Promise<{ httpStatus: 200 | 401; result?: IngestResult }> {
  let rawPayload: unknown;
  try {
    rawPayload = await parse();
  } catch {
    return { httpStatus: 401 };
  }
  const result = await ingestComposioWebhook(rawPayload, deps);
  return { httpStatus: 200, result };
}
