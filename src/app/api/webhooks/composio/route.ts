import { after, NextResponse } from "next/server";
import { createComposioGmailPort } from "@/features/invoices/gmail/composio-adapter";
import { downloadGmailMessage } from "@/features/invoices/gmail/download-gmail-message";
import { ingestSignedWebhook } from "@/features/invoices/gmail/ingest-webhook";
import { getComposioWebhookSecret } from "@/lib/composio";

export async function POST(request: Request) {
  let secret: string;
  try {
    secret = getComposioWebhookSecret();
  } catch {
    return NextResponse.json({ error: "Webhook de Composio no configurado" }, { status: 500 });
  }

  const accepted = await ingestSignedWebhook(
    async () => {
      const parsed = await createComposioGmailPort().parseWebhook(request, secret);
      return parsed.rawPayload;
    },
  );
  if (accepted.httpStatus === 401) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }
  const result = accepted.result;
  console.info("[gmail] webhook", result);
  if (result?.outcome === "received") {
    after(async () => {
      try {
        const download = await downloadGmailMessage(result.inboundId);
        console.info("[gmail] download", { inboundId: result.inboundId, ...download });
      } catch (error) {
        console.error("[gmail] download", error);
      }
    });
  }
  return NextResponse.json({ ok: true, ...result });
}
