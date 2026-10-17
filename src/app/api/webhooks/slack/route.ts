import { NextResponse } from "next/server";

// Webhook de Slack. Pendiente: verificar la firma con SLACK_SIGNING_SECRET
// antes de procesar cualquier payload.
export async function POST() {
  return NextResponse.json({ error: "No implementado" }, { status: 501 });
}
