import { formatAmountMinor, sanitizeUntrustedText } from "../whatsapp/templates";
import type { NotificationEventType, NotificationIntent } from "@/shared/schemas/notification";
import { DECISION_LABEL, describeReasons } from "../../copy";
import type { SlackOutboundMessage } from "./types";

type EventCopy = { emoji: string; title: string; summary: string };

// `aprobada` = aprobada para PAGO SIMULADO; nunca se dice "pagada".
const COPY: Record<NotificationEventType, EventCopy> = {
  aprobacion_solicitada: { emoji: "🟡", title: "Aprobación requerida", summary: "Una factura necesita la decisión de una persona en el dashboard." },
  aprobacion_resuelta: { emoji: "✅", title: "Solicitud resuelta", summary: "Una persona resolvió la solicitud de aprobación." },
  decision_bloqueada: { emoji: "🔴", title: "Factura bloqueada", summary: "La factura fue bloqueada por las políticas de la empresa." },
  decision_aprobada_simulada: { emoji: "🟢", title: "Factura aprobada (pago simulado)", summary: "Aprobada automáticamente para pago simulado. No se movió dinero." },
};

// Texto de documentos = no confiable. Tras el saneo común, se neutralizan los caracteres que Slack
// interpreta (<!channel>, <@U…>, enlaces <url|texto>) escapándolos como pide la API.
export function escapeSlackText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function untrusted(value: string | null): string {
  return escapeSlackText(sanitizeUntrustedText(value));
}

export function renderSlackMessage(intent: NotificationIntent, channelId: string, appUrl: string): SlackOutboundMessage {
  const copy = COPY[intent.eventType];
  const supplier = untrusted(intent.supplierName);
  const invoice = untrusted(intent.invoiceNumber);
  const amount = escapeSlackText(formatAmountMinor(intent.amountMinor, intent.currency));

  return {
    channel: channelId,
    text: `${copy.emoji} ${copy.title}: ${supplier} · ${invoice} · ${amount}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `${copy.emoji} ${copy.title}` } },
      { type: "section", text: { type: "mrkdwn", text: copy.summary } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Proveedor*\n${supplier}` },
          { type: "mrkdwn", text: `*Factura*\n${invoice}` },
          { type: "mrkdwn", text: `*Importe*\n${amount}` },
          { type: "mrkdwn", text: `*Estado*\n${DECISION_LABEL[intent.decision]}` },
          // Enum cerrado: seguro sin escapar.
          { type: "mrkdwn", text: `*Motivos*\n${describeReasons(intent.reasonCodes)}` },
        ],
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Política v${intent.policyVersion ?? "—"} · Slack solo notifica: aprobar o rechazar se hace en el dashboard.` }],
      },
      {
        type: "actions",
        elements: [{ type: "button", text: { type: "plain_text", text: "Abrir en el dashboard" }, url: `${appUrl}${intent.deepLinkPath}` }],
      },
    ],
    unfurl_links: false,
    unfurl_media: false,
  };
}
