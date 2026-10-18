/**
 * Purpose: integration tests for getDashboard() and listOutsidePayments() against a real
 *   PostgreSQL: latest decision per invoice, budget use, pending approvals, receipt classification
 *   (unapproved, covered by a recurring authorization, bank confirmation), this month's receipt
 *   totals, the status filter of the detail and organization scoping.
 * Runs in: Vitest, only when TEST_DATABASE_URL points at a disposable database with all
 *   migrations applied (skipped otherwise, so `npm test` needs no database).
 * Triggered by: `TEST_DATABASE_URL=… npx vitest run src/features/dashboard/server.integration.test.ts`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: ./server.ts with `@/lib/db` on TEST_DATABASE_URL.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return { db: new Client({ datasourceUrl: process.env.TEST_DATABASE_URL }) };
});

describe.skipIf(!url)("getDashboard (integration)", async () => {
  const { getDashboard, listOutsidePayments } = await import("./server");
  const { archiveInvoices } = await import("@/features/decisions/archive");
  const prisma = new PrismaClient({ datasourceUrl: url });

  const ORG = "org_dash";
  const OTHER = "org_other";
  const NOW = new Date("2027-01-20T12:00:00Z");
  const day = (date: string) => new Date(`${date}T00:00:00Z`);

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE archived_invoices, invoices, document_groups, ignored_inbound_items, documents, gmail_inbound_messages, gmail_connections,
       audit_events, payment_decisions, approval_requests, payment_authorizations, payment_policies, bank_transactions,
       bank_import_batches, contracts, suppliers, approval_permissions, organization_memberships, users, organizations CASCADE`,
    );
    for (const id of [ORG, OTHER]) await prisma.organization.create({ data: { id, name: id } });
    await prisma.user.create({ data: { id: "user_admin", email: "admin@demo.test" } });
    for (const [id, name] of [["sup_nube", "Nube Hosting"], ["sup_pap", "Papelería Central"], ["sup_soft", "Soft SaaS"]]) {
      await prisma.supplier.create({ data: { id, organizationId: ORG, name, normalizedName: name.toLowerCase() } });
    }
    await prisma.paymentPolicy.create({
      data: { organizationId: ORG, version: 2, autoApprovalLimitMinor: 200_000, monthlyBudgetMinor: 1_000_000, currency: "USD", effectiveFrom: day("2027-01-01"), createdBy: "user_admin" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const decision = (data: {
    id: string;
    invoiceId: string;
    decision: "approved" | "blocked" | "requires_approval";
    source?: "automatic" | "human";
    reasons: string[];
    amountMinor?: number;
    evaluatedAt: string;
    organizationId?: string;
    supplierId?: string;
    invoiceNumber?: string;
    approvalRequestId?: string;
  }) =>
    prisma.paymentDecision.create({
      data: {
        id: data.id,
        organizationId: data.organizationId ?? ORG,
        invoiceId: data.invoiceId,
        supplierId: data.supplierId ?? null,
        invoiceNumber: data.invoiceNumber ?? null,
        amountMinor: data.amountMinor ?? 10_000,
        currency: "USD",
        decision: data.decision,
        decisionSource: data.source ?? "automatic",
        // Una decisión humana exige actor y solicitud (CHECK payment_decisions_actor_check).
        actorId: data.source === "human" ? "user_admin" : null,
        approvalRequestId: data.approvalRequestId ?? null,
        reasonCodes: data.reasons,
        rulesEvaluated: [],
        payload: {},
        policyVersion: 2,
        evaluatedAt: new Date(data.evaluatedAt),
      },
    });

  const receipt = (id: string, data: { organizationId?: string; supplierId: string | null; amountMinor: number; paidOn: string; invoiceNumber?: string }) =>
    prisma.invoice.create({
      data: {
        id,
        organizationId: data.organizationId ?? ORG,
        source: "email",
        extractionStatus: "extracted",
        supplierId: data.supplierId,
        name: "Recibo",
        invoiceNumber: data.invoiceNumber ?? id,
        amountMinor: data.amountMinor,
        currency: "USD",
        documentKind: "receipt",
        paidOn: day(data.paidOn),
        paymentMethod: "Visa ****4242",
        receivedAt: new Date(`${data.paidOn}T15:00:00Z`),
      },
    });

  it("summarizes this month's latest decisions, budget and pending approvals", async () => {
    await decision({ id: "d1", invoiceId: "inv_a", decision: "approved", reasons: ["AUTO_APPROVAL_RULES_PASSED"], amountMinor: 45_000, evaluatedAt: "2027-01-05T10:00:00Z" });
    await decision({ id: "d2", invoiceId: "inv_b", decision: "requires_approval", reasons: ["SUPPLIER_NOT_AUTHORIZED", "HUMAN_APPROVAL_REQUIRED"], evaluatedAt: "2027-01-06T10:00:00Z" });
    await prisma.approvalRequest.create({ data: { id: "req_b", organizationId: ORG, invoiceId: "inv_b", decisionId: "d2", status: "approved", requestedAt: new Date("2027-01-06T10:00:00Z") } });
    await decision({ id: "d3", invoiceId: "inv_b", decision: "approved", source: "human", reasons: ["HUMAN_APPROVAL_REQUIRED"], amountMinor: 5_000, evaluatedAt: "2027-01-07T10:00:00Z", approvalRequestId: "req_b" });
    await decision({ id: "d4", invoiceId: "inv_c", decision: "blocked", reasons: ["DUPLICATE_INVOICE", "SUPPLIER_NOT_AUTHORIZED"], evaluatedAt: "2027-01-08T10:00:00Z" });
    await decision({ id: "d5", invoiceId: "inv_d", decision: "requires_approval", reasons: ["AMOUNT_LIMIT_EXCEEDED"], amountMinor: 300_000, evaluatedAt: "2027-01-09T10:00:00Z" });
    await prisma.approvalRequest.create({ data: { organizationId: ORG, invoiceId: "inv_d", decisionId: "d5", requestedAt: new Date("2027-01-09T10:00:00Z") } });
    // Mes anterior y otra organización: no cuentan.
    await decision({ id: "d6", invoiceId: "inv_old", decision: "approved", reasons: ["AUTO_APPROVAL_RULES_PASSED"], evaluatedAt: "2026-12-30T10:00:00Z" });
    await decision({ id: "d7", invoiceId: "inv_x", decision: "blocked", reasons: ["DUPLICATE_INVOICE"], evaluatedAt: "2027-01-10T10:00:00Z", organizationId: OTHER });

    const dashboard = await getDashboard(ORG, NOW);
    expect(dashboard.month).toBe("2027-01");
    expect(dashboard.decisions).toEqual({ total: 4, approved: 2, requiresApproval: 1, blocked: 1, autoApproved: 1, autonomyRate: 0.25 });
    expect(dashboard.safetyCatches).toEqual([
      { code: "AMOUNT_LIMIT_EXCEEDED", count: 1 },
      { code: "DUPLICATE_INVOICE", count: 1 },
      { code: "SUPPLIER_NOT_AUTHORIZED", count: 1 },
    ]);
    expect(dashboard.budget).toEqual({ currency: "USD", monthlyBudgetMinor: 1_000_000, usedMinor: 50_000, policyVersion: 2 });
    expect(dashboard.pending).toEqual({ count: 1, oldestRequestedAt: "2027-01-09T10:00:00.000Z", amountByCurrency: { USD: 300_000 } });
  });

  it("classifies receipts and totals the unapproved ones of this month, scoped to the organization", async () => {
    await prisma.bankImportBatch.create({ data: { id: "batch", organizationId: ORG, fileName: "banco.csv", rowCount: 3, importedBy: "user_admin" } });
    // Nube Hosting: cargo mensual en el banco, sin autorización → recurrente y sin aprobación.
    for (const [i, date] of ["2026-11-05", "2026-12-05", "2027-01-06"].entries()) {
      await prisma.bankTransaction.create({
        data: { organizationId: ORG, importBatchId: "batch", supplierId: "sup_nube", postedOn: day(date), amountMinor: -150_000, currency: "USD", description: "NUBE HOSTING", fingerprint: `fp_${i}` },
      });
    }
    await receipt("rec_nube", { supplierId: "sup_nube", amountMinor: 150_000, paidOn: "2027-01-05" });
    // Soft SaaS: autorización recurrente que cubre el monto.
    await prisma.paymentAuthorization.create({
      data: { organizationId: ORG, supplierId: "sup_soft", beneficiaryAccountRef: "****1111", currency: "USD", maxAmountMinor: 5_000, scope: "recurring", frequency: "monthly", validFrom: day("2027-01-01"), validUntil: day("2027-12-31"), authorizedBy: "user_admin" },
    });
    await receipt("rec_soft", { supplierId: "sup_soft", amountMinor: 2_000, paidOn: "2027-01-10" });
    // Papelería: pago aprobado en Pacta con el mismo número.
    await decision({ id: "d_pap", invoiceId: "inv_pap", decision: "approved", reasons: ["AUTO_APPROVAL_RULES_PASSED"], amountMinor: 4_590, evaluatedAt: "2027-01-02T10:00:00Z", supplierId: "sup_pap", invoiceNumber: "PC-9" });
    await receipt("rec_pap", { supplierId: "sup_pap", amountMinor: 4_590, paidOn: "2027-01-03", invoiceNumber: "PC-9" });
    // Sin proveedor y del mes pasado: sin aprobación, pero fuera del total del mes.
    await receipt("rec_unknown", { supplierId: null, amountMinor: 999, paidOn: "2026-12-15" });
    await receipt("rec_other_org", { organizationId: OTHER, supplierId: null, amountMinor: 1, paidOn: "2027-01-10" });

    // Detalle: todos los recibos de la organización, clasificados.
    const detail = await listOutsidePayments(ORG, { status: null }, NOW);
    const byId = Object.fromEntries(detail.receipts.map((r) => [r.invoiceId, r]));
    expect(Object.keys(byId).sort()).toEqual(["rec_nube", "rec_pap", "rec_soft", "rec_unknown"]);
    expect(byId.rec_nube).toMatchObject({ status: "unapproved", supplierName: "Nube Hosting", paymentMethod: "Visa ****4242" });
    expect(byId.rec_nube.signals.sort()).toEqual(["bank_confirmed", "likely_recurring"]);
    expect(byId.rec_soft.status).toBe("covered_by_authorization");
    expect(byId.rec_pap.status).toBe("approved_in_pacta");
    expect(byId.rec_unknown).toMatchObject({ status: "unapproved", signals: ["supplier_unknown"] });
    expect(detail.summary.byStatus.unapproved).toEqual({ count: 2, amountByCurrency: { USD: 150_999 } });
    expect(detail.truncated).toBe(false);

    const onlyUnapproved = await listOutsidePayments(ORG, { status: "unapproved" }, NOW);
    expect(onlyUnapproved.receipts.map((r) => r.invoiceId).sort()).toEqual(["rec_nube", "rec_unknown"]);
    expect(onlyUnapproved.matchingCount).toBe(2);

    // Resumen del mes: el recibo de diciembre queda fuera.
    const dashboard = await getDashboard(ORG, NOW);
    const month = dashboard.outsidePayments.month;
    expect(month.count).toBe(3);
    expect(month.byStatus).toEqual({
      unapproved: { count: 1, amountByCurrency: { USD: 150_000 } },
      covered_by_authorization: { count: 1, amountByCurrency: { USD: 2_000 } },
      approved_in_pacta: { count: 1, amountByCurrency: { USD: 4_590 } },
    });
    expect(month.likelyRecurring).toBe(1);
    expect(month.bankConfirmed).toBe(1);
    expect(month.topUnapprovedSuppliers).toEqual([{ supplierId: "sup_nube", name: "Nube Hosting", count: 1, amountByCurrency: { USD: 150_000 } }]);
    expect(dashboard.outsidePayments).toMatchObject({ truncated: false, allTimeCount: 4 });

    // Nube aparece como suscripción sin autorizar; Soft no tiene historial bancario.
    expect(dashboard.subscriptions.available).toBe(true);
    expect(dashboard.subscriptions.unauthorized).toEqual([
      expect.objectContaining({ supplierId: "sup_nube", name: "Nube Hosting", cadence: "monthly", typicalAmountMinor: 150_000, currency: "USD" }),
    ]);
  });

  it("hides a recurring charge once a recurring authorization covers it", async () => {
    await prisma.bankImportBatch.create({ data: { id: "batch", organizationId: ORG, fileName: "banco.csv", rowCount: 3, importedBy: "user_admin" } });
    for (const [i, date] of ["2026-11-05", "2026-12-05", "2027-01-05"].entries()) {
      await prisma.bankTransaction.create({
        data: { organizationId: ORG, importBatchId: "batch", supplierId: "sup_nube", postedOn: day(date), amountMinor: -150_000, currency: "USD", description: "NUBE HOSTING", fingerprint: `fp_${i}` },
      });
    }
    await prisma.paymentAuthorization.create({
      data: { organizationId: ORG, supplierId: "sup_nube", beneficiaryAccountRef: "****2222", currency: "USD", maxAmountMinor: 200_000, scope: "recurring", frequency: "monthly", validFrom: day("2027-01-01"), validUntil: day("2027-12-31"), authorizedBy: "user_admin" },
    });
    expect((await getDashboard(ORG, NOW)).subscriptions.unauthorized).toEqual([]);
  });

  it("has no budget and no autonomy rate for an organization without policy or decisions", async () => {
    const dashboard = await getDashboard(OTHER, NOW);
    expect(dashboard.budget).toBeNull();
    expect(dashboard.decisions.autonomyRate).toBeNull();
    expect(dashboard.outsidePayments).toMatchObject({ allTimeCount: 0, month: { count: 0 } });
  });
  it("leaves archived invoices out of every number without deleting them", async () => {
    await decision({ id: "d1", invoiceId: "inv_keep", decision: "approved", reasons: ["AUTO_APPROVAL_RULES_PASSED"], evaluatedAt: "2027-01-05T10:00:00Z" });
    await decision({ id: "d2", invoiceId: "test_old", decision: "requires_approval", reasons: ["INSUFFICIENT_DATA"], evaluatedAt: "2027-01-06T10:00:00Z" });
    await prisma.approvalRequest.create({ data: { organizationId: ORG, invoiceId: "test_old", decisionId: "d2" } });
    await receipt("rec_old", { supplierId: null, amountMinor: 999, paidOn: "2027-01-10" });

    expect(await archiveInvoices(ORG, ["test_old", "rec_old", "test_old"], "prueba antigua", null)).toBe(2);
    // Repetir no duplica ni falla.
    expect(await archiveInvoices(ORG, ["test_old"], "prueba antigua", null)).toBe(0);

    const dashboard = await getDashboard(ORG, NOW);
    expect(dashboard.decisions.total).toBe(1);
    expect(dashboard.safetyCatches).toEqual([]);
    expect(dashboard.pending.count).toBe(0);
    expect(dashboard.outsidePayments.allTimeCount).toBe(0);
    expect((await listOutsidePayments(ORG, { status: null }, NOW)).receipts).toEqual([]);
    // Nada se borró: las filas siguen y hay rastro en la auditoría.
    expect(await prisma.paymentDecision.count({ where: { invoiceId: "test_old" } })).toBe(1);
    expect(await prisma.invoice.count({ where: { id: "rec_old" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { eventType: "invoices.archived" } })).toBe(2);
  });
});
