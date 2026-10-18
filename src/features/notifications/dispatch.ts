/**
 * Purpose: tell the company's administrator, on every channel it has configured (WhatsApp and/or
 *   Slack), about a stored payment decision: approval needed (WhatsApp with Pagar / Rechazar /
 *   Más detalles buttons), approved for simulated payment, blocked, or resolved by a person.
 * Runs in: server (Node) only.
 * Triggered by: decisions/server#evaluateInvoice and approvals/server#resolveApprovalRequest,
 *   AFTER their transaction commits.
 * Receives → Returns: (decision row id) → void. Never throws and never changes a decision:
 *   a failed notification is logged and audited, nothing more.
 * Talks to: db — PaymentDecision, ApprovalRequest, NotificationRecipient, AuditEvent (idempotency
 *   + result); Slack and WhatsApp adapters. Recipients come from NotificationRecipient (active and
 *   verified); SLACK_DEFAULT_CHANNEL_ID / WHATSAPP_ADMIN_PHONE are a fallback for a channel with none.
 */
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getSlackDefaultChannelId } from "@/lib/slack";
import { getWhatsAppAdminPhone } from "@/lib/whatsapp";
import {
  NotificationIntentSchema,
  NOTIFICATION_SCHEMA_VERSION,
  type NotificationChannel,
  type NotificationEventType,
  type NotificationIntent,
  type NotificationRecipient,
} from "@/shared/schemas/notification";
import { PaymentDecisionSchema } from "@/shared/schemas/payment-decision";
import type { NotificationChannelAdapter } from "./ports";
import { createSlackAdapter } from "./channels/slack/adapter";
import { createWhatsAppAdapter } from "./channels/whatsapp/adapter";

type DecisionRow = {
  id: string;
  organizationId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  amountMinor: number | null;
  currency: string | null;
  decision: "approved" | "blocked" | "requires_approval";
  decisionSource: "automatic" | "human";
  approvalRequestId: string | null;
  payload: unknown;
  supplier: { name: string } | null;
};

// Entrega de un intent a un canal: cada adaptador conserva su propio tipo de mensaje.
type ChannelSender = {
  render(intent: NotificationIntent, recipient: NotificationRecipient): unknown;
  send(message: never): ReturnType<NotificationChannelAdapter["send"]>;
};

// Canales con adaptador de salida. `email` está en el contrato pero aún no se envía.
const SENDERS: Partial<Record<NotificationChannel, () => ChannelSender>> = {
  slack: () => createSlackAdapter() as unknown as ChannelSender,
  whatsapp: () => createWhatsAppAdapter() as unknown as ChannelSender,
};

function sentEvent(channel: NotificationChannel): string {
  return `notification.${channel}.sent`;
}

function failedEvent(channel: NotificationChannel): string {
  return `notification.${channel}.failed`;
}

function utcInstant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function eventTypeFor(row: DecisionRow): NotificationEventType {
  if (row.decisionSource === "human") return "approval_resolved";
  if (row.decision === "requires_approval") return "approval_requested";
  return row.decision === "approved" ? "decision_approved_simulated" : "decision_blocked";
}

// Solicitud asociada: la que esta decisión resuelve (humana) o la que escaló (automática).
async function findApprovalRequestId(row: DecisionRow): Promise<string | null> {
  if (row.approvalRequestId !== null) return row.approvalRequestId;
  if (row.decision !== "requires_approval") return null;
  const request = await db.approvalRequest.findUnique({ where: { decisionId: row.id }, select: { id: true } });
  return request?.id ?? null;
}

export async function buildNotificationIntent(
  row: DecisionRow,
  recipient: Pick<NotificationRecipient, "recipientId" | "channel">,
): Promise<NotificationIntent | null> {
  const payload = PaymentDecisionSchema.parse(row.payload);
  const eventType = eventTypeFor(row);
  const approvalRequestId = await findApprovalRequestId(row);
  const needsRequest = eventType === "approval_requested" || eventType === "approval_resolved";
  if (needsRequest && approvalRequestId === null) return null;

  return NotificationIntentSchema.parse({
    schemaVersion: NOTIFICATION_SCHEMA_VERSION,
    notificationId: randomUUID(),
    // Una notificación por evento, decisión y destinatario: un reintento no duplica el aviso.
    idempotencyKey: `${recipient.channel}:${eventType}:${row.id}:${recipient.recipientId}`,
    organizationId: row.organizationId,
    eventType,
    recipientId: recipient.recipientId,
    createdAt: utcInstant(new Date()),
    invoiceId: row.invoiceId,
    decisionId: row.id,
    approvalRequestId,
    decision: row.decision,
    reasonCodes: payload.reasonCodes,
    policyVersion: payload.policyVersion,
    amountMinor: row.amountMinor,
    currency: row.currency,
    supplierName: row.supplier?.name ?? null,
    invoiceNumber: row.invoiceNumber,
    deepLinkPath: eventType === "approval_requested" ? "/platform/approvals" : `/platform/invoices/${encodeURIComponent(row.invoiceId)}`,
  });
}

// Destinatarios activos y verificados de la organización; para un canal sin ninguno, el respaldo
// de entorno (demo de una sola empresa). Un destinatario sin verificar no recibe nada.
export async function resolveRecipients(organizationId: string): Promise<NotificationRecipient[]> {
  const rows = await db.notificationRecipient.findMany({
    where: { organizationId, status: "active", verifiedAt: { not: null }, channel: { in: ["slack", "whatsapp"] } },
    orderBy: { createdAt: "asc" },
  });
  const recipients: NotificationRecipient[] = rows.map((row) => ({
    recipientId: row.id,
    organizationId,
    channel: row.channel,
    address: row.address,
    locale: "es",
    verifiedAt: utcInstant(row.verifiedAt!),
    status: "active",
  }));

  const now = utcInstant(new Date());
  const slackChannelId = getSlackDefaultChannelId();
  if (slackChannelId !== null && !recipients.some((r) => r.channel === "slack")) {
    recipients.push({ recipientId: `slack:${slackChannelId}`, organizationId, channel: "slack", address: slackChannelId, locale: "es", verifiedAt: now, status: "active" });
  }
  const adminPhone = getWhatsAppAdminPhone();
  if (adminPhone !== null && !recipients.some((r) => r.channel === "whatsapp")) {
    recipients.push({ recipientId: `whatsapp:${adminPhone}`, organizationId, channel: "whatsapp", address: adminPhone, locale: "es", verifiedAt: now, status: "active" });
  }
  return recipients;
}

async function alreadySent(organizationId: string, channel: NotificationChannel, idempotencyKey: string): Promise<boolean> {
  const found = await db.auditEvent.findFirst({
    where: { organizationId, eventType: sentEvent(channel), entityType: "notification", entityId: idempotencyKey },
    select: { id: true },
  });
  return found !== null;
}

async function sendToRecipient(row: DecisionRow, recipient: NotificationRecipient): Promise<void> {
  const createSender = SENDERS[recipient.channel];
  if (createSender === undefined) return;

  const intent = await buildNotificationIntent(row, recipient);
  if (intent === null || (await alreadySent(intent.organizationId, recipient.channel, intent.idempotencyKey))) return;

  const sender = createSender();
  const result = await sender.send(sender.render(intent, recipient) as never);

  await db.auditEvent.create({
    data: {
      organizationId: intent.organizationId,
      entityType: "notification",
      entityId: intent.idempotencyKey,
      eventType: result.status === "accepted" ? sentEvent(recipient.channel) : failedEvent(recipient.channel),
      actorId: null,
      payload:
        result.status === "accepted"
          ? { decisionId: row.id, approvalRequestId: intent.approvalRequestId, eventType: intent.eventType, providerMessageId: result.providerMessageId }
          : { decisionId: row.id, approvalRequestId: intent.approvalRequestId, eventType: intent.eventType, errorCode: result.errorCode, retryable: result.retryable },
    },
  });
}

export async function notifyDecision(decisionId: string): Promise<void> {
  try {
    const row = await db.paymentDecision.findUnique({
      where: { id: decisionId },
      include: { supplier: { select: { name: true } } },
    });
    if (row === null) return;

    const recipients = await resolveRecipients(row.organizationId);
    // Un canal caído no impide avisar por el otro.
    const results = await Promise.allSettled(recipients.map((recipient) => sendToRecipient(row, recipient)));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        // Nunca propaga: la decisión ya está guardada. Sin datos sensibles en el log.
        console.error("[notifications] fallo al notificar", {
          decisionId,
          channel: recipients[index]?.channel,
          error: result.reason instanceof Error ? result.reason.message : "desconocido",
        });
      }
    });
  } catch (error) {
    console.error("[notifications] fallo al notificar", { decisionId, error: error instanceof Error ? error.message : "desconocido" });
  }
}
