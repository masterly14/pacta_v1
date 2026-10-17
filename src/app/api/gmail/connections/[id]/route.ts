import { NextResponse } from "next/server";
import { ensureWorkspaceFromSession } from "@/shared/auth/ensure-workspace";
import { gmailHttpError } from "@/features/invoices/gmail/http";
import { revokeMailbox } from "@/features/invoices/gmail/revoke-mailbox";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await ensureWorkspaceFromSession();
    const { id } = await context.params;
    const connection = await revokeMailbox({
      connectionId: id,
      organizationId: workspace.organization.id,
    });
    return NextResponse.json({ connection });
  } catch (error) {
    return gmailHttpError(error);
  }
}
