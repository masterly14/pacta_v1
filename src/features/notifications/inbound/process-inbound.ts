/**
 * Purpose: procesar eventos entrantes de un canal ya verificado. Un mensaje solo cuenta si su
 *   remitente es un destinatario ACTIVO guardado de una organización; si no, se omite. Registra la
 *   respuesta con su contexto de aprobaciones abiertas. NUNCA aprueba ni rechaza: la resolución
 *   exige usuario autenticado en el dashboard (CLAUDE.md §6.9).
 * Runs in: server (Node) only.
 * Triggered by: app/api/webhooks/whatsapp/route.ts (tras verificar firma).
 * Receives → Returns: eventos canónicos → resumen por evento.
 * Talks to: InboundRepo (Prisma en repo.ts).
 */
import { inboundEventKey, type ChannelUserReplyEvent, type InboundChannelEvent, type NotificationChannel } from "@/shared/schemas/notification";
import { parseReplyReference, type ReplyAction } from "./reply-reference";

export type InboundContext = "quoted_request" | "single_pending" | "ambiguous" | "no_open_approvals" | "request_not_pending";

export type RecipientMatch = { recipientId: string; organizationId: string };

export type SaveInboundInput = {
  eventKey: string;
  organizationId: string;
  recipientId: string;
  channel: NotificationChannel;
  event: ChannelUserReplyEvent;
  claimedAction: ReplyAction | null;
  context: InboundContext;
  approvalRequestId: string | null;
  pendingRequestIds: string[];
};

export type InboundRepo = {
  // Solo destinatarios `active`. Dirección desconocida o deshabilitada ⇒ null.
  findActiveRecipient(channel: NotificationChannel, address: string): Promise<RecipientMatch | null>;
  // Solicitudes `pending` de ESA organización (siempre acotado por organizationId).
  listPendingApprovalIds(organizationId: string): Promise<string[]>;
  // Inserta mensaje + auditoría de forma atómica. `created:false` ⇒ duplicado (reintento del proveedor).
  saveInbound(input: SaveInboundInput): Promise<{ created: boolean }>;
};

export type InboundOutcome =
  | { kind: "recorded"; eventKey: string; organizationId: string; context: InboundContext; approvalRequestId: string | null }
  | { kind: "duplicate"; eventKey: string }
  | { kind: "skipped"; reason: "unknown_recipient" | "delivery_status_not_tracked" };

// Dirección canónica del canal: WhatsApp = E.164 solo dígitos.
export function normalizeAddress(channel: NotificationChannel, address: string): string {
  return channel === "whatsapp" ? address.replace(/\D/g, "") : address.trim().toLowerCase();
}

export function resolveContext(
  pendingIds: readonly string[],
  cited: string | null,
): { context: InboundContext; approvalRequestId: string | null } {
  if (cited !== null) {
    return pendingIds.includes(cited)
      ? { context: "quoted_request", approvalRequestId: cited }
      : { context: "request_not_pending", approvalRequestId: null };
  }
  if (pendingIds.length === 0) return { context: "no_open_approvals", approvalRequestId: null };
  if (pendingIds.length === 1) return { context: "single_pending", approvalRequestId: pendingIds[0]! };
  return { context: "ambiguous", approvalRequestId: null };
}

async function processReply(event: ChannelUserReplyEvent, repo: InboundRepo): Promise<InboundOutcome> {
  const address = normalizeAddress(event.channel, event.senderAddress);
  const recipient = await repo.findActiveRecipient(event.channel, address);
  if (recipient === null) {
    return { kind: "skipped", reason: "unknown_recipient" };
  }
  const pendingIds = await repo.listPendingApprovalIds(recipient.organizationId);
  const reference = parseReplyReference(event.buttonPayload);
  const { context, approvalRequestId } = resolveContext(pendingIds, reference?.approvalRequestId ?? null);
  const eventKey = inboundEventKey(event);
  const saved = await repo.saveInbound({
    eventKey,
    organizationId: recipient.organizationId,
    recipientId: recipient.recipientId,
    channel: event.channel,
    event,
    claimedAction: reference?.claimedAction ?? null,
    context,
    approvalRequestId,
    pendingRequestIds: pendingIds,
  });
  return saved.created
    ? { kind: "recorded", eventKey, organizationId: recipient.organizationId, context, approvalRequestId }
    : { kind: "duplicate", eventKey };
}

export async function processInboundEvents(events: readonly InboundChannelEvent[], repo: InboundRepo): Promise<InboundOutcome[]> {
  const outcomes: InboundOutcome[] = [];
  for (const event of events) {
    // Los estados de entrega requieren una tabla de salientes (fase siguiente): se omiten.
    outcomes.push(event.kind === "user_reply" ? await processReply(event, repo) : { kind: "skipped", reason: "delivery_status_not_tracked" });
  }
  return outcomes;
}
