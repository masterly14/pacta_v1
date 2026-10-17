import { NextResponse } from "next/server";
import { ensureWorkspaceFromSession } from "@/shared/auth/ensure-workspace";
import { retryGmailDownload } from "@/features/invoices/gmail/download-gmail-message";
import { gmailHttpError } from "@/features/invoices/gmail/http";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await ensureWorkspaceFromSession();
    const { id } = await context.params;
    const result = await retryGmailDownload({
      inboundId: id,
      organizationId: workspace.organization.id,
    });
    return NextResponse.json(result);
  } catch (error) {
    return gmailHttpError(error);
  }
}
