// Pista de un botón: "pay:<id>" | "reject:<id>" | "details:<id>". Es TEXTO NO CONFIABLE: solo
// sirve para ubicar el contexto; nunca resuelve nada.
export const REPLY_ACTIONS = ["pay", "reject", "details"] as const;
export type ReplyAction = (typeof REPLY_ACTIONS)[number];

export type ReplyReference = { claimedAction: ReplyAction; approvalRequestId: string };

const PATTERN = /^(pay|reject|details):([A-Za-z0-9_-]{1,200})$/;

export function buildReplyPayload(action: ReplyAction, approvalRequestId: string): string {
  return `${action}:${approvalRequestId}`;
}

export function parseReplyReference(buttonPayload: string | null): ReplyReference | null {
  if (buttonPayload === null) {
    return null;
  }
  const match = PATTERN.exec(buttonPayload.trim());
  return match ? { claimedAction: match[1] as ReplyAction, approvalRequestId: match[2]! } : null;
}
