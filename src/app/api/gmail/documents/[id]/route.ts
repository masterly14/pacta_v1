import { NextResponse } from "next/server";
import { ensureWorkspaceFromSession } from "@/shared/auth/ensure-workspace";
import { getOrganizationDocument } from "@/features/invoices/gmail/get-document";
import { gmailHttpError } from "@/features/invoices/gmail/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await ensureWorkspaceFromSession();
    const { id } = await context.params;
    const document = await getOrganizationDocument({
      documentId: id,
      organizationId: workspace.organization.id,
    });
    return NextResponse.json(document);
  } catch (error) {
    return gmailHttpError(error);
  }
}
