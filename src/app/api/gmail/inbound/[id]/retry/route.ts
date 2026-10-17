import { after, NextResponse } from "next/server";
import { ensureWorkspaceFromSession } from "@/shared/auth/ensure-workspace";
import { retryGmailDownload } from "@/features/invoices/gmail/download-gmail-message";
import { gmailHttpError } from "@/features/invoices/gmail/http";
import { processInboundMessage } from "@/features/invoices/pipeline/process-email";

export const maxDuration = 60;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await ensureWorkspaceFromSession();
    const { id } = await context.params;
    const result = await retryGmailDownload({
      inboundId: id,
      organizationId: workspace.organization.id,
    });
    // Descarga recuperada: las facturas se procesan después de responder.
    if (result.status === "received") {
      after(async () => {
        try {
          await processInboundMessage(id);
        } catch (error) {
          console.error("[invoices] pipeline tras reintento", { inboundId: id, error });
        }
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    return gmailHttpError(error);
  }
}
