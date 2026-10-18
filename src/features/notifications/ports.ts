import type {
  InboundChannelEvent,
  NotificationChannel,
  NotificationIntent,
  NotificationRecipient,
  OutboundNotificationResult,
} from "@/shared/schemas/notification";

// Puerto que cada canal implementa. El dominio solo habla NotificationIntent / InboundChannelEvent;
// el formato del canal (`TMessage`) no sale del adaptador. Sin lógica de negocio aquí.
export type NotificationChannelAdapter<TMessage = unknown> = {
  readonly channel: NotificationChannel;

  // Puro y determinista: traduce la intención al mensaje del canal. Lanza si el destinatario no es
  // válido para el canal (p. ej. teléfono no E.164); nunca envía.
  render(intent: NotificationIntent, recipient: NotificationRecipient): TMessage;

  // Entrega el mensaje renderizado. Los fallos se devuelven como `rejected`, no se lanzan.
  send(message: TMessage): Promise<OutboundNotificationResult>;

  // Autenticidad del webhook entrante sobre el cuerpo crudo. Falso ⇒ responder 401 sin procesar.
  verifyWebhook(request: Request, rawBody: string): Promise<boolean>;

  // Cuerpo crudo ya verificado → eventos canónicos. Entrada inválida nunca lanza ni autoriza nada.
  parseWebhook(rawBody: string): InboundChannelEvent[];
};

export type NotificationChannelRegistry = Partial<Record<NotificationChannel, NotificationChannelAdapter>>;
