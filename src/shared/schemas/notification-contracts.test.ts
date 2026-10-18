import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InboundChannelEventSchema, NotificationIntentSchema, NotificationRecipientSchema, OutboundNotificationResultSchema, inboundEventKey } from "./notification.ts";
import { WhatsAppVerificationQuerySchema, parseWhatsAppWebhook } from "./whatsapp-webhook.ts";
import * as fx from "./__fixtures__/whatsapp/payloads.ts";

function validIntent(overrides: Record<string, unknown> = {}) {
  return {
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
    reasonCodes: ["HUMAN_APPROVAL_REQUIRED"],
    policyVersion: 3,
    amountMinor: 123450,
    currency: "USD",
    supplierName: "Nube Hosting LLC",
    invoiceNumber: "F-001",
    deepLinkPath: "/platform/approvals?request=req_1",
    ...overrides,
  };
}

describe("NotificationIntentSchema", () => {
  it("acepta una intención válida", () => {
    assert.equal(NotificationIntentSchema.safeParse(validIntent()).success, true);
  });

  it("acepta desconocidos como null", () => {
    const result = NotificationIntentSchema.safeParse(validIntent({ amountMinor: null, currency: null, supplierName: null, invoiceNumber: null, policyVersion: null }));
    assert.equal(result.success, true);
  });

  it("rechaza importe sin moneda (y 0 no sustituye a null)", () => {
    assert.equal(NotificationIntentSchema.safeParse(validIntent({ currency: null })).success, false);
  });

  it("rechaza campos extra y URLs absolutas", () => {
    assert.equal(NotificationIntentSchema.safeParse(validIntent({ phone: "573001112233" })).success, false);
    assert.equal(NotificationIntentSchema.safeParse(validIntent({ deepLinkPath: "https://evil.example/x" })).success, false);
    assert.equal(NotificationIntentSchema.safeParse(validIntent({ deepLinkPath: "//evil.example" })).success, false);
  });

  it("exige coherencia evento/decisión", () => {
    assert.equal(NotificationIntentSchema.safeParse(validIntent({ decision: "approved" })).success, false);
    assert.equal(NotificationIntentSchema.safeParse(validIntent({ approvalRequestId: null })).success, false);
    assert.equal(NotificationIntentSchema.safeParse(validIntent({ eventType: "decision_blocked", decision: "approved" })).success, false);
    assert.equal(NotificationIntentSchema.safeParse(validIntent({ eventType: "approval_resolved", decision: "requires_approval" })).success, false);
  });

  it("rechaza reasonCodes vacíos o duplicados", () => {
    assert.equal(NotificationIntentSchema.safeParse(validIntent({ reasonCodes: [] })).success, false);
    assert.equal(NotificationIntentSchema.safeParse(validIntent({ reasonCodes: ["DUPLICATE_INVOICE", "DUPLICATE_INVOICE"] })).success, false);
  });
});

describe("NotificationRecipient / resultado de envío", () => {
  it("valida destinatario y resultados discriminados", () => {
    const recipient = { recipientId: "rcp_1", organizationId: "org_demo", channel: "whatsapp", address: "573001112233", locale: "es_MX", verifiedAt: null, status: "active" };
    assert.equal(NotificationRecipientSchema.safeParse(recipient).success, true);
    assert.equal(NotificationRecipientSchema.safeParse({ ...recipient, locale: "español" }).success, false);
    assert.equal(OutboundNotificationResultSchema.safeParse({ status: "accepted", providerMessageId: "wamid.X" }).success, true);
    assert.equal(OutboundNotificationResultSchema.safeParse({ status: "rejected", errorCode: "131026", retryable: false }).success, true);
    assert.equal(OutboundNotificationResultSchema.safeParse({ status: "accepted" }).success, false);
  });
});

describe("parseWhatsAppWebhook", () => {
  it("normaliza estados de entrega", () => {
    const result = parseWhatsAppWebhook(fx.statusDelivered, fx.PHONE_NUMBER_ID);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.events.length, 1);
    assert.deepEqual(result.events[0], {
      kind: "delivery_status",
      channel: "whatsapp",
      providerMessageId: "wamid.STATUS1",
      status: "delivered",
      occurredAt: "2025-10-09T08:53:20.000Z",
      error: null,
    });
  });

  it("conserva el error de un envío fallido", () => {
    const result = parseWhatsAppWebhook(fx.statusFailed, fx.PHONE_NUMBER_ID);
    assert.equal(result.ok && result.events[0]?.kind === "delivery_status" && result.events[0].error?.code, "131026");
  });

  it("normaliza respuestas de texto y botones como evidencia, con contexto", () => {
    for (const [payload, expectedPayload] of [[fx.textReply, null], [fx.quickReplyButton, "pay:req_1"], [fx.interactiveButtonReply, "reject:req_1"]] as const) {
      const result = parseWhatsAppWebhook(payload, fx.PHONE_NUMBER_ID);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const event = result.events[0];
      assert.equal(event?.kind, "user_reply");
      if (event?.kind === "user_reply") {
        assert.equal(event.buttonPayload, expectedPayload);
        assert.equal(event.senderAddress, "573001112233");
      }
    }
  });

  it("el texto con instrucciones incrustadas es solo texto", () => {
    const result = parseWhatsAppWebhook(fx.textReply, fx.PHONE_NUMBER_ID);
    assert.equal(result.ok && result.events.length, 1);
    assert.equal(result.ok && result.events[0]?.kind, "user_reply");
  });

  it("ignora tipos no soportados, otros números y otros campos", () => {
    const image = parseWhatsAppWebhook(fx.unsupportedImage, fx.PHONE_NUMBER_ID);
    assert.deepEqual(image.ok && [image.events.length, image.ignored[0]?.reason], [0, "unsupported_message_type"]);
    const foreign = parseWhatsAppWebhook(fx.foreignPhoneNumber, fx.PHONE_NUMBER_ID);
    assert.deepEqual(foreign.ok && [foreign.events.length, foreign.ignored[0]?.reason], [0, "foreign_phone_number_id"]);
    const field = parseWhatsAppWebhook(fx.nonMessagesField, fx.PHONE_NUMBER_ID);
    assert.deepEqual(field.ok && [field.events.length, field.ignored[0]?.reason], [0, "unsupported_field"]);
  });

  it("un sobre inválido no lanza y no produce eventos", () => {
    for (const bad of [null, "texto", {}, { object: "page", entry: [] }, { object: "whatsapp_business_account" }]) {
      assert.deepEqual(parseWhatsAppWebhook(bad, fx.PHONE_NUMBER_ID), { ok: false, reason: "invalid_envelope" });
    }
  });

  it("un elemento corrupto se omite sin afectar a los demás", () => {
    const payload = structuredClone(fx.statusDelivered) as { entry: { changes: { value: { statuses: unknown[] } }[] }[] };
    payload.entry[0]!.changes[0]!.value.statuses.push({ id: "", status: 5 });
    const result = parseWhatsAppWebhook(payload, fx.PHONE_NUMBER_ID);
    assert.deepEqual(result.ok && [result.events.length, result.ignored.length], [1, 1]);
  });
});

describe("eventos canónicos", () => {
  it("genera claves de idempotencia estables y distintas por estado", () => {
    const result = parseWhatsAppWebhook(fx.statusDelivered, fx.PHONE_NUMBER_ID);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const event = result.events[0]!;
    assert.equal(inboundEventKey(event), "whatsapp:status:wamid.STATUS1:delivered");
    assert.notEqual(inboundEventKey(event), inboundEventKey({ ...event, status: "read" } as typeof event));
    assert.equal(InboundChannelEventSchema.safeParse(event).success, true);
  });
});

describe("WhatsAppVerificationQuerySchema", () => {
  it("valida el handshake GET", () => {
    assert.equal(WhatsAppVerificationQuerySchema.safeParse({ "hub.mode": "subscribe", "hub.verify_token": "t", "hub.challenge": "123" }).success, true);
    assert.equal(WhatsAppVerificationQuerySchema.safeParse({ "hub.mode": "unsubscribe", "hub.verify_token": "t", "hub.challenge": "123" }).success, false);
  });
});
