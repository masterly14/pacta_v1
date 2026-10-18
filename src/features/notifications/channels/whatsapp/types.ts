import { z } from "zod";

// Contrato de SALIDA hacia WhatsApp Cloud API: POST /{PHONE_NUMBER_ID}/messages con plantilla.
// Solo plantillas aprobadas en Meta: las notificaciones las inicia el negocio, sin ventana de 24 h.

export const WHATSAPP_GRAPH_API_VERSION = "v21.0";

// E.164 sin "+" (formato de `to` de la Graph API).
export const WhatsAppRecipientNumberSchema = z.string().regex(/^[1-9]\d{6,14}$/, "Teléfono E.164 sin '+'");

const TextParameterSchema = z.strictObject({ type: z.literal("text"), text: z.string().min(1).max(1024) });

const BodyComponentSchema = z.strictObject({
  type: z.literal("body"),
  parameters: z.array(TextParameterSchema).max(10),
});

// Botón URL dinámico: la base está fijada en la plantilla; solo se envía el sufijo.
const UrlButtonComponentSchema = z.strictObject({
  type: z.literal("button"),
  sub_type: z.literal("url"),
  index: z.literal("0"),
  parameters: z.array(TextParameterSchema).length(1),
});

// Botón de respuesta rápida: la carga vuelve en el webhook como `button.payload`.
const QuickReplyButtonComponentSchema = z.strictObject({
  type: z.literal("button"),
  sub_type: z.literal("quick_reply"),
  index: z.enum(["0", "1", "2"]),
  parameters: z.array(z.strictObject({ type: z.literal("payload"), payload: z.string().min(1).max(256) })).length(1),
});

export const WhatsAppOutboundMessageSchema = z.strictObject({
  messaging_product: z.literal("whatsapp"),
  recipient_type: z.literal("individual"),
  to: WhatsAppRecipientNumberSchema,
  type: z.literal("template"),
  template: z.strictObject({
    name: z.string().regex(/^[a-z0-9_]{1,512}$/),
    language: z.strictObject({ code: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/) }),
    components: z.array(z.union([BodyComponentSchema, UrlButtonComponentSchema, QuickReplyButtonComponentSchema])),
  }),
});

export const WhatsAppSendSuccessSchema = z.looseObject({
  messaging_product: z.literal("whatsapp"),
  contacts: z.array(z.looseObject({ wa_id: z.string() })).optional(),
  messages: z.array(z.looseObject({ id: z.string().min(1) })).min(1),
});

export const WhatsAppApiErrorSchema = z.looseObject({
  error: z.looseObject({
    message: z.string().optional(),
    type: z.string().optional(),
    code: z.number(),
    error_subcode: z.number().optional(),
    fbtrace_id: z.string().optional(),
  }),
});

// Códigos de la Graph API que justifican reintento (límites de tasa / fallos transitorios).
// Otros (token inválido, plantilla no aprobada, número inválido) NO se reintentan.
export const WHATSAPP_RETRYABLE_ERROR_CODES: readonly number[] = [4, 17, 80007, 130429, 131016, 131056];

export type WhatsAppOutboundMessage = z.infer<typeof WhatsAppOutboundMessageSchema>;
export type WhatsAppSendSuccess = z.infer<typeof WhatsAppSendSuccessSchema>;
export type WhatsAppApiError = z.infer<typeof WhatsAppApiErrorSchema>;
