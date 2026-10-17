import { toGmailConnectionPublic, type GmailConnectionPublic } from "../../../shared/schemas/gmail-connection.ts";
import { gmailConnectionFromRow } from "./map-connection.ts";
import { createPrismaMailboxRepo, type MailboxRepo } from "./mailbox-repo.ts";

export async function listMailboxes(
  organizationId: string,
  deps?: { repo?: MailboxRepo },
): Promise<GmailConnectionPublic[]> {
  const repo = deps?.repo ?? createPrismaMailboxRepo();
  const rows = await repo.listByOrganization(organizationId);
  return rows.map((row) => toGmailConnectionPublic(gmailConnectionFromRow(row)));
}
