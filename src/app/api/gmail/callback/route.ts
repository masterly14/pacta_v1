import { NextResponse } from "next/server";
import { ensureWorkspaceFromSession } from "@/shared/auth/ensure-workspace";
import { completeGmailOauth } from "@/features/invoices/gmail/complete-oauth";
import { gmailHttpError } from "@/features/invoices/gmail/http";
import { getAppUrl } from "@/lib/composio";

export async function GET(request: Request) {
  try {
    const workspace = await ensureWorkspaceFromSession();
    const url = new URL(request.url);
    const connectionId = url.searchParams.get("connectionId");
    if (!connectionId) {
      return NextResponse.json({ error: "Falta connectionId" }, { status: 400 });
    }
    const result = await completeGmailOauth({
      connectionId,
      organizationId: workspace.organization.id,
    });
    return NextResponse.redirect(
      `${getAppUrl()}/platform/integrations?gmail=${result.status}`,
    );
  } catch (error) {
    try {
      return NextResponse.redirect(`${getAppUrl()}/platform/integrations?gmail=failed`);
    } catch {
      return gmailHttpError(error);
    }
  }
}
