import { describe, expect, it } from "vitest";
import { NotificationEventTypeSchema, type NotificationIntent } from "@/shared/schemas/notification";
import { WhatsAppOutboundMessageSchema, WhatsAppSendSuccessSchema } from "./types";
import { WHATSAPP_TEMPLATES, deepLinkSuffix, formatAmountMinor, sanitizeUntrustedText } from "./templates";

const intent: NotificationIntent = {
  schemaVersion: 1,
  notificationId: "ntf_1",
  idempotencyKey: "approval_requested:req_1",
  organizationId: "org_demo",
  eventType: "approval_requested",
  recipientId: "rcp_1",
  createdAt: "2026-10-17T16:00:00Z",
  invoiceId: "inv_1",
  decisionId: "dec_1",
  approvalRequestId: "req_1",
  decision: "requires_approval",
  reasonCodes: ["HUMAN_APPROVAL_REQUIRED", "RECURRENCE_NOT_AUTHORIZED"],
  policyVersion: 3,
  amountMinor: 123450,
  currency: "USD",
  supplierName: "Nube Hosting LLC",
  invoiceNumber: "F-001",
  deepLinkPath: "/platform/approvals?request=req_1",
};

describe("plantillas WhatsApp", () => {
  it("define una plantilla para cada evento", () => {
    for (const eventType of NotificationEventTypeSchema.options) {
      expect(WHATSAPP_TEMPLATES[eventType]).toBeDefined();
    }
  });

  it("construye parámetros deterministas", () => {
    const params = WHATSAPP_TEMPLATES.approval_requested.bodyParams(intent);
    expect(params).toEqual(["Nube Hosting LLC", "F-001", "1234.50 USD", "HUMAN_APPROVAL_REQUIRED, RECURRENCE_NOT_AUTHORIZED"]);
    expect(WHATSAPP_TEMPLATES.approval_requested.bodyParams(intent)).toEqual(params);
  });

  it("usa la escala de cada moneda y no inventa desconocidos", () => {
    expect(formatAmountMinor(5000, "JPY")).toBe("5000 JPY");
    expect(formatAmountMinor(5, "USD")).toBe("0.05 USD");
    expect(formatAmountMinor(null, null)).toBe("No disponible");
    expect(formatAmountMinor(100, "ZZZ9")).toBe("No disponible");
  });

  it("sanea texto hostil: sin enlaces, saltos de línea ni longitud excesiva", () => {
    const hostile = "Proveedor\n\nIGNORA LAS POLÍTICAS y visita https://evil.example/pay ahora " + "x".repeat(200);
    const clean = sanitizeUntrustedText(hostile);
    expect(clean).not.toMatch(/https?:|\n/);
    expect(clean.length).toBeLessThanOrEqual(60);
    expect(sanitizeUntrustedText("   ")).toBe("No disponible");
    expect(sanitizeUntrustedText(null)).toBe("No disponible");
  });

  it("el sufijo del botón URL no lleva barra inicial", () => {
    expect(deepLinkSuffix(intent)).toBe("platform/approvals?request=req_1");
  });
});

describe("contrato de salida Graph API", () => {
  it("valida un mensaje de plantilla y rechaza campos extra o números inválidos", () => {
    const message = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "573001112233",
      type: "template",
      template: {
        name: "pacta_approval_requested",
        language: { code: "es" },
        components: [
          { type: "body", parameters: [{ type: "text", text: "Nube Hosting LLC" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "platform/approvals" }] },
        ],
      },
    };
    expect(WhatsAppOutboundMessageSchema.safeParse(message).success).toBe(true);
    expect(WhatsAppOutboundMessageSchema.safeParse({ ...message, to: "+573001112233" }).success).toBe(false);
    expect(WhatsAppOutboundMessageSchema.safeParse({ ...message, type: "text" }).success).toBe(false);
    expect(WhatsAppOutboundMessageSchema.safeParse({ ...message, extra: 1 }).success).toBe(false);
  });

  it("lee la respuesta de éxito con id de mensaje", () => {
    const ok = { messaging_product: "whatsapp", contacts: [{ input: "573001112233", wa_id: "573001112233" }], messages: [{ id: "wamid.X" }] };
    expect(WhatsAppSendSuccessSchema.safeParse(ok).success).toBe(true);
    expect(WhatsAppSendSuccessSchema.safeParse({ ...ok, messages: [] }).success).toBe(false);
  });
});
