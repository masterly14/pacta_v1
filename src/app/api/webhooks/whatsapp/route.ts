import { NextResponse } from "next/server";
import { resolveWhatsAppHandshake, verifyWhatsAppSignature } from "@/features/notifications/channels/whatsapp/verify";
import { processInboundEvents } from "@/features/notifications/inbound/process-inbound";
import { createPrismaInboundRepo } from "@/features/notifications/inbound/repo";
import { getWhatsAppAppSecret, getWhatsAppPhoneNumberId, getWhatsAppVerifyToken } from "@/lib/whatsapp";
import { WHATSAPP_SIGNATURE_HEADER, parseWhatsAppWebhook } from "@/shared/schemas/whatsapp-webhook";

// GET: handshake de suscripción de Meta. Responde el challenge solo con el verify token correcto.
export async function GET(request: Request) {
  let verifyToken: string;
  try {
    verifyToken = getWhatsAppVerifyToken();
  } catch {
    return NextResponse.json({ error: "Webhook de WhatsApp no configurado" }, { status: 500 });
  }
  const challenge = resolveWhatsAppHandshake(new URL(request.url).searchParams, verifyToken);
  if (challenge === null) {
    return NextResponse.json({ error: "Verificación inválida" }, { status: 403 });
  }
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

// POST: firma sobre el cuerpo crudo → parse Zod → solo remitentes guardados → registro idempotente.
// Una respuesta de WhatsApp es evidencia no confiable: NUNCA aprueba ni rechaza pagos.
export async function POST(request: Request) {
  let appSecret: string;
  let phoneNumberId: string;
  try {
    appSecret = getWhatsAppAppSecret();
    phoneNumberId = getWhatsAppPhoneNumberId();
  } catch {
    return NextResponse.json({ error: "Webhook de WhatsApp no configurado" }, { status: 500 });
  }

  const rawBody = await request.text();
  if (!verifyWhatsAppSignature(rawBody, request.headers.get(WHATSAPP_SIGNATURE_HEADER), appSecret)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = parseWhatsAppWebhook(payload, phoneNumberId);
  if (!parsed.ok) {
    console.warn("[whatsapp] webhook ignorado", { reason: parsed.reason });
    return NextResponse.json({ ok: true, ignored: parsed.reason });
  }

  try {
    const outcomes = await processInboundEvents(parsed.events, createPrismaInboundRepo());
    console.info("[whatsapp] webhook", { events: parsed.events.length, ignored: parsed.ignored.length, outcomes: outcomes.map((o) => o.kind) });
    return NextResponse.json({ ok: true, processed: outcomes.length });
  } catch (error) {
    // 500 ⇒ Meta reintenta; el registro es idempotente por eventKey.
    console.error("[whatsapp] procesamiento", error instanceof Error ? error.message : "error");
    return NextResponse.json({ error: "Error de procesamiento" }, { status: 500 });
  }
}
