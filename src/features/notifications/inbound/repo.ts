import { nanoid } from "nanoid";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { InboundRepo } from "./process-inbound";

export function createPrismaInboundRepo(): InboundRepo {
  return {
    async findActiveRecipient(channel, address) {
      const row = await db.notificationRecipient.findFirst({
        where: { channel, address, status: "active" },
        select: { id: true, organizationId: true },
      });
      return row ? { recipientId: row.id, organizationId: row.organizationId } : null;
    },

    async listPendingApprovalIds(organizationId) {
      const rows = await db.approvalRequest.findMany({
        where: { organizationId, status: "pendiente" },
        select: { id: true },
        orderBy: { requestedAt: "asc" },
      });
      return rows.map((row) => row.id);
    },

    async saveInbound(input) {
      try {
        await db.$transaction(async (tx) => {
          const message = await tx.inboundChannelMessage.create({
            data: {
              id: `icm_${nanoid()}`,
              organizationId: input.organizationId,
              recipientId: input.recipientId,
              channel: input.channel,
              eventKey: input.eventKey,
              providerMessageId: input.event.providerMessageId,
              replyToProviderMessageId: input.event.replyToProviderMessageId,
              text: input.event.text,
              buttonPayload: input.event.buttonPayload,
              claimedAction: input.claimedAction,
              context: input.context,
              approvalRequestId: input.approvalRequestId,
              receivedAt: new Date(input.event.receivedAt),
            },
          });
          await tx.auditEvent.create({
            data: {
              organizationId: input.organizationId,
              entityType: "inbound_channel_message",
              entityId: message.id,
              eventType: "respuesta_canal_recibida",
              actorId: null,
              payload: {
                channel: input.channel,
                context: input.context,
                approvalRequestId: input.approvalRequestId,
                claimedAction: input.claimedAction,
                pendingRequestIds: input.pendingRequestIds,
                resolvedApproval: false, // una respuesta de chat nunca resuelve la solicitud
              },
            },
          });
        });
        return { created: true };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return { created: false };
        }
        throw error;
      }
    },
  };
}
