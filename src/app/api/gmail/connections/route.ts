import { NextResponse } from "next/server";
import { ensureWorkspaceFromSession } from "@/shared/auth/ensure-workspace";
import { GmailConnectRequestBodySchema } from "@/shared/schemas/gmail-connection";
import { connectMailbox } from "@/features/invoices/gmail/connect-mailbox";
import { gmailHttpError } from "@/features/invoices/gmail/http";
import { listMailboxes } from "@/features/invoices/gmail/list-mailboxes";

export async function GET() {
  try {
    const workspace = await ensureWorkspaceFromSession();
    const connections = await listMailboxes(workspace.organization.id);
    return NextResponse.json({ connections });
  } catch (error) {
    return gmailHttpError(error);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await ensureWorkspaceFromSession();
    const json = (await request.json().catch(() => ({}))) as { alias?: string | null };
    const body = GmailConnectRequestBodySchema.parse({ alias: json.alias ?? null });
    const link = await connectMailbox({
      organizationId: workspace.organization.id,
      userId: workspace.user.id,
      alias: body.alias,
    });
    return NextResponse.json(link);
  } catch (error) {
    return gmailHttpError(error);
  }
}
