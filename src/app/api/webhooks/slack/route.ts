import { NextResponse } from "next/server";
import { createSlackAdapter } from "@/features/notifications/channels/slack/adapter";

// Webhook de Slack. Slack es solo de SALIDA: este endpoint existe para pasar la verificación de URL
// de Slack y para rechazar tráfico no firmado. Ningún evento entrante aprueba, rechaza ni cambia nada.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const adapter = createSlackAdapter();

  // Firma sobre el cuerpo crudo + ventana anti-replay, antes de interpretar el contenido.
  if (!(await adapter.verifyWebhook(request, rawBody))) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Handshake de Event Subscriptions: se devuelve el challenge (ya autenticado por la firma).
  if (
    typeof payload === "object" &&
    payload !== null &&
    (payload as { type?: unknown }).type === "url_verification" &&
    typeof (payload as { challenge?: unknown }).challenge === "string"
  ) {
    return new Response((payload as { challenge: string }).challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }

  return NextResponse.json({ ok: true, ignored: "slack_es_solo_salida" });
}
