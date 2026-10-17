import type { NotificationChannelAdapter } from "../../ports";
import type { WhatsAppOutboundMessage } from "./types";

// Esqueleto del adaptador WhatsApp: fija la forma del contrato; la lógica llega en la fase 2
// (render, envío Graph API, verificación HMAC, handshake). Nada aquí envía mensajes todavía.
const NOT_IMPLEMENTED = "Adaptador de WhatsApp: lógica pendiente (fase 2)";

export function createWhatsAppAdapter(): NotificationChannelAdapter<WhatsAppOutboundMessage> {
  return {
    channel: "whatsapp",
    render() {
      throw new Error(NOT_IMPLEMENTED);
    },
    async send() {
      throw new Error(NOT_IMPLEMENTED);
    },
    async verifyWebhook() {
      return false; // fail-closed hasta implementar la verificación de firma
    },
    parseWebhook() {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}
