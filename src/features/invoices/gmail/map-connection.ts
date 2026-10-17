import type { GmailConnection as PrismaGmailConnection } from "@prisma/client";
import { GmailConnectionSchema, type GmailConnection } from "../../../shared/schemas/gmail-connection.ts";

export function gmailConnectionFromRow(row: PrismaGmailConnection): GmailConnection {
  return GmailConnectionSchema.parse({
    id: row.id,
    organizationId: row.organizationId,
    connectedByUserId: row.connectedByUserId,
    composioUserId: row.composioUserId,
    composioConnectedAccountId: row.composioConnectedAccountId,
    composioAuthConfigId: row.composioAuthConfigId,
    composioTriggerId: row.composioTriggerId,
    emailAddress: row.emailAddress,
    alias: row.alias,
    status: row.status,
    connectedAt: row.connectedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  });
}
