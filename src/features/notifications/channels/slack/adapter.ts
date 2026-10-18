import type { NotificationChannelAdapter } from "../../ports";
import { getAppUrl, getSlackBotToken, getSlackSigningSecret } from "@/lib/slack";
import { renderSlackMessage } from "./blocks";
import {
  SLACK_POST_MESSAGE_URL,
  SLACK_RETRYABLE_ERRORS,
  SlackApiResponseSchema,
  SlackChannelIdSchema,
  SlackOutboundMessageSchema,
  type SlackOutboundMessage,
} from "./types";
import { verifySlackSignature } from "./verify";

export function createSlackAdapter(): NotificationChannelAdapter<SlackOutboundMessage> {
  return {
    channel: "slack",

    render(intent, recipient) {
      const channelId = SlackChannelIdSchema.parse(recipient.address);
      return SlackOutboundMessageSchema.parse(renderSlackMessage(intent, channelId, getAppUrl()));
    },

    async send(message) {
      try {
        const response = await fetch(SLACK_POST_MESSAGE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${getSlackBotToken()}` },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 429 || response.status >= 500) {
          return { status: "rejected", errorCode: `http_${response.status}`, retryable: true };
        }
        const parsed = SlackApiResponseSchema.safeParse(await response.json().catch(() => null));
        if (!parsed.success) {
          return { status: "rejected", errorCode: "invalid_response", retryable: false };
        }
        if (!parsed.data.ok || !parsed.data.ts) {
          const code = parsed.data.error ?? "unknown_error";
          return { status: "rejected", errorCode: code.slice(0, 100), retryable: SLACK_RETRYABLE_ERRORS.includes(code) };
        }
        // `ts` identifica el mensaje dentro del canal.
        return { status: "accepted", providerMessageId: `${message.channel}:${parsed.data.ts}` };
      } catch {
        // Red/timeout/configuración: nunca se lanza al dominio ni se filtra el token.
        return { status: "rejected", errorCode: "network_error", retryable: true };
      }
    },

    async verifyWebhook(request, rawBody) {
      let signingSecret: string;
      try {
        signingSecret = getSlackSigningSecret();
      } catch {
        return false; // sin secreto ⇒ fail-closed
      }
      return verifySlackSignature({
        rawBody,
        signatureHeader: request.headers.get("x-slack-signature"),
        timestampHeader: request.headers.get("x-slack-request-timestamp"),
        signingSecret,
      });
    },

    // Slack es solo de salida: ningún evento entrante se convierte en evidencia ni en acción.
    parseWebhook() {
      return [];
    },
  };
}
