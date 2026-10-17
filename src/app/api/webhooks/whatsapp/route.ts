import { NextResponse } from "next/server";

// Webhook de WhatsApp. Pendiente: verificación GET con WHATSAPP_VERIFY_TOKEN
// y validación de mensajes entrantes con WHATSAPP_ACCESS_TOKEN.
export async function GET() {
  return NextResponse.json({ error: "No implementado" }, { status: 501 });
}

export async function POST() {
  return NextResponse.json({ error: "No implementado" }, { status: 501 });
}
