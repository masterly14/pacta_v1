import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPOSIO_CONNECTED_ACCOUNT_EXPIRED_TYPE,
  COMPOSIO_GMAIL_NEW_MESSAGE_SLUG,
  COMPOSIO_TRIGGER_MESSAGE_TYPE,
  ComposioConnectedAccountExpiredSchema,
  ComposioTriggerEnvelopeSchema,
  parseGmailNewMessageEvent,
} from "./composio-webhook.ts";
import {
  GmailConnectCommandSchema,
  GmailConnectLinkSchema,
  GmailConnectRequestBodySchema,
  GmailConnectionPublicSchema,
  GmailConnectionSchema,
  gmailConnectionStatusFromComposio,
  toGmailConnectionPublic,
} from "./gmail-connection.ts";
import { GmailInboundMessageSchema, gmailInboundFromTrigger } from "./gmail-inbound-message.ts";
import { InvoiceContextSchema } from "./invoice-context.ts";

const orgId = "org_demo";
const userId = "user_demo";

function validConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: "gc_1",
    organizationId: orgId,
    connectedByUserId: userId,
    composioUserId: orgId,
    composioConnectedAccountId: "ca_work",
    composioAuthConfigId: "ac_gmail",
    composioTriggerId: "ti_inbox",
    emailAddress: "facturas@demo.com",
    alias: "facturas",
    status: "active",
    connectedAt: "2026-10-17T16:00:00Z",
    revokedAt: null,
    ...overrides,
  };
}

function triggerEnvelope(overrides: { metadata?: Record<string, unknown>; data?: Record<string, unknown>; type?: string } = {}) {
  return {
    id: "msg_2f1c9e4a-3b6d-4a1e-9c2f-7d8e5a6b4c31",
    timestamp: "2026-10-17T16:05:00Z",
    type: overrides.type ?? COMPOSIO_TRIGGER_MESSAGE_TYPE,
    metadata: {
      log_id: "log_abc",
      trigger_slug: COMPOSIO_GMAIL_NEW_MESSAGE_SLUG,
      trigger_id: "ti_inbox",
      connected_account_id: "ca_work",
      auth_config_id: "ac_gmail",
      user_id: orgId,
      ...overrides.metadata,
    },
    data: {
      message_id: "18f1gmail",
      thread_id: "18f1thread",
      sender: "proveedor@example.com",
      subject: "Factura 42",
      message_text: "Adjunto factura",
      ...overrides.data,
    },
  };
}

function invoiceContext(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    invoiceId: "inv_1",
    organizationId: orgId,
    invoiceNumber: "F-42",
    source: "email",
    sourceAccountId: "gc_1",
    sourceMessageId: "18f1gmail",
    documentId: "doc_1",
    documentType: "pdf",
    receivedAt: "2026-10-17T16:05:00Z",
    name: "Acme",
    email: "proveedor@example.com",
    subject: "Factura 42",
    body: "Adjunto factura",
    supplierId: "sup_1",
    supplierMatchStatus: "matched",
    beneficiaryAccountReference: "****1234",
    amountMinor: 1000,
    currency: "USD",
    description: "SaaS",
    invoiceDate: "2026-10-01",
    dueDate: "2026-10-31",
    contractMatch: null,
    missingFields: [],
    extractionWarnings: [],
    evidence: [],
    ...overrides,
  };
}

describe("GmailConnectionSchema", () => {
  it("acepta un buzón active de la organización", () => {
    const parsed = GmailConnectionSchema.parse(validConnection());
    assert.equal(parsed.status, "active");
    assert.equal(parsed.composioUserId, parsed.organizationId);
  });

  it("rechaza si composioUserId no es organizationId", () => {
    const result = GmailConnectionSchema.safeParse(validConnection({ composioUserId: "org_otra" }));
    assert.equal(result.success, false);
  });

  it("rechaza un correo sin normalizar", () => {
    assert.equal(GmailConnectionSchema.safeParse(validConnection({ emailAddress: "Facturas@Demo.com" })).success, false);
    assert.equal(GmailConnectionSchema.safeParse(validConnection({ emailAddress: "facturas@demo.com " })).success, false);
  });

  it("rechaza un estado desconocido", () => {
    assert.equal(GmailConnectionSchema.safeParse(validConnection({ status: "INITIALIZING" })).success, false);
  });

  it("el schema público omite ids de auth config y trigger", () => {
    const publicConnection = toGmailConnectionPublic(GmailConnectionSchema.parse(validConnection()));
    const keys = Object.keys(publicConnection);
    assert.equal(keys.includes("composioAuthConfigId"), false);
    assert.equal(keys.includes("composioTriggerId"), false);
    assert.equal(keys.includes("composioConnectedAccountId"), false);
    assert.equal(GmailConnectionPublicSchema.parse(publicConnection).id, "gc_1");
  });

  it("el comando de conexión lo arma el servidor con org y usuario", () => {
    const command = GmailConnectCommandSchema.parse({ organizationId: orgId, userId, alias: "finanzas" });
    assert.equal(command.organizationId, orgId);
    assert.equal(GmailConnectRequestBodySchema.parse({ alias: null }).alias, null);
  });

  it("el link de OAuth exige https y status pending", () => {
    const link = GmailConnectLinkSchema.parse({
      connectionId: "gc_pending",
      redirectUrl: "https://connect.composio.dev/link/abc",
      status: "pending",
    });
    assert.equal(link.status, "pending");
    assert.equal(GmailConnectLinkSchema.safeParse({ ...link, redirectUrl: "http://insecure.example" }).success, false);
  });

  it("mapea estados de Composio al contrato local", () => {
    assert.equal(gmailConnectionStatusFromComposio("INITIATED"), "pending");
    assert.equal(gmailConnectionStatusFromComposio("ACTIVE"), "active");
    assert.equal(gmailConnectionStatusFromComposio("UNKNOWN"), null);
  });
});

describe("Composio webhook", () => {
  it("parsea GMAIL_NEW_GMAIL_MESSAGE con campos sender/message_id", () => {
    const result = parseGmailNewMessageEvent(triggerEnvelope());
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.event.data.messageId, "18f1gmail");
      assert.equal(result.event.connectedAccountId, "ca_work");
    }
  });

  it("tolera from/id en el payload de Gmail", () => {
    const result = parseGmailNewMessageEvent(
      triggerEnvelope({
        data: { message_id: undefined, id: "alt-id", sender: undefined, from: "otro@example.com" },
      }),
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.event.data.messageId, "alt-id");
      assert.equal(result.event.data.sender, "otro@example.com");
    }
  });

  it("no produce evento si falta connected_account_id", () => {
    const envelope = triggerEnvelope();
    const { connected_account_id: _removed, ...metadata } = envelope.metadata;
    void _removed;
    const result = parseGmailNewMessageEvent({ ...envelope, metadata });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "invalid_envelope");
    }
    assert.equal(ComposioTriggerEnvelopeSchema.safeParse({ ...envelope, metadata }).success, false);
  });

  it("ignora un slug distinto de GMAIL_NEW_GMAIL_MESSAGE", () => {
    const result = parseGmailNewMessageEvent(triggerEnvelope({ metadata: { trigger_slug: "GITHUB_COMMIT_EVENT" } }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "wrong_slug");
    }
  });

  it("no produce evento si falta messageId", () => {
    const result = parseGmailNewMessageEvent(triggerEnvelope({ data: { message_id: undefined, id: undefined } }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "missing_message_id");
    }
  });

  it("acepta connected_account.expired para marcar el buzón", () => {
    const expired = ComposioConnectedAccountExpiredSchema.parse({
      id: "evt_expired",
      timestamp: "2026-10-17T17:00:00Z",
      type: COMPOSIO_CONNECTED_ACCOUNT_EXPIRED_TYPE,
      data: { connected_account_id: "ca_work", user_id: orgId },
    });
    assert.equal(expired.data.connected_account_id, "ca_work");
  });
});

describe("GmailInboundMessageSchema", () => {
  it("materializa un inbound received desde el trigger", () => {
    const parsed = parseGmailNewMessageEvent(triggerEnvelope());
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    const inbound = gmailInboundFromTrigger({
      id: "inb_1",
      organizationId: orgId,
      gmailConnectionId: "gc_1",
      event: parsed.event,
    });
    assert.equal(inbound.processingStatus, "received");
    assert.equal(inbound.gmailMessageId, "18f1gmail");
    assert.equal(inbound.invoiceId, null);
  });

  it("acepta el mismo gmailMessageId en buzones distintos", () => {
    const base = {
      composioEventId: "msg_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1",
      gmailMessageId: "same-gmail-id",
      gmailThreadId: null,
      sender: "a@example.com",
      subject: "x",
      receivedAt: "2026-10-17T16:05:00Z",
      processingStatus: "received",
      invoiceId: null,
      organizationId: orgId,
    };
    const a = GmailInboundMessageSchema.parse({
      ...base,
      id: "inb_a",
      gmailConnectionId: "gc_1",
    });
    const b = GmailInboundMessageSchema.parse({
      ...base,
      id: "inb_b",
      gmailConnectionId: "gc_2",
      composioEventId: "msg_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee2",
    });
    assert.equal(a.gmailMessageId, b.gmailMessageId);
    assert.notEqual(a.gmailConnectionId, b.gmailConnectionId);
  });
});

describe("InvoiceContext sourceAccountId", () => {
  it("exige buzón y message id cuando source es email", () => {
    assert.equal(InvoiceContextSchema.safeParse(invoiceContext()).success, true);
    assert.equal(InvoiceContextSchema.safeParse(invoiceContext({ sourceAccountId: null })).success, false);
    assert.equal(InvoiceContextSchema.safeParse(invoiceContext({ sourceMessageId: null })).success, false);
  });

  it("la carga manual no exige buzón", () => {
    const result = InvoiceContextSchema.safeParse(
      invoiceContext({
        source: "dashboard",
        sourceAccountId: null,
        sourceMessageId: null,
        documentType: "manual_entry",
      }),
    );
    assert.equal(result.success, true);
  });
});
