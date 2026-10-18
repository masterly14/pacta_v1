import { beforeEach, describe, expect, it, vi } from "vitest";
import { decide } from "@/features/decisions/engine/decide";
import { makeFacts, makeInvoice } from "@/features/decisions/engine/test-fixtures";

const whatsappSend = vi.fn();
const slackSend = vi.fn();

const dbMock = vi.hoisted(() => ({
  paymentDecision: { findUnique: vi.fn() },
  approvalRequest: { findUnique: vi.fn() },
  notificationRecipient: { findMany: vi.fn() },
  auditEvent: { findFirst: vi.fn(), create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("./channels/whatsapp/adapter", async () => {
  const actual = await vi.importActual<typeof import("./channels/whatsapp/adapter")>("./channels/whatsapp/adapter");
  return { createWhatsAppAdapter: () => ({ ...actual.createWhatsAppAdapter(), send: whatsappSend }) };
});
vi.mock("./channels/slack/adapter", async () => {
  const actual = await vi.importActual<typeof import("./channels/slack/adapter")>("./channels/slack/adapter");
  return { createSlackAdapter: () => ({ ...actual.createSlackAdapter(), send: slackSend }) };
});

import { notifyDecision } from "./dispatch";

const PHONE = "573001112233";

function decisionRow(kind: "escalada" | "blocked") {
  const payload =
    kind === "escalada"
      ? decide(makeInvoice(), makeFacts({ authorizations: [] }))
      : decide(makeInvoice(), makeFacts({ budgetUsedMinor: 1_000_000 }));
  return {
    id: payload.decisionId,
    organizationId: payload.organizationId,
    invoiceId: payload.invoiceId,
    invoiceNumber: "VER-2026-10",
    amountMinor: 1999,
    currency: "USD",
    decision: payload.decision,
    decisionSource: "automatic",
    approvalRequestId: null,
    payload,
    supplier: { name: "Vercel Inc" },
  };
}

function whatsappRecipient() {
  return { id: "rcp_wa", channel: "whatsapp", address: PHONE, status: "active", verifiedAt: new Date("2026-10-17T10:00:00Z"), createdAt: new Date() };
}

describe("notifyDecision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SLACK_DEFAULT_CHANNEL_ID", "");
    vi.stubEnv("WHATSAPP_ADMIN_PHONE", "");
    dbMock.approvalRequest.findUnique.mockResolvedValue({ id: "apr_1" });
    dbMock.auditEvent.findFirst.mockResolvedValue(null);
    dbMock.auditEvent.create.mockResolvedValue({});
    whatsappSend.mockResolvedValue({ status: "accepted", providerMessageId: "wamid.1" });
    slackSend.mockResolvedValue({ status: "accepted", providerMessageId: "C0123ABCD:1.1" });
  });

  it("una factura que requiere aprobación sale por WhatsApp con los tres botones", async () => {
    dbMock.paymentDecision.findUnique.mockResolvedValue(decisionRow("escalada"));
    dbMock.notificationRecipient.findMany.mockResolvedValue([whatsappRecipient()]);

    await notifyDecision("dec_1");

    expect(whatsappSend).toHaveBeenCalledTimes(1);
    expect(slackSend).not.toHaveBeenCalled();
    const message = whatsappSend.mock.calls[0]![0];
    expect(message.template.name).toBe("pacta_aprobacion_requerida");
    expect(message.template.components.filter((c: { type: string }) => c.type === "button")).toHaveLength(3);
    expect(dbMock.auditEvent.create.mock.calls[0]![0].data).toMatchObject({
      eventType: "notification.whatsapp.sent",
      payload: { eventType: "approval_requested", approvalRequestId: "apr_1", providerMessageId: "wamid.1" },
    });
  });

  it("sin destinatarios guardados usa el respaldo de entorno de cada canal", async () => {
    vi.stubEnv("SLACK_DEFAULT_CHANNEL_ID", "C0123ABCD");
    vi.stubEnv("WHATSAPP_ADMIN_PHONE", "+57 300 111 2233");
    dbMock.paymentDecision.findUnique.mockResolvedValue(decisionRow("blocked"));
    dbMock.notificationRecipient.findMany.mockResolvedValue([]);

    await notifyDecision("dec_2");

    expect(whatsappSend).toHaveBeenCalledTimes(1);
    expect(slackSend).toHaveBeenCalledTimes(1);
    expect(whatsappSend.mock.calls[0]![0].to).toBe(PHONE);
  });

  it("sin ningún canal configurado no envía nada ni falla", async () => {
    dbMock.paymentDecision.findUnique.mockResolvedValue(decisionRow("blocked"));
    dbMock.notificationRecipient.findMany.mockResolvedValue([]);

    await expect(notifyDecision("dec_3")).resolves.toBeUndefined();
    expect(whatsappSend).not.toHaveBeenCalled();
    expect(slackSend).not.toHaveBeenCalled();
  });

  it("no reenvía un aviso ya enviado (idempotencia)", async () => {
    dbMock.paymentDecision.findUnique.mockResolvedValue(decisionRow("escalada"));
    dbMock.notificationRecipient.findMany.mockResolvedValue([whatsappRecipient()]);
    dbMock.auditEvent.findFirst.mockResolvedValue({ id: "evt_1" });

    await notifyDecision("dec_1");
    expect(whatsappSend).not.toHaveBeenCalled();
  });

  it("registra el rechazo del proveedor y un canal caído no impide avisar por el otro", async () => {
    vi.stubEnv("SLACK_DEFAULT_CHANNEL_ID", "C0123ABCD");
    dbMock.paymentDecision.findUnique.mockResolvedValue(decisionRow("escalada"));
    dbMock.notificationRecipient.findMany.mockResolvedValue([whatsappRecipient()]);
    whatsappSend.mockRejectedValue(new Error("boom"));

    await expect(notifyDecision("dec_1")).resolves.toBeUndefined();
    expect(slackSend).toHaveBeenCalledTimes(1);

    whatsappSend.mockResolvedValue({ status: "rejected", errorCode: "graph_132001", retryable: false });
    await notifyDecision("dec_1");
    const failed = dbMock.auditEvent.create.mock.calls.map((call) => call[0].data).find((data) => data.eventType === "notification.whatsapp.failed");
    expect(failed).toMatchObject({
      payload: { errorCode: "graph_132001", retryable: false },
    });
  });

  it("no avisa a un destinatario que no está verificado (la consulta lo excluye)", async () => {
    dbMock.paymentDecision.findUnique.mockResolvedValue(decisionRow("escalada"));
    dbMock.notificationRecipient.findMany.mockResolvedValue([]);
    await notifyDecision("dec_1");
    expect(dbMock.notificationRecipient.findMany.mock.calls[0]![0].where).toMatchObject({ status: "active", verifiedAt: { not: null } });
  });
});
