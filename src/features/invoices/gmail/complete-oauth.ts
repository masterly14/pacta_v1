import { NormalizedEmailSchema, gmailConnectionStatusFromComposio } from "../../../shared/schemas/gmail-connection.ts";
import { createComposioGmailPort } from "./composio-adapter.ts";
import { gmailConnectionFromRow } from "./map-connection.ts";
import { createPrismaMailboxRepo, type MailboxRepo } from "./mailbox-repo.ts";
import type { GmailComposioPort } from "./ports.ts";

export class MailboxNotFoundError extends Error {
  constructor() {
    super("No existe esa conexión de Gmail");
    this.name = "MailboxNotFoundError";
  }
}

export class MailboxOrgMismatchError extends Error {
  constructor() {
    super("La conexión de Gmail no pertenece a esta organización");
    this.name = "MailboxOrgMismatchError";
  }
}

export type CompleteOauthResult = {
  status: "active" | "pending" | "failed";
  connectionId: string;
};

export async function completeGmailOauth(
  input: { connectionId: string; organizationId: string },
  deps?: { composio?: GmailComposioPort; repo?: MailboxRepo },
): Promise<CompleteOauthResult> {
  const composio = deps?.composio ?? createComposioGmailPort();
  const repo = deps?.repo ?? createPrismaMailboxRepo();
  const row = await repo.getById(input.connectionId);
  if (!row) {
    throw new MailboxNotFoundError();
  }
  if (row.organizationId !== input.organizationId) {
    throw new MailboxOrgMismatchError();
  }
  if (row.status === "active") {
    return { status: "active", connectionId: row.id };
  }
  if (row.status === "revoked") {
    throw new MailboxNotFoundError();
  }

  let accountStatus: string;
  try {
    const waited = await composio.waitForAccount(row.composioConnectedAccountId, 20_000);
    accountStatus = waited.status;
  } catch {
    const current = await composio.getAccount(row.composioConnectedAccountId);
    accountStatus = current?.status ?? "INITIATED";
  }

  const mapped = gmailConnectionStatusFromComposio(accountStatus);
  if (mapped === "failed" || mapped === "expired") {
    await repo.markFailed(row.id);
    return { status: "failed", connectionId: row.id };
  }
  if (mapped !== "active") {
    return { status: "pending", connectionId: row.id };
  }

  const profile = await composio.getGmailProfile({
    userId: row.composioUserId,
    connectedAccountId: row.composioConnectedAccountId,
  });
  const email = profile.email ? profile.email.trim().toLowerCase() : null;
  const parsedEmail = email ? NormalizedEmailSchema.safeParse(email) : null;
  if (!parsedEmail?.success) {
    await repo.markFailed(row.id);
    return { status: "failed", connectionId: row.id };
  }

  const trigger = await composio.createInboxTrigger({
    userId: row.composioUserId,
    connectedAccountId: row.composioConnectedAccountId,
  });

  try {
    const active = await repo.markActive({
      id: row.id,
      emailAddress: parsedEmail.data,
      composioTriggerId: trigger.triggerId,
      connectedAt: new Date(),
    });
    gmailConnectionFromRow(active);
    return { status: "active", connectionId: active.id };
  } catch {
    await repo.markFailed(row.id);
    return { status: "failed", connectionId: row.id };
  }
}
