import type { NotificationChannelAdapter } from "../../ports";
import { getWhatsAppAccessToken, getWhatsAppAppSecret, getWhatsAppPhoneNumberId } from "@/lib/whatsapp";
import { WHATSAPP_SIGNATURE_HEADER, parseWhatsAppWebhook } from "@/shared/schemas/whatsapp-webhook";
import { WHATSAPP_TEMPLATES, deepLinkSuffix, quickReplyPayloads } from "./templates";
import {
  WHATSAPP_GRAPH_API_VERSION,
  WHATSAPP_RETRYABLE_ERROR_CODES,
  WhatsAppApiErrorSchema,
  WhatsAppOutboundMessageSchema,
  WhatsAppRecipientNumberSchema,
  WhatsAppSendSuccessSchema,
  type WhatsAppOutboundMessage,
} from "./types";
import { verifyWhatsAppSignature } from "./verify";

const GRAPH_API_BASE = "https://graph.facebook.com";

export function createWhatsAppAdapter(): NotificationChannelAdapter<WhatsAppOutboundMessage> {
  return {
    channel: "whatsapp",

    // Puro: arma el mensaje de plantilla. Lanza si el teléfono no es E.164 (sin "+").
    render(intent, recipient) {
      const to = WhatsAppRecipientNumberSchema.parse(recipient.address);
      const template = WHATSAPP_TEMPLATES[intent.eventType];
      const components: WhatsAppOutboundMessage["template"]["components"] = [
        { type: "body", parameters: template.bodyParams(intent).map((text) => ({ type: "text" as const, text })) },
      ];
      if (template.button === "quick_reply") {
        for (const { index, payload } of quickReplyPayloads(intent)) {
          components.push({ type: "button", sub_type: "quick_reply", index, parameters: [{ type: "payload", payload }] });
        }
      } else {
        components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: deepLinkSuffix(intent) }] });
      }
      return WhatsAppOutboundMessageSchema.parse({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: { name: template.name, language: { code: template.languageCode }, components },
      });
    },

    async send(message) {
      try {
        const response = await fetch(`${GRAPH_API_BASE}/${WHATSAPP_GRAPH_API_VERSION}/${getWhatsAppPhoneNumberId()}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${getWhatsAppAccessToken()}` },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(10_000),
        });
        const body: unknown = await response.json().catch(() => null);
        if (response.ok) {
          const success = WhatsAppSendSuccessSchema.safeParse(body);
          return success.success
            ? { status: "accepted", providerMessageId: success.data.messages[0]!.id }
            : { status: "rejected", errorCode: "invalid_response", retryable: false };
        }
        const apiError = WhatsAppApiErrorSchema.safeParse(body);
        if (apiError.success) {
          const code = apiError.data.error.code;
          return { status: "rejected", errorCode: `graph_${code}`, retryable: WHATSAPP_RETRYABLE_ERROR_CODES.includes(code) };
        }
        return { status: "rejected", errorCode: `http_${response.status}`, retryable: response.status === 429 || response.status >= 500 };
      } catch {
        // Red/timeout/configuración: nunca se lanza al dominio ni se filtra el token.
        return { status: "rejected", errorCode: "network_error", retryable: true };
      }
    },

    async verifyWebhook(request, rawBody) {
      try {
        return verifyWhatsAppSignature(rawBody, request.headers.get(WHATSAPP_SIGNATURE_HEADER), getWhatsAppAppSecret());
      } catch {
        return false; // sin secreto ⇒ fail-closed
      }
    },

    parseWebhook(rawBody) {
      try {
        const parsed = parseWhatsAppWebhook(JSON.parse(rawBody), getWhatsAppPhoneNumberId());
        return parsed.ok ? parsed.events : [];
      } catch {
        return []; // entrada inválida nunca lanza ni autoriza nada
      }
    },
  };
}
