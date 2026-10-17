import { createComposioGmailPort } from "./composio-adapter.ts";
import { MailboxNotFoundError, MailboxOrgMismatchError } from "./complete-oauth.ts";
import { gmailConnectionFromRow } from "./map-connection.ts";
import { createPrismaMailboxRepo, type MailboxRepo } from "./mailbox-repo.ts";
import type { GmailComposioPort } from "./ports.ts";
import { toGmailConnectionPublic, type GmailConnectionPublic } from "../../../shared/schemas/gmail-connection.ts";

export async function revokeMailbox(
  input: { connectionId: string; organizationId: string },
  deps?: { composio?: GmailComposioPort; repo?: MailboxRepo },
): Promise<GmailConnectionPublic> {
  const composio = deps?.composio ?? createComposioGmailPort();
  const repo = deps?.repo ?? createPrismaMailboxRepo();
  const row = await repo.getById(input.connectionId);
  if (!row) {
    throw new MailboxNotFoundError();
  }
  if (row.organizationId !== input.organizationId) {
    throw new MailboxOrgMismatchError();
  }
  if (row.status === "revoked") {
    return toGmailConnectionPublic(gmailConnectionFromRow(row));
  }

  if (row.composioTriggerId) {
    try {
      await composio.deleteTrigger(row.composioTriggerId);
    } catch {
      // Seguir: hay que dejar el buzón revocado en Pacta aunque Composio falle a medias.
    }
  }
  try {
    await composio.deleteAccount(row.composioConnectedAccountId);
  } catch {
    // Tokens quedan en Composio si falla; el buzón deja de ingerir en Pacta.
  }

  const revoked = await repo.markRevoked(row.id, new Date());
  return toGmailConnectionPublic(gmailConnectionFromRow(revoked));
}
