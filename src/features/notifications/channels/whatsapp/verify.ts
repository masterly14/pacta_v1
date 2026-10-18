import { createHmac, timingSafeEqual } from "node:crypto";
import { WHATSAPP_SIGNATURE_PREFIX, WhatsAppVerificationQuerySchema } from "@/shared/schemas/whatsapp-webhook";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(cuerpo CRUDO, app secret) en hex.
// Fail-closed: cualquier cabecera ausente o malformada es inválida.
export function verifyWhatsAppSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith(WHATSAPP_SIGNATURE_PREFIX) || appSecret.length === 0) {
    return false;
  }
  const received = signatureHeader.slice(WHATSAPP_SIGNATURE_PREFIX.length);
  if (!/^[0-9a-f]{64}$/i.test(received)) {
    return false;
  }
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return safeEqual(received.toLowerCase(), expected);
}

// Handshake GET de suscripción: devuelve el challenge solo si modo y token coinciden.
export function resolveWhatsAppHandshake(searchParams: URLSearchParams, verifyToken: string): string | null {
  const parsed = WhatsAppVerificationQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success || verifyToken.length === 0) {
    return null;
  }
  return safeEqual(parsed.data["hub.verify_token"], verifyToken) ? parsed.data["hub.challenge"] : null;
}
