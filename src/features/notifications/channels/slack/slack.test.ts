import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { NotificationIntent } from "@/shared/schemas/notification";
import { escapeSlackText, renderSlackMessage } from "./blocks";
import { SlackOutboundMessageSchema } from "./types";
import { verifySlackSignature } from "./verify";

const SECRET = "test-signing-secret";
const NOW = 1_800_000_000;

function sign(body: string, timestamp: string, secret = SECRET): string {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

describe("verifySlackSignature", () => {
  const body = '{"type":"event_callback"}';
  const ts = String(NOW);
  const base = { rawBody: body, timestampHeader: ts, signingSecret: SECRET, nowSeconds: NOW };

  it("acepta una firma válida", () => {
    expect(verifySlackSignature({ ...base, signatureHeader: sign(body, ts) })).toBe(true);
  });
  it("rechaza cuerpo alterado", () => {
    expect(verifySlackSignature({ ...base, rawBody: body + " ", signatureHeader: sign(body, ts) })).toBe(false);
  });
  it("rechaza otro secreto", () => {
    expect(verifySlackSignature({ ...base, signatureHeader: sign(body, ts, "otro") })).toBe(false);
  });
  it("rechaza replay fuera de ventana", () => {
    const old = String(NOW - 301);
    expect(verifySlackSignature({ ...base, timestampHeader: old, signatureHeader: sign(body, old) })).toBe(false);
  });
  it("rechaza cabeceras ausentes o malformadas y secreto vacío", () => {
    expect(verifySlackSignature({ ...base, signatureHeader: null })).toBe(false);
    expect(verifySlackSignature({ ...base, timestampHeader: null, signatureHeader: sign(body, ts) })).toBe(false);
    expect(verifySlackSignature({ ...base, timestampHeader: "abc", signatureHeader: sign(body, ts) })).toBe(false);
    expect(verifySlackSignature({ ...base, signatureHeader: "v0=zz" })).toBe(false);
    expect(verifySlackSignature({ ...base, signingSecret: "", signatureHeader: sign(body, ts, "") })).toBe(false);
  });
});

function intent(overrides: Partial<NotificationIntent> = {}): NotificationIntent {
  return {
    schemaVersion: 1,
    notificationId: "n1",
    idempotencyKey: "slack:aprobacion_solicitada:d1",
    organizationId: "org1",
    eventType: "aprobacion_solicitada",
    recipientId: "slack:C0123ABCD",
    createdAt: "2026-10-17T10:00:00Z",
    invoiceId: "inv1",
    decisionId: "d1",
    approvalRequestId: "ar1",
    decision: "requiere_aprobacion",
    reasonCodes: ["REQUIERE_APROBACION_HUMANA"],
    policyVersion: 3,
    amountMinor: 123456,
    currency: "USD",
    supplierName: "Proveedor Ficticio SA",
    invoiceNumber: "F-001",
    deepLinkPath: "/platform/approvals",
    ...overrides,
  };
}

describe("renderSlackMessage", () => {
  it("genera un mensaje válido con enlace al dashboard", () => {
    const message = SlackOutboundMessageSchema.parse(renderSlackMessage(intent(), "C0123ABCD", "https://app.example.com"));
    expect(message.text).toContain("1234.56 USD");
    expect(JSON.stringify(message.blocks)).toContain("https://app.example.com/platform/approvals");
  });

  it("neutraliza menciones y enlaces del texto no confiable", () => {
    const hostile = intent({ supplierName: "<!channel> <@U123> <https://evil.test|click>", invoiceNumber: "<!here>" });
    const json = JSON.stringify(renderSlackMessage(hostile, "C0123ABCD", "https://app.example.com"));
    expect(json).not.toContain("<!channel>");
    expect(json).not.toContain("<!here>");
    expect(json).not.toContain("<@U123>");
    expect(json).not.toContain("evil.test");
  });

  it("nunca dice que una aprobación fue pagada", () => {
    const approved = intent({
      eventType: "decision_aprobada_simulada",
      decision: "aprobada",
      approvalRequestId: null,
      reasonCodes: ["REGLAS_AUTOAPROBACION_CUMPLIDAS"],
    });
    const json = JSON.stringify(renderSlackMessage(approved, "C0123ABCD", "https://app.example.com")).toLowerCase();
    expect(json).toContain("pago simulado");
    expect(json).not.toMatch(/\bpagada\b/);
  });

  it("muestra importe desconocido sin inventar cero", () => {
    const unknown = intent({ amountMinor: null, currency: null });
    expect(renderSlackMessage(unknown, "C0123ABCD", "https://app.example.com").text).toContain("No disponible");
  });
});

describe("escapeSlackText", () => {
  it("escapa los caracteres que Slack interpreta", () => {
    expect(escapeSlackText("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });
});
