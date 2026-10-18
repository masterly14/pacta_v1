import { describe, expect, it } from "vitest";
import type { InboundChannelEvent } from "@/shared/schemas/notification";
import { parseWhatsAppWebhook } from "@/shared/schemas/whatsapp-webhook";
import * as fx from "@/shared/schemas/__fixtures__/whatsapp/payloads";
import { normalizeAddress, processInboundEvents, resolveContext, type InboundRepo, type SaveInboundInput } from "./process-inbound";
import { parseReplyReference } from "./reply-reference";

type FakeState = {
  recipients: { channel: string; address: string; organizationId: string; recipientId: string; active: boolean }[];
  pending: Record<string, string[]>;
  saved: SaveInboundInput[];
};

function fakeRepo(state: FakeState): InboundRepo {
  return {
    async findActiveRecipient(channel, address) {
      const row = state.recipients.find((r) => r.channel === channel && r.address === address && r.active);
      return row ? { recipientId: row.recipientId, organizationId: row.organizationId } : null;
    },
    async listPendingApprovalIds(organizationId) {
      return state.pending[organizationId] ?? [];
    },
    async saveInbound(input) {
      if (state.saved.some((s) => s.eventKey === input.eventKey)) return { created: false };
      state.saved.push(input);
      return { created: true };
    },
  };
}

const admin = { channel: "whatsapp", address: "573001112233", organizationId: "org_a", recipientId: "rcp_a", active: true };
const events = (payload: unknown): InboundChannelEvent[] => {
  const result = parseWhatsAppWebhook(payload, fx.PHONE_NUMBER_ID);
  if (!result.ok) throw new Error("fixture inválido");
  return result.events;
};

describe("processInboundEvents", () => {
  it("omite remitentes que no son un destinatario guardado", async () => {
    const state: FakeState = { recipients: [], pending: { org_a: ["req_1"] }, saved: [] };
    const out = await processInboundEvents(events(fx.textReply), fakeRepo(state));
    expect(out).toEqual([{ kind: "skipped", reason: "unknown_recipient" }]);
    expect(state.saved).toHaveLength(0);
  });

  it("omite destinatarios deshabilitados", async () => {
    const state: FakeState = { recipients: [{ ...admin, active: false }], pending: { org_a: ["req_1"] }, saved: [] };
    const out = await processInboundEvents(events(fx.textReply), fakeRepo(state));
    expect(out[0]).toEqual({ kind: "skipped", reason: "unknown_recipient" });
  });

  it("registra la respuesta con la organización del número y una única solicitud pendiente", async () => {
    const state: FakeState = { recipients: [admin], pending: { org_a: ["req_1"], org_b: ["req_9"] }, saved: [] };
    const out = await processInboundEvents(events(fx.textReply), fakeRepo(state));
    expect(out[0]).toMatchObject({ kind: "recorded", organizationId: "org_a", context: "single_pending", approvalRequestId: "req_1" });
    expect(state.saved[0]?.pendingRequestIds).toEqual(["req_1"]); // nunca ve las de otra organización
  });

  it("un botón que cita una solicitud pendiente propia queda como quoted_request (solo pista)", async () => {
    const state: FakeState = { recipients: [admin], pending: { org_a: ["req_1", "req_2"] }, saved: [] };
    const out = await processInboundEvents(events(fx.quickReplyButton), fakeRepo(state));
    expect(out[0]).toMatchObject({ kind: "recorded", context: "quoted_request", approvalRequestId: "req_1" });
    expect(state.saved[0]?.claimedAction).toBe("pay");
  });

  it("citar una solicitud de otra organización o ya resuelta no la vincula", async () => {
    const state: FakeState = { recipients: [admin], pending: { org_a: ["req_2"], org_b: ["req_1"] }, saved: [] };
    const out = await processInboundEvents(events(fx.quickReplyButton), fakeRepo(state));
    expect(out[0]).toMatchObject({ context: "request_not_pending", approvalRequestId: null });
  });

  it("sin solicitudes abiertas lo registra como no_open_approvals", async () => {
    const state: FakeState = { recipients: [admin], pending: {}, saved: [] };
    const out = await processInboundEvents(events(fx.textReply), fakeRepo(state));
    expect(out[0]).toMatchObject({ kind: "recorded", context: "no_open_approvals", approvalRequestId: null });
  });

  it("es idempotente ante reintentos del proveedor", async () => {
    const state: FakeState = { recipients: [admin], pending: { org_a: ["req_1"] }, saved: [] };
    const repo = fakeRepo(state);
    await processInboundEvents(events(fx.textReply), repo);
    const again = await processInboundEvents(events(fx.textReply), repo);
    expect(again[0]?.kind).toBe("duplicate");
    expect(state.saved).toHaveLength(1);
  });

  it("no rastrea estados de entrega todavía", async () => {
    const state: FakeState = { recipients: [admin], pending: {}, saved: [] };
    const out = await processInboundEvents(events(fx.statusDelivered), fakeRepo(state));
    expect(out).toEqual([{ kind: "skipped", reason: "delivery_status_not_tracked" }]);
  });
});

describe("helpers", () => {
  it("resolveContext cubre ambigüedad", () => {
    expect(resolveContext(["a", "b"], null)).toEqual({ context: "ambiguous", approvalRequestId: null });
  });

  it("normalizeAddress deja solo dígitos en WhatsApp", () => {
    expect(normalizeAddress("whatsapp", "+57 300-111-2233")).toBe("573001112233");
  });

  it("parseReplyReference solo acepta pay|reject|details con id seguro", () => {
    expect(parseReplyReference("reject:req_1")).toEqual({ claimedAction: "reject", approvalRequestId: "req_1" });
    expect(parseReplyReference("approve:req_1")).toBeNull();
    expect(parseReplyReference("pay:req 1; DROP")).toBeNull();
    expect(parseReplyReference(null)).toBeNull();
  });
});
