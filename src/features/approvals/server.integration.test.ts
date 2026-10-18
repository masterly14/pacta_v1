/**
 * Purpose: integration tests for resolving approval requests against a real PostgreSQL:
 *   approve/reject, re-evaluation (hard blocks win), approver limits, recurring authorization
 *   creation (the demo story) and scoping.
 * Runs in: Vitest, only when TEST_DATABASE_URL points at a disposable database with all
 *   migrations applied (skipped otherwise, so `npm test` needs no database).
 * Triggered by: `TEST_DATABASE_URL=… npx vitest run src/features/approvals/server.integration.test.ts`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: ./server.ts and decisions/server.ts with `@/lib/db` on TEST_DATABASE_URL.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PolicyActor } from "@/features/policies/permissions";
import type { InvoiceContext } from "@/shared/schemas/invoice-context";
import type { ResolveApprovalInput } from "./schemas";

const url = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return { db: new Client({ datasourceUrl: process.env.TEST_DATABASE_URL }) };
});

describe.skipIf(!url)("resolveApprovalRequest (integration)", async () => {
  const { resolveApprovalRequest } = await import("./server");
  const { evaluateInvoice } = await import("@/features/decisions/server");
  const prisma = new PrismaClient({ datasourceUrl: url });

  const ORG = "org_apr_a";
  const NUBE = "sup_nube";
  let seq = 0;

  const ana: PolicyActor = {
    userId: "user_ana",
    organizationId: ORG,
    role: "admin",
    permission: { canApprove: true, approvalLimitMinor: 1_000_000, canManagePolicies: true },
  };

  function invoice(overrides: Partial<InvoiceContext> = {}): InvoiceContext {
    seq += 1;
    return {
      schemaVersion: 1,
      invoiceId: `inv_${seq}`,
      organizationId: ORG,
      invoiceNumber: `NH-${seq}`,
      source: "dashboard",
      sourceAccountId: null,
      sourceMessageId: null,
      documentId: null,
      documentType: "manual_entry",
      receivedAt: "2026-10-17T12:00:00Z",
      supplierId: NUBE,
      name: "Nube Hosting LLC",
      email: "billing@nube.test",
      subject: "Factura de hosting",
      body: "Adjuntamos la factura del mes.",
      supplierMatchStatus: "matched",
      beneficiaryAccountReference: "****1234",
      amountMinor: 150_000,
      currency: "USD",
      description: "Hosting mensual",
      invoiceDate: "2026-10-05",
      dueDate: "2026-10-20",
      contractMatch: null,
      missingFields: [],
      extractionWarnings: [],
      evidence: [],
      ...overrides,
    };
  }

  async function escalate(overrides: Partial<InvoiceContext> = {}) {
    const inv = invoice(overrides);
    const decision = await evaluateInvoice(inv);
    expect(decision.decision).toBe("requiere_aprobacion");
    const request = await prisma.approvalRequest.findFirstOrThrow({ where: { invoiceId: inv.invoiceId, status: "pendiente" } });
    return { inv, requestId: request.id };
  }

  const approve = (approvalRequestId: string, extra: Partial<ResolveApprovalInput> = {}): ResolveApprovalInput => ({
    approvalRequestId,
    action: "approve",
    comment: null,
    authorization: null,
    ...extra,
  });

  beforeEach(async () => {
    seq = 0;
    await prisma.$executeRawUnsafe(
      `TRUNCATE audit_events, payment_decisions, approval_requests, payment_authorizations, payment_policies,
       bank_transactions, bank_import_batches, contracts, suppliers, approval_permissions, organization_memberships,
       users, organizations CASCADE`,
    );
    await prisma.organization.createMany({ data: [{ id: ORG, name: "A" }, { id: "org_apr_b", name: "B" }] });
    await prisma.supplier.create({ data: { id: NUBE, organizationId: ORG, name: "Nube Hosting LLC", normalizedName: "nube hosting llc" } });
    await prisma.paymentPolicy.create({
      data: { organizationId: ORG, version: 1, autoApprovalLimitMinor: 200_000, monthlyBudgetMinor: 2_000_000, currency: "USD", effectiveFrom: new Date("2026-01-01T00:00:00Z"), createdBy: "user_ana" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("approves an escalated invoice as a new human decision and closes the request", async () => {
    const { inv, requestId } = await escalate();
    expect(await resolveApprovalRequest(ana, approve(requestId, { comment: "Confirmado por teléfono" }))).toMatchObject({ ok: true });

    const human = await prisma.paymentDecision.findFirstOrThrow({ where: { invoiceId: inv.invoiceId, decisionSource: "humana" } });
    expect(human).toMatchObject({ decision: "aprobada", actorId: "user_ana", approvalRequestId: requestId, amountMinor: 150_000 });
    expect(await prisma.paymentDecision.count({ where: { invoiceId: inv.invoiceId } })).toBe(2); // la automática no se edita
    expect(await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ status: "aprobada", resolvedBy: "user_ana", comment: "Confirmado por teléfono" });
    expect(await prisma.auditEvent.count({ where: { entityId: requestId, eventType: "solicitud_aprobacion.aprobada" } })).toBe(1);
  });

  it("rejects an escalated invoice as a blocked human decision", async () => {
    const { inv, requestId } = await escalate();
    expect(await resolveApprovalRequest(ana, { ...approve(requestId), action: "reject", comment: "No reconocemos el cargo" })).toMatchObject({ ok: true });
    const human = await prisma.paymentDecision.findFirstOrThrow({ where: { invoiceId: inv.invoiceId, decisionSource: "humana" } });
    expect(human.decision).toBe("bloqueada");
    expect(await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ status: "rechazada" });
  });

  it("demo story: approve + authorize monthly → same-month invoice escalates → next month auto-approves", async () => {
    const { requestId } = await escalate();
    const result = await resolveApprovalRequest(ana, approve(requestId, {
      authorization: { beneficiaryAccountRef: "****1234", maxAmountMinor: 150_000, frequency: "monthly", validFrom: "2026-10-01", validUntil: "2027-09-30" },
    }));
    expect(result).toMatchObject({ ok: true, message: "Factura aprobada y autorización recurrente creada." });

    const auth = await prisma.paymentAuthorization.findFirstOrThrow({ where: { supplierId: NUBE } });
    expect(auth).toMatchObject({ sourceApprovalRequestId: requestId, authorizedBy: "user_ana", status: "active" });
    const human = await prisma.paymentDecision.findFirstOrThrow({ where: { decisionSource: "humana" } });
    expect(human.authorizationId).toBe(auth.id); // consume el periodo de octubre

    expect((await evaluateInvoice(invoice({ invoiceDate: "2026-10-25" }))).decision).toBe("requiere_aprobacion");
    expect((await evaluateInvoice(invoice({ invoiceDate: "2026-11-05" }))).decision).toBe("aprobada");
  });

  it("re-evaluates against rules changed while waiting: a hard block wins over a human approval", async () => {
    const { requestId } = await escalate(); // escala con la política v1 (presupuesto 20,000)
    // Mientras espera, una nueva versión de la política reduce el presupuesto mensual a 1,000.
    await prisma.paymentPolicy.create({
      data: { organizationId: ORG, version: 2, autoApprovalLimitMinor: 200_000, monthlyBudgetMinor: 100_000, currency: "USD", effectiveFrom: new Date("2026-01-01T00:00:00Z"), createdBy: "user_ana" },
    });
    const result = await resolveApprovalRequest(ana, approve(requestId));
    expect(result).toMatchObject({ ok: true });
    expect((result as { message: string }).message).toContain("PRESUPUESTO_INSUFICIENTE");
    expect(await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ status: "rechazada" });
    expect(await prisma.paymentDecision.count({ where: { decision: "aprobada" } })).toBe(0);
  });

  it("refuses approvals above the approver's limit or without permission, writing nothing", async () => {
    const { requestId } = await escalate();
    const lowLimit: PolicyActor = { ...ana, permission: { canApprove: true, approvalLimitMinor: 50_000, canManagePolicies: false } };
    const noPermission: PolicyActor = { ...ana, permission: null };
    expect(await resolveApprovalRequest(lowLimit, approve(requestId))).toMatchObject({ ok: false, error: "El monto supera tu límite de aprobación." });
    expect(await resolveApprovalRequest(noPermission, approve(requestId))).toMatchObject({ ok: false });
    expect(await prisma.paymentDecision.count({ where: { decisionSource: "humana" } })).toBe(0);
    expect(await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ status: "pendiente" });
  });

  it("refuses an authorization that does not cover the invoice, creating nothing", async () => {
    const { requestId } = await escalate();
    const result = await resolveApprovalRequest(ana, approve(requestId, {
      authorization: { beneficiaryAccountRef: "****9999", maxAmountMinor: 150_000, frequency: "monthly", validFrom: "2026-10-01", validUntil: "2027-09-30" },
    }));
    expect(result).toMatchObject({ ok: false, error: "La cuenta de la autorización debe ser la de esta factura." });
    expect(await prisma.paymentAuthorization.count()).toBe(0);
    expect(await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ status: "pendiente" });
  });

  it("refuses to resolve twice, another organization's request, or a non-policy currency", async () => {
    const { requestId } = await escalate();
    expect(await resolveApprovalRequest({ ...ana, organizationId: "org_apr_b" }, approve(requestId))).toMatchObject({ ok: false, error: "Solicitud no encontrada." });
    expect(await resolveApprovalRequest(ana, approve(requestId))).toMatchObject({ ok: true });
    expect(await resolveApprovalRequest(ana, approve(requestId))).toMatchObject({ ok: false, error: "Esta solicitud ya fue resuelta." });

    const eur = await escalate({ currency: "EUR", amountMinor: 50_000 });
    expect(await resolveApprovalRequest(ana, approve(eur.requestId))).toMatchObject({ ok: false });
    expect(await prisma.paymentDecision.count({ where: { invoiceId: eur.inv.invoiceId, decision: "aprobada" } })).toBe(0);
  });
});
