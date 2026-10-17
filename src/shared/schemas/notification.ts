import { z } from "zod";
import { AmountMinorSchema, CurrencyCodeSchema, EntityIdSchema, UtcInstantSchema } from "./invoice-context.ts";
import { DecisionOutcomeSchema, ReasonCodeSchema } from "./payment-decision.ts";

// Contrato de comunicación AGNÓSTICO de canal. El dominio (decisiones/aprobaciones) solo conoce estos
// tipos; cada canal (WhatsApp, Slack, email) los traduce a su formato en su adaptador.
// Una notificación informa estado: NO concede ni transfiere autoridad para aprobar (CLAUDE.md §6.9).
// Todo mensaje entrante es evidencia no confiable.

export const NOTIFICATION_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

// `dashboard` no es canal de salida; sí existe como `channel` de una resolución (src/contracts/approval.ts).
export const NotificationChannelSchema = z.enum(["whatsapp", "slack", "email"]);

// Lista cerrada: añadir un evento es un cambio de contrato.
export const NotificationEventTypeSchema = z.enum([
  "approval_requested", // factura en `requires_approval`: acción humana pendiente
  "approval_resolved", // un humano aprobó o bloqueó la solicitud
  "decision_blocked", // bloqueo absoluto (duplicado, presupuesto)
  "decision_approved_simulated", // aprobada automáticamente PARA PAGO SIMULADO (no es pago)
]);

export const NotificationDeliveryStatusSchema = z.enum(["queued", "sent", "delivered", "read", "failed"]);

export const NotificationRecipientStatusSchema = z.enum(["active", "disabled"]);

// ---------------------------------------------------------------------------
// Qué comunicar
// ---------------------------------------------------------------------------

// Ruta relativa del dashboard (nunca URL absoluta ni con datos sensibles).
export const DeepLinkPathSchema = z
  .string()
  .max(300)
  .regex(/^\/(?!\/)[A-Za-z0-9\-._~/?=&%]*$/, "Debe ser una ruta relativa del dashboard");

export const NotificationIntentSchema = z
  .strictObject({
    schemaVersion: z.literal(NOTIFICATION_SCHEMA_VERSION),

    notificationId: EntityIdSchema,
    // Dedupe de emisión: misma clave ⇒ una sola notificación (p. ej. `${eventType}:${approvalRequestId}`).
    idempotencyKey: z.string().trim().min(1).max(200),
    organizationId: EntityIdSchema,
    eventType: NotificationEventTypeSchema,
    // Referencia al destinatario; el teléfono/dirección vive en NotificationRecipient.
    recipientId: EntityIdSchema,
    createdAt: UtcInstantSchema,

    // Referencias de dominio
    invoiceId: EntityIdSchema,
    decisionId: EntityIdSchema,
    approvalRequestId: EntityIdSchema.nullable(),

    // Estado a reportar (hechos del motor, no interpretación del canal)
    decision: DecisionOutcomeSchema,
    reasonCodes: z.array(ReasonCodeSchema).min(1),
    policyVersion: z.int().positive().nullable(),

    // Datos de la factura; `null` = desconocido (nunca 0 como sustituto)
    amountMinor: AmountMinorSchema.nullable(),
    currency: CurrencyCodeSchema.nullable(),
    // Texto NO confiable (viene de documentos): el adaptador lo trunca y sanea antes de renderizar.
    supplierName: z.string().max(200).nullable(),
    invoiceNumber: z.string().max(100).nullable(),

    deepLinkPath: DeepLinkPathSchema,
  })
  .superRefine((n, ctx) => {
    if (new Set(n.reasonCodes).size !== n.reasonCodes.length) {
      ctx.addIssue({ code: "custom", path: ["reasonCodes"], message: "reasonCodes contiene duplicados" });
    }
    if ((n.amountMinor === null) !== (n.currency === null)) {
      ctx.addIssue({ code: "custom", path: ["currency"], message: "amountMinor y currency van juntos o ambos null" });
    }
    if (n.eventType === "approval_requested") {
      if (n.decision !== "requires_approval") {
        ctx.addIssue({ code: "custom", path: ["decision"], message: "approval_requested exige decision 'requires_approval'" });
      }
      if (n.approvalRequestId === null) {
        ctx.addIssue({ code: "custom", path: ["approvalRequestId"], message: "approval_requested exige approvalRequestId" });
      }
    }
    if (n.eventType === "approval_resolved") {
      if (n.decision === "requires_approval") {
        ctx.addIssue({ code: "custom", path: ["decision"], message: "approval_resolved exige 'approved' o 'blocked'" });
      }
      if (n.approvalRequestId === null) {
        ctx.addIssue({ code: "custom", path: ["approvalRequestId"], message: "approval_resolved exige approvalRequestId" });
      }
    }
    if (n.eventType === "decision_blocked" && n.decision !== "blocked") {
      ctx.addIssue({ code: "custom", path: ["decision"], message: "decision_blocked exige decision 'blocked'" });
    }
    if (n.eventType === "decision_approved_simulated" && n.decision !== "approved") {
      ctx.addIssue({ code: "custom", path: ["decision"], message: "decision_approved_simulated exige decision 'approved'" });
    }
  });

// ---------------------------------------------------------------------------
// A quién
// ---------------------------------------------------------------------------

// Destinatario resuelto (p. ej. el administrador configurado en Políticas). Un destinatario sin
// verificar o deshabilitado no recibe notificaciones.
export const NotificationRecipientSchema = z.strictObject({
  recipientId: EntityIdSchema,
  organizationId: EntityIdSchema,
  channel: NotificationChannelSchema,
  // WhatsApp: E.164 (validado en el adaptador del canal); otros canales: dirección opaca.
  address: z.string().trim().min(3).max(320),
  locale: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Locale tipo 'es' o 'es_MX'"),
  verifiedAt: UtcInstantSchema.nullable(),
  status: NotificationRecipientStatusSchema,
});

// ---------------------------------------------------------------------------
// Resultado de envío (salida del adaptador)
// ---------------------------------------------------------------------------

export const OutboundNotificationResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("accepted"),
    providerMessageId: z.string().trim().min(1).max(500),
  }),
  z.strictObject({
    status: z.literal("rejected"),
    errorCode: z.string().trim().min(1).max(100), // código del proveedor o interno; sin datos sensibles
    retryable: z.boolean(),
  }),
]);

// ---------------------------------------------------------------------------
// Eventos entrantes canónicos (salida de parseWebhook del adaptador)
// ---------------------------------------------------------------------------

export const ChannelDeliveryStatusEventSchema = z.strictObject({
  kind: z.literal("delivery_status"),
  channel: NotificationChannelSchema,
  providerMessageId: z.string().trim().min(1).max(500),
  status: NotificationDeliveryStatusSchema,
  occurredAt: UtcInstantSchema,
  error: z.strictObject({ code: z.string().min(1).max(100), message: z.string().max(500).nullable() }).nullable(),
});

// Respuesta de una persona. EVIDENCIA NO CONFIABLE: jamás aprueba, rechaza ni cambia políticas.
export const ChannelUserReplyEventSchema = z.strictObject({
  kind: z.literal("user_reply"),
  channel: NotificationChannelSchema,
  senderAddress: z.string().trim().min(1).max(320),
  providerMessageId: z.string().trim().min(1).max(500),
  replyToProviderMessageId: z.string().trim().min(1).max(500).nullable(),
  text: z.string().max(4096).nullable(),
  buttonPayload: z.string().max(1000).nullable(),
  receivedAt: UtcInstantSchema,
});

export const InboundChannelEventSchema = z.discriminatedUnion("kind", [
  ChannelDeliveryStatusEventSchema,
  ChannelUserReplyEventSchema,
]);

// Clave de idempotencia de un evento entrante (el proveedor reintenta entregas).
export function inboundEventKey(event: z.infer<typeof InboundChannelEventSchema>): string {
  return event.kind === "delivery_status"
    ? `${event.channel}:status:${event.providerMessageId}:${event.status}`
    : `${event.channel}:reply:${event.providerMessageId}`;
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;
export type NotificationEventType = z.infer<typeof NotificationEventTypeSchema>;
export type NotificationDeliveryStatus = z.infer<typeof NotificationDeliveryStatusSchema>;
export type NotificationIntent = z.infer<typeof NotificationIntentSchema>;
export type NotificationRecipient = z.infer<typeof NotificationRecipientSchema>;
export type OutboundNotificationResult = z.infer<typeof OutboundNotificationResultSchema>;
export type ChannelDeliveryStatusEvent = z.infer<typeof ChannelDeliveryStatusEventSchema>;
export type ChannelUserReplyEvent = z.infer<typeof ChannelUserReplyEventSchema>;
export type InboundChannelEvent = z.infer<typeof InboundChannelEventSchema>;
