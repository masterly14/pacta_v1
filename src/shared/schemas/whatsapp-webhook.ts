import { z } from "zod";
import { type InboundChannelEvent, InboundChannelEventSchema } from "./notification.ts";

// Frontera del webhook de WhatsApp Cloud API (Meta). El parse Zod ocurre DESPUÉS de verificar
// `X-Hub-Signature-256` sobre el cuerpo crudo (HMAC-SHA256 con WHATSAPP_APP_SECRET, comparación en
// tiempo constante). Contenido de mensajes = datos no confiables: nunca autoriza ni cambia políticas.
// Este módulo solo define forma y normalización; la verificación y la idempotencia persistente viven
// en el adaptador/ruta.

export const WHATSAPP_SIGNATURE_HEADER = "x-hub-signature-256";
export const WHATSAPP_SIGNATURE_PREFIX = "sha256=";
export const WHATSAPP_WEBHOOK_OBJECT = "whatsapp_business_account";
export const WHATSAPP_MESSAGES_FIELD = "messages";

// ---------------------------------------------------------------------------
// GET: handshake de suscripción
// ---------------------------------------------------------------------------

export const WhatsAppVerificationQuerySchema = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string().min(1).max(500),
  "hub.challenge": z.string().min(1).max(500),
});

// ---------------------------------------------------------------------------
// POST: envelope. Tolerante (looseObject): Meta añade campos sin avisar.
// ---------------------------------------------------------------------------

const UnixSecondsStringSchema = z.string().regex(/^\d{1,12}$/, "Debe ser epoch en segundos");

export const WhatsAppStatusErrorSchema = z.looseObject({
  code: z.number(),
  title: z.string().optional(),
  message: z.string().optional(),
});

export const WhatsAppStatusSchema = z.looseObject({
  id: z.string().min(1),
  status: z.string().min(1), // sent | delivered | read | failed | deleted | warning
  timestamp: UnixSecondsStringSchema,
  recipient_id: z.string().min(1).optional(),
  errors: z.array(WhatsAppStatusErrorSchema).optional(),
});

export const WhatsAppMessageSchema = z.looseObject({
  from: z.string().min(1),
  id: z.string().min(1),
  timestamp: UnixSecondsStringSchema,
  type: z.string().min(1), // text | button | interactive | image | audio | ...
  text: z.looseObject({ body: z.string() }).optional(),
  button: z.looseObject({ payload: z.string().optional(), text: z.string().optional() }).optional(),
  interactive: z
    .looseObject({
      type: z.string().optional(),
      button_reply: z.looseObject({ id: z.string(), title: z.string().optional() }).optional(),
    })
    .optional(),
  context: z.looseObject({ id: z.string().optional() }).optional(),
});

export const WhatsAppChangeValueSchema = z.looseObject({
  messaging_product: z.literal("whatsapp"),
  metadata: z.looseObject({
    display_phone_number: z.string().optional(),
    phone_number_id: z.string().min(1),
  }),
  statuses: z.array(z.unknown()).optional(), // cada elemento se valida por separado
  messages: z.array(z.unknown()).optional(),
});

export const WhatsAppWebhookEnvelopeSchema = z.looseObject({
  object: z.literal(WHATSAPP_WEBHOOK_OBJECT),
  entry: z.array(
    z.looseObject({
      id: z.string().min(1),
      changes: z.array(z.looseObject({ field: z.string(), value: z.unknown() })),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Normalización a eventos canónicos
// ---------------------------------------------------------------------------

export type WhatsAppIgnoredReason =
  | "foreign_phone_number_id"
  | "unsupported_field"
  | "unsupported_status"
  | "unsupported_message_type"
  | "invalid_item";

export type WhatsAppIgnoredItem = { reason: WhatsAppIgnoredReason };

export type WhatsAppWebhookParseResult =
  | { ok: true; events: InboundChannelEvent[]; ignored: WhatsAppIgnoredItem[] }
  | { ok: false; reason: "invalid_envelope" };

const DELIVERY_STATUS_MAP = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
} as const;

function unixSecondsToIso(value: string): string | null {
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeStatus(item: unknown): InboundChannelEvent | WhatsAppIgnoredItem {
  const parsed = WhatsAppStatusSchema.safeParse(item);
  if (!parsed.success) {
    return { reason: "invalid_item" };
  }
  const status = DELIVERY_STATUS_MAP[parsed.data.status as keyof typeof DELIVERY_STATUS_MAP];
  const occurredAt = unixSecondsToIso(parsed.data.timestamp);
  if (!status) {
    return { reason: "unsupported_status" };
  }
  if (!occurredAt) {
    return { reason: "invalid_item" };
  }
  const firstError = parsed.data.errors?.[0];
  const event = InboundChannelEventSchema.safeParse({
    kind: "delivery_status",
    channel: "whatsapp",
    providerMessageId: parsed.data.id,
    status,
    occurredAt,
    error: firstError ? { code: String(firstError.code), message: nonEmpty(firstError.message ?? firstError.title) } : null,
  });
  return event.success ? event.data : { reason: "invalid_item" };
}

function normalizeMessage(item: unknown): InboundChannelEvent | WhatsAppIgnoredItem {
  const parsed = WhatsAppMessageSchema.safeParse(item);
  if (!parsed.success) {
    return { reason: "invalid_item" };
  }
  const message = parsed.data;
  let text: string | null = null;
  let buttonPayload: string | null = null;
  if (message.type === "text") {
    text = nonEmpty(message.text?.body);
  } else if (message.type === "button") {
    text = nonEmpty(message.button?.text);
    buttonPayload = nonEmpty(message.button?.payload);
  } else if (message.type === "interactive" && message.interactive?.button_reply) {
    text = nonEmpty(message.interactive.button_reply.title);
    buttonPayload = nonEmpty(message.interactive.button_reply.id);
  } else {
    return { reason: "unsupported_message_type" };
  }
  const receivedAt = unixSecondsToIso(message.timestamp);
  if (!receivedAt) {
    return { reason: "invalid_item" };
  }
  const event = InboundChannelEventSchema.safeParse({
    kind: "user_reply",
    channel: "whatsapp",
    senderAddress: message.from,
    providerMessageId: message.id,
    replyToProviderMessageId: nonEmpty(message.context?.id),
    text,
    buttonPayload,
    receivedAt,
  });
  return event.success ? event.data : { reason: "invalid_item" };
}

function isIgnored(value: InboundChannelEvent | WhatsAppIgnoredItem): value is WhatsAppIgnoredItem {
  return !("kind" in value);
}

// `expectedPhoneNumberId` = WHATSAPP_PHONE_NUMBER_ID de la configuración: eventos de otro número se
// descartan. Un sobre inválido no produce eventos; un elemento inválido solo se omite.
export function parseWhatsAppWebhook(input: unknown, expectedPhoneNumberId: string): WhatsAppWebhookParseResult {
  const envelope = WhatsAppWebhookEnvelopeSchema.safeParse(input);
  if (!envelope.success) {
    return { ok: false, reason: "invalid_envelope" };
  }
  const events: InboundChannelEvent[] = [];
  const ignored: WhatsAppIgnoredItem[] = [];
  const collect = (result: InboundChannelEvent | WhatsAppIgnoredItem) => {
    if (isIgnored(result)) {
      ignored.push(result);
    } else {
      events.push(result);
    }
  };

  for (const entry of envelope.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== WHATSAPP_MESSAGES_FIELD) {
        ignored.push({ reason: "unsupported_field" });
        continue;
      }
      const value = WhatsAppChangeValueSchema.safeParse(change.value);
      if (!value.success) {
        ignored.push({ reason: "invalid_item" });
        continue;
      }
      if (value.data.metadata.phone_number_id !== expectedPhoneNumberId) {
        ignored.push({ reason: "foreign_phone_number_id" });
        continue;
      }
      for (const status of value.data.statuses ?? []) {
        collect(normalizeStatus(status));
      }
      for (const message of value.data.messages ?? []) {
        collect(normalizeMessage(message));
      }
    }
  }
  return { ok: true, events, ignored };
}

export type WhatsAppVerificationQuery = z.infer<typeof WhatsAppVerificationQuerySchema>;
export type WhatsAppWebhookEnvelope = z.infer<typeof WhatsAppWebhookEnvelopeSchema>;
export type WhatsAppStatus = z.infer<typeof WhatsAppStatusSchema>;
export type WhatsAppMessage = z.infer<typeof WhatsAppMessageSchema>;
