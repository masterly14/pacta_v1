import { NextResponse } from "next/server";

// Webhook de Resend (correos entrantes y eventos). Pendiente: verificar la
// firma con RESEND_WEBHOOK_SECRET antes de procesar cualquier payload.
export async function POST() {
  return NextResponse.json({ error: "No implementado" }, { status: 501 });
}
