import { z } from "zod";
import { EntityIdSchema, UtcInstantSchema } from "./invoice-context.ts";
import { ComposioAuthConfigIdSchema, ComposioConnectedAccountIdSchema, ComposioTriggerIdSchema } from "./gmail-connection.ts";

// Frontera del webhook Composio V3. El parse Zod ocurre DESPUÉS de verificar
// webhook-id, webhook-timestamp y webhook-signature. Un payload inválido no crea factura.
// Cuerpo, asunto y adjuntos son datos no confiables: no cambian políticas ni autorizan.

export const COMPOSIO_GMAIL_NEW_MESSAGE_SLUG = "GMAIL_NEW_GMAIL_MESSAGE";
export const COMPOSIO_TRIGGER_MESSAGE_TYPE = "composio.trigger.message";
export const COMPOSIO_CONNECTED_ACCOUNT_EXPIRED_TYPE = "composio.connected_account.expired";

export const ComposioEventIdSchema = z
  .string()
  .min(4)
  .max(200)
  .regex(/^msg_/, "Debe ser el id de entrega Composio (msg_…)");

export const ComposioTriggerMetadataSchema = z.strictObject({
  log_id: EntityIdSchema,
  trigger_slug: z.string().min(1).max(200),
  trigger_id: ComposioTriggerIdSchema,
  connected_account_id: ComposioConnectedAccountIdSchema,
  auth_config_id: ComposioAuthConfigIdSchema,
  user_id: EntityIdSchema.nullable(),
});

export const ComposioTriggerEnvelopeSchema = z.strictObject({
  id: ComposioEventIdSchema,
  timestamp: UtcInstantSchema,
  type: z.literal(COMPOSIO_TRIGGER_MESSAGE_TYPE),
  metadata: ComposioTriggerMetadataSchema,
  data: z.record(z.string(), z.unknown()),
});

export const GmailAttachmentRefSchema = z.strictObject({
  gmailAttachmentId: EntityIdSchema,
  filename: z.string().min(1).max(500).nullable(),
  mimeType: z.string().min(1).max(200).nullable(),
  sizeBytes: z.int().nonnegative().nullable(),
});

function nonemptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseAttachmentRefs(value: unknown): z.infer<typeof GmailAttachmentRefSchema>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const refs: z.infer<typeof GmailAttachmentRefSchema>[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    const raw = item as Record<string, unknown>;
    const gmailAttachmentId = nonemptyString(raw.gmailAttachmentId ?? raw.attachmentId ?? raw.attachment_id ?? raw.id);
    if (!gmailAttachmentId) {
      continue;
    }
    const parsed = GmailAttachmentRefSchema.safeParse({
      gmailAttachmentId,
      filename: nonemptyString(raw.filename ?? raw.name),
      mimeType: nonemptyString(raw.mimeType ?? raw.mime_type),
      sizeBytes: typeof raw.sizeBytes === "number" ? raw.sizeBytes : typeof raw.size === "number" ? raw.size : null,
    });
    if (parsed.success) {
      refs.push(parsed.data);
    }
  }
  return refs;
}

export const GmailNewMessageDataSchema = z.record(z.string(), z.unknown()).transform((raw) => ({
  messageId: nonemptyString(raw.message_id ?? raw.messageId ?? raw.id),
  threadId: nonemptyString(raw.thread_id ?? raw.threadId),
  sender: nonemptyString(raw.sender ?? raw.from),
  subject: nonemptyString(raw.subject),
  messageText: nonemptyString(raw.message_text ?? raw.messageText),
  attachmentRefs: parseAttachmentRefs(raw.attachment_list ?? raw.attachments ?? raw.attachmentRefs),
}));

export const GmailNewMessageCanonicalSchema = z.strictObject({
  messageId: z.string().min(1).nullable(),
  threadId: z.string().min(1).nullable(),
  sender: z.string().min(1).nullable(),
  subject: z.string().min(1).nullable(),
  messageText: z.string().nullable(),
  attachmentRefs: z.array(GmailAttachmentRefSchema),
});

export const ComposioConnectedAccountExpiredSchema = z.strictObject({
  id: EntityIdSchema,
  timestamp: UtcInstantSchema,
  type: z.literal(COMPOSIO_CONNECTED_ACCOUNT_EXPIRED_TYPE),
  data: z.strictObject({
    connected_account_id: ComposioConnectedAccountIdSchema,
    user_id: EntityIdSchema.nullable(),
  }),
});

export type ComposioTriggerIgnoredReason = "wrong_slug" | "missing_message_id";

export type GmailNewMessageEvent = {
  composioEventId: z.infer<typeof ComposioEventIdSchema>;
  receivedAt: z.infer<typeof UtcInstantSchema>;
  connectedAccountId: z.infer<typeof ComposioConnectedAccountIdSchema>;
  composioUserId: string | null;
  triggerId: z.infer<typeof ComposioTriggerIdSchema>;
  data: z.infer<typeof GmailNewMessageCanonicalSchema> & { messageId: string };
};

export type ComposioTriggerParseResult =
  | { ok: true; event: GmailNewMessageEvent }
  | { ok: false; reason: "invalid_envelope" | ComposioTriggerIgnoredReason };

export function parseGmailNewMessageEvent(input: unknown): ComposioTriggerParseResult {
  const envelope = ComposioTriggerEnvelopeSchema.safeParse(input);
  if (!envelope.success) {
    return { ok: false, reason: "invalid_envelope" };
  }
  if (envelope.data.metadata.trigger_slug !== COMPOSIO_GMAIL_NEW_MESSAGE_SLUG) {
    return { ok: false, reason: "wrong_slug" };
  }
  const data = GmailNewMessageCanonicalSchema.parse(GmailNewMessageDataSchema.parse(envelope.data.data));
  if (data.messageId === null) {
    return { ok: false, reason: "missing_message_id" };
  }
  return {
    ok: true,
    event: {
      composioEventId: envelope.data.id,
      receivedAt: envelope.data.timestamp,
      connectedAccountId: envelope.data.metadata.connected_account_id,
      composioUserId: envelope.data.metadata.user_id,
      triggerId: envelope.data.metadata.trigger_id,
      data: { ...data, messageId: data.messageId },
    },
  };
}

export type ComposioTriggerMetadata = z.infer<typeof ComposioTriggerMetadataSchema>;
export type ComposioTriggerEnvelope = z.infer<typeof ComposioTriggerEnvelopeSchema>;
export type GmailAttachmentRef = z.infer<typeof GmailAttachmentRefSchema>;
export type GmailNewMessageData = z.infer<typeof GmailNewMessageCanonicalSchema>;
export type ComposioConnectedAccountExpired = z.infer<typeof ComposioConnectedAccountExpiredSchema>;
