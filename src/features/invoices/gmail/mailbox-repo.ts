import type { Document, GmailConnection, GmailInboundMessage, IgnoredInboundItem } from "@prisma/client";
import { nanoid } from "nanoid";
import { db } from "../../../lib/db.ts";

export type CreatePendingMailboxInput = {
  id: string;
  organizationId: string;
  connectedByUserId: string;
  composioUserId: string;
  composioConnectedAccountId: string;
  composioAuthConfigId: string;
  alias: string | null;
};

export type CreateInboundInput = {
  id: string;
  organizationId: string;
  gmailConnectionId: string;
  composioEventId: string;
  gmailMessageId: string;
  gmailThreadId: string | null;
  sender: string | null;
  subject: string | null;
  receivedAt: Date;
};

export type CreateDocumentInput = {
  id: string;
  organizationId: string;
  gmailInboundMessageId: string;
  fileRef: string;
  publicUrl: string;
  mimeType: string;
  sha256: string;
  originalFilename: string | null;
  source: "email_body" | "invoice_document";
  byteSize: number;
  receivedAt: Date;
};

export type IgnoredItemInput = {
  kind: "attachment" | "message";
  gmailAttachmentId: string | null;
  filename: string | null;
  mimeType: string | null;
  byteSize: number | null;
  reason: IgnoredInboundItem["reason"];
};

export type DocumentGroupInput = {
  id: string;
  kind: "invoice_candidate" | "message_context";
  members: Array<{ documentId: string; role: "primary" | "supporting" }>;
};

export type MailboxRepo = {
  createPending(input: CreatePendingMailboxInput): Promise<GmailConnection>;
  getById(id: string): Promise<GmailConnection | null>;
  getByConnectedAccountId(connectedAccountId: string): Promise<GmailConnection | null>;
  listByOrganization(organizationId: string): Promise<GmailConnection[]>;
  markActive(input: {
    id: string;
    emailAddress: string;
    composioTriggerId: string;
    connectedAt: Date;
  }): Promise<GmailConnection>;
  markFailed(id: string): Promise<GmailConnection>;
  markExpired(connectedAccountId: string): Promise<GmailConnection | null>;
  markRevoked(id: string, revokedAt: Date): Promise<GmailConnection>;
  createInbound(input: CreateInboundInput): Promise<{ created: boolean; row: GmailInboundMessage }>;
  getInboundById(id: string): Promise<GmailInboundMessage | null>;
  setInboundStatus(id: string, status: GmailInboundMessage["processingStatus"]): Promise<void>;
  createDocument(input: CreateDocumentInput): Promise<Document>;
  getDocument(id: string): Promise<Document | null>;
  listDocumentsByInbound(inboundId: string): Promise<Document[]>;
  /** Sustituye lo ignorado del correo: cada intento deja el resultado vigente. */
  replaceIgnoredItems(input: {
    organizationId: string;
    inboundId: string;
    items: IgnoredItemInput[];
  }): Promise<void>;
  listIgnoredItems(input: { organizationId: string; inboundId: string }): Promise<IgnoredInboundItem[]>;
  /** Sustituye los grupos del correo y reasigna sus documentos en una sola transacción. */
  replaceDocumentGroups(input: {
    organizationId: string;
    inboundId: string;
    groups: DocumentGroupInput[];
  }): Promise<void>;
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function createPrismaMailboxRepo(): MailboxRepo {
  return {
    createPending(input) {
      return db.gmailConnection.create({
        data: {
          ...input,
          composioTriggerId: null,
          emailAddress: null,
          status: "pending",
          connectedAt: null,
          revokedAt: null,
        },
      });
    },

    getById(id) {
      return db.gmailConnection.findUnique({ where: { id } });
    },

    getByConnectedAccountId(connectedAccountId) {
      return db.gmailConnection.findUnique({
        where: { composioConnectedAccountId: connectedAccountId },
      });
    },

    listByOrganization(organizationId) {
      return db.gmailConnection.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
      });
    },

    markActive(input) {
      return db.gmailConnection.update({
        where: { id: input.id },
        data: {
          emailAddress: input.emailAddress,
          composioTriggerId: input.composioTriggerId,
          status: "active",
          connectedAt: input.connectedAt,
          revokedAt: null,
        },
      });
    },

    markFailed(id) {
      return db.gmailConnection.update({
        where: { id },
        data: { status: "failed" },
      });
    },

    async markExpired(connectedAccountId) {
      const existing = await db.gmailConnection.findUnique({
        where: { composioConnectedAccountId: connectedAccountId },
      });
      if (!existing || existing.status === "revoked") {
        return existing;
      }
      return db.gmailConnection.update({
        where: { id: existing.id },
        data: { status: "expired" },
      });
    },

    markRevoked(id, revokedAt) {
      return db.gmailConnection.update({
        where: { id },
        data: {
          status: "revoked",
          revokedAt,
          emailAddress: null,
          composioTriggerId: null,
        },
      });
    },

    async createInbound(input) {
      try {
        const row = await db.gmailInboundMessage.create({
          data: {
            ...input,
            processingStatus: "received",
            invoiceId: null,
          },
        });
        return { created: true, row };
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        const existing = await db.gmailInboundMessage.findFirst({
          where: {
            OR: [
              { composioEventId: input.composioEventId },
              {
                gmailConnectionId: input.gmailConnectionId,
                gmailMessageId: input.gmailMessageId,
              },
            ],
          },
        });
        if (!existing) {
          throw error;
        }
        return { created: false, row: existing };
      }
    },

    getInboundById(id) {
      return db.gmailInboundMessage.findUnique({ where: { id } });
    },

    async setInboundStatus(id, status) {
      await db.gmailInboundMessage.update({
        where: { id },
        data: { processingStatus: status },
      });
    },

    createDocument(input) {
      return db.document.create({ data: input });
    },

    getDocument(id) {
      return db.document.findUnique({ where: { id } });
    },

    listDocumentsByInbound(inboundId) {
      return db.document.findMany({
        where: { gmailInboundMessageId: inboundId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
    },

    async replaceIgnoredItems({ organizationId, inboundId, items }) {
      await db.$transaction([
        db.ignoredInboundItem.deleteMany({
          where: { organizationId, gmailInboundMessageId: inboundId },
        }),
        db.ignoredInboundItem.createMany({
          data: items.map((item) => ({
            ...item,
            id: `ign_${nanoid()}`,
            organizationId,
            gmailInboundMessageId: inboundId,
          })),
        }),
      ]);
    },

    listIgnoredItems({ organizationId, inboundId }) {
      return db.ignoredInboundItem.findMany({
        where: { organizationId, gmailInboundMessageId: inboundId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
    },

    async replaceDocumentGroups({ organizationId, inboundId, groups }) {
      await db.$transaction(async (tx) => {
        // onDelete: SetNull suelta los documentos antes de reasignarlos.
        await tx.documentGroup.deleteMany({
          where: { organizationId, gmailInboundMessageId: inboundId },
        });
        for (const group of groups) {
          await tx.documentGroup.create({
            data: {
              id: group.id,
              organizationId,
              gmailInboundMessageId: inboundId,
              kind: group.kind,
            },
          });
          for (const member of group.members) {
            await tx.document.updateMany({
              where: { id: member.documentId, organizationId, gmailInboundMessageId: inboundId },
              data: { groupId: group.id, groupRole: member.role },
            });
          }
        }
      });
    },
  };
}
