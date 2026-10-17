import { nanoid } from "nanoid";
import {
  GmailConnectCommandSchema,
  GmailConnectLinkSchema,
  type GmailConnectCommand,
  type GmailConnectLink,
} from "../../../shared/schemas/gmail-connection.ts";
import { getAppUrl, getComposioAuthConfigId } from "../../../lib/composio.ts";
import { createComposioGmailPort } from "./composio-adapter.ts";
import { createPrismaMailboxRepo, type MailboxRepo } from "./mailbox-repo.ts";
import type { GmailComposioPort } from "./ports.ts";

export async function connectMailbox(
  command: GmailConnectCommand,
  deps?: { composio?: GmailComposioPort; repo?: MailboxRepo; authConfigId?: string; appUrl?: string },
): Promise<GmailConnectLink> {
  const parsed = GmailConnectCommandSchema.parse(command);
  const composio = deps?.composio ?? createComposioGmailPort();
  const repo = deps?.repo ?? createPrismaMailboxRepo();
  const authConfigId = deps?.authConfigId ?? getComposioAuthConfigId();
  const appUrl = deps?.appUrl ?? getAppUrl();
  const connectionId = `gc_${nanoid()}`;
  const callbackUrl = `${appUrl}/api/gmail/callback?connectionId=${encodeURIComponent(connectionId)}`;

  const linked = await composio.linkAccount({
    userId: parsed.organizationId,
    authConfigId,
    callbackUrl,
  });

  try {
    await repo.createPending({
      id: connectionId,
      organizationId: parsed.organizationId,
      connectedByUserId: parsed.userId,
      composioUserId: parsed.organizationId,
      composioConnectedAccountId: linked.connectedAccountId,
      composioAuthConfigId: authConfigId,
      alias: parsed.alias,
    });
  } catch (error) {
    try {
      await composio.deleteAccount(linked.connectedAccountId);
    } catch {
      // La fila local es la fuente de enrutamiento; no dejar el error de cleanup tapar el original.
    }
    throw error;
  }

  return GmailConnectLinkSchema.parse({
    connectionId,
    redirectUrl: linked.redirectUrl,
    status: "pending",
  });
}
