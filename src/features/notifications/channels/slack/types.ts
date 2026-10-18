import { z } from "zod";

// Contrato de SALIDA hacia Slack: chat.postMessage con Block Kit. `text` es el respaldo para
// notificaciones push y lectores de pantalla.

export const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

// ID de conversación de Slack (canal público/privado o DM): C…, G… o D….
export const SlackChannelIdSchema = z.string().regex(/^[CGD][A-Z0-9]{6,}$/, "ID de canal de Slack inválido");

const TextObjectSchema = z.strictObject({ type: z.enum(["mrkdwn", "plain_text"]), text: z.string().min(1).max(3000) });

const BlockSchema = z.union([
  z.strictObject({ type: z.literal("header"), text: z.strictObject({ type: z.literal("plain_text"), text: z.string().min(1).max(150) }) }),
  z.strictObject({ type: z.literal("section"), text: TextObjectSchema.optional(), fields: z.array(TextObjectSchema).min(1).max(10).optional() }),
  z.strictObject({ type: z.literal("context"), elements: z.array(TextObjectSchema).min(1).max(10) }),
  z.strictObject({
    type: z.literal("actions"),
    elements: z
      .array(
        z.strictObject({
          type: z.literal("button"),
          text: z.strictObject({ type: z.literal("plain_text"), text: z.string().min(1).max(75) }),
          url: z.url(),
        }),
      )
      .min(1)
      .max(5),
  }),
]);

export const SlackOutboundMessageSchema = z.strictObject({
  channel: SlackChannelIdSchema,
  text: z.string().min(1).max(3000),
  blocks: z.array(BlockSchema).min(1).max(50),
  unfurl_links: z.literal(false),
  unfurl_media: z.literal(false),
});

export const SlackApiResponseSchema = z.looseObject({
  ok: z.boolean(),
  ts: z.string().optional(),
  error: z.string().optional(),
});

// Errores de Slack que justifican reintento. Otros (invalid_auth, channel_not_found,
// not_in_channel, missing_scope) NO se reintentan: requieren corregir la configuración.
export const SLACK_RETRYABLE_ERRORS: readonly string[] = ["ratelimited", "internal_error", "service_unavailable", "fatal_error", "request_timeout"];

export type SlackOutboundMessage = z.infer<typeof SlackOutboundMessageSchema>;
