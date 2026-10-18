import { createHmac, timingSafeEqual } from "node:crypto";

export const SLACK_SIGNATURE_VERSION = "v0";
// Ventana anti-replay recomendada por Slack.
export const SLACK_MAX_TIMESTAMP_SKEW_SECONDS = 5 * 60;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// X-Slack-Signature = "v0=" + HMAC-SHA256("v0:{timestamp}:{cuerpo CRUDO}", signing secret) en hex.
// Fail-closed: cabeceras ausentes, malformadas, secreto vacío o timestamp fuera de ventana ⇒ inválido.
export function verifySlackSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  signingSecret: string;
  nowSeconds?: number;
}): boolean {
  const { rawBody, signatureHeader, timestampHeader, signingSecret } = input;
  if (!signatureHeader || !timestampHeader || signingSecret.length === 0) {
    return false;
  }
  if (!/^\d{1,12}$/.test(timestampHeader)) {
    return false;
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestampHeader)) > SLACK_MAX_TIMESTAMP_SKEW_SECONDS) {
    return false;
  }
  const prefix = `${SLACK_SIGNATURE_VERSION}=`;
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }
  const received = signatureHeader.slice(prefix.length);
  if (!/^[0-9a-f]{64}$/i.test(received)) {
    return false;
  }
  const expected = createHmac("sha256", signingSecret)
    .update(`${SLACK_SIGNATURE_VERSION}:${timestampHeader}:${rawBody}`, "utf8")
    .digest("hex");
  return safeEqual(received.toLowerCase(), expected);
}
