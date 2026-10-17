import { z } from "zod";
import { EntityIdSchema, UtcInstantSchema } from "./invoice-context.ts";
import { ComposioEventIdSchema, type GmailNewMessageEvent } from "./composio-webhook.ts";

// Mensaje de Gmail ya asociado a un buzón de la organización.
// Unicidad de negocio: (gmailConnectionId, gmailMessageId). El id de Gmail es por buzón.
// El estado failed se conserva para reintento; no se borra para volver a aprobar.

export const GmailInboundProcessingStatusSchema = z.enum([
  "received",
  "processing",
  "processed",
  "failed",
  "ignored",
]);

export const GmailInboundMessageSchema = z
  .strictObject({
    id: EntityIdSchema,
    organizationId: EntityIdSchema,
    gmailConnectionId: EntityIdSchema,
    composioEventId: ComposioEventIdSchema,
    gmailMessageId: z.string().min(1).max(200),
    gmailThreadId: z.string().min(1).max(200).nullable(),
    sender: z.string().min(1).max(500).nullable(),
    subject: z.string().min(1).max(998).nullable(),
    receivedAt: UtcInstantSchema,
    processingStatus: GmailInboundProcessingStatusSchema,
    invoiceId: EntityIdSchema.nullable(),
  })
  .superRefine((message, ctx) => {
    if (message.processingStatus === "processed" && message.invoiceId === null) {
      ctx.addIssue({
        code: "custom",
        path: ["invoiceId"],
        message: "Un mensaje processed requiere invoiceId del InvoiceContext",
      });
    }
  });

export function gmailInboundFromTrigger(input: {
  id: string;
  organizationId: string;
  gmailConnectionId: string;
  event: GmailNewMessageEvent;
}): z.infer<typeof GmailInboundMessageSchema> {
  return GmailInboundMessageSchema.parse({
    id: input.id,
    organizationId: input.organizationId,
    gmailConnectionId: input.gmailConnectionId,
    composioEventId: input.event.composioEventId,
    gmailMessageId: input.event.data.messageId,
    gmailThreadId: input.event.data.threadId,
    sender: input.event.data.sender,
    subject: input.event.data.subject,
    receivedAt: input.event.receivedAt,
    processingStatus: "received",
    invoiceId: null,
  });
}

export type GmailInboundProcessingStatus = z.infer<typeof GmailInboundProcessingStatusSchema>;
export type GmailInboundMessage = z.infer<typeof GmailInboundMessageSchema>;
