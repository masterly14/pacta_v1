import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationIntent, NotificationRecipient } from "@/shared/schemas/notification";
import { createWhatsAppAdapter } from "./adapter";

const recipient: NotificationRecipient = {
  recipientId: "rcp_1",
  organizationId: "org_demo",
  channel: "whatsapp",
  address: "573001112233",
  locale: "es",
  verifiedAt: "2026-10-17T16:00:00Z",
  status: "active",
};

function intent(overrides: Partial<NotificationIntent> = {}): NotificationIntent {
  return {
    schemaVersion: 1,
    notificationId: "ntf_1",
    idempotencyKey: "whatsapp:aprobacion_solicitada:dec_1:rcp_1",
    organizationId: "org_demo",
    eventType: "aprobacion_solicitada",
    recipientId: "rcp_1",
    createdAt: "2026-10-17T16:00:00Z",
    invoiceId: "inv_1",
    decisionId: "dec_1",
    approvalRequestId: "apr_1",
    decision: "requiere_aprobacion",
    reasonCodes: ["REQUIERE_APROBACION_HUMANA", "MONTO_EXCEDE_LIMITE"],
    policyVersion: 3,
    amountMinor: 15000,
    currency: "USD",
    supplierName: "Papelería Central",
    invoiceNumber: "F-100",
    deepLinkPath: "/platform/approvals",
    ...overrides,
  };
}

describe("adaptador WhatsApp: render", () => {
  const adapter = createWhatsAppAdapter();

  it("una aprobación pendiente lleva tres botones: Pagar, Rechazar y Más detalles", () => {
    const message = adapter.render(intent(), recipient);
    expect(message.template.name).toBe("pacta_aprobacion_requerida");
    expect(message.to).toBe("573001112233");
    const buttons = message.template.components.filter((c) => c.type === "button");
    expect(buttons.map((b) => (b.parameters[0] as { payload: string }).payload)).toEqual(["pagar:apr_1", "rechazar:apr_1", "detalles:apr_1"]);
    expect(buttons.map((b) => b.index)).toEqual(["0", "1", "2"]);
    const body = message.template.components.find((c) => c.type === "body");
    expect((body?.parameters as { text: string }[]).map((p) => p.text)).toEqual(["Papelería Central", "F-100", "150.00 USD", "El monto supera el límite autorizado"]);
  });

  it("los demás eventos llevan el estado en español y un botón al dashboard", () => {
    const blocked = adapter.render(
      intent({ eventType: "decision_bloqueada", decision: "bloqueada", approvalRequestId: null, reasonCodes: ["FACTURA_DUPLICADA"], deepLinkPath: "/platform/invoices/inv_1" }),
      recipient,
    );
    expect(blocked.template.name).toBe("pacta_estado_factura");
    const body = blocked.template.components.find((c) => c.type === "body");
    expect((body?.parameters as { text: string }[]).map((p) => p.text)).toContain("Bloqueada");
    const button = blocked.template.components.find((c) => c.type === "button");
    expect(button).toMatchObject({ sub_type: "url", parameters: [{ text: "platform/invoices/inv_1" }] });
  });

  it("rechaza un teléfono que no es E.164 sin '+'", () => {
    expect(() => adapter.render(intent(), { ...recipient, address: "+573001112233" })).toThrow();
  });
});

describe("adaptador WhatsApp: send", () => {
  const adapter = createWhatsAppAdapter();
  const message = adapter.render(intent(), recipient);

  beforeEach(() => {
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token-de-prueba");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1234567890");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("acepta la respuesta de Graph y devuelve el id del mensaje", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: "wamid.OK" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(adapter.send(message)).resolves.toEqual({ status: "accepted", providerMessageId: "wamid.OK" });
    expect(fetchMock.mock.calls[0]![0]).toContain("/1234567890/messages");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer token-de-prueba" });
  });

  it("un error de Graph se devuelve como rechazado, sin lanzar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 132001, message: "template" } }), { status: 400 })));
    await expect(adapter.send(message)).resolves.toEqual({ status: "rejected", errorCode: "graph_132001", retryable: false });
  });

  it("un fallo de red no lanza y es reintentable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    await expect(adapter.send(message)).resolves.toEqual({ status: "rejected", errorCode: "network_error", retryable: true });
  });
});
