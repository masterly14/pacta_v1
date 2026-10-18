/**
 * Purpose: integration tests for evaluateInvoice() against a real PostgreSQL: persistence,
 *   approval requests, idempotency, authorization periods, duplicates, budget races and scoping.
 * Runs in: Vitest, only when TEST_DATABASE_URL points at a disposable database with all
 *   migrations applied (skipped otherwise, so `npm test` needs no database).
 * Triggered by: `TEST_DATABASE_URL=… npx vitest run src/features/decisions/server.integration.test.ts`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: ./server.ts with `@/lib/db` replaced by a PrismaClient on TEST_DATABASE_URL.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceContext } from "@/shared/schemas/invoice-context";

const url = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return { db: new Client({ datasourceUrl: process.env.TEST_DATABASE_URL }) };
});

describe.skipIf(!url)("evaluateInvoice (integration)", async () => {
  const { evaluateInvoice } = await import("./server");
  const prisma = new PrismaClient({ datasourceUrl: url });

  const ORG = "org_dec_a";
  const OTHER_ORG = "org_dec_b";
  const PAPELERIA = "sup_papeleria";
  const NUBE = "sup_nube";
  const date = (d: string) => new Date(`${d}T00:00:00.000Z`);
  let invoiceSeq = 0;

  function invoice(overrides: Partial<InvoiceContext> = {}): InvoiceContext {
    invoiceSeq += 1;
    return {
      schemaVersion: 1,
      invoiceId: `inv_${invoiceSeq}`,
      organizationId: ORG,
      invoiceNumber: `PC-${invoiceSeq}`,
      source: "dashboard",
      sourceAccountId: null,
      sourceMessageId: null,
      documentId: null,
      documentType: "manual_entry",
      receivedAt: "2026-10-17T12:00:00Z",
      supplierId: PAPELERIA,
      name: "Papelería Central",
      email: "facturas@papeleria.test",
      subject: "Factura de papelería",
      body: "Adjuntamos la factura del mes.",
      supplierMatchStatus: "matched",
      beneficiaryAccountReference: "****4821",
      amountMinor: 4590,
      currency: "USD",
      description: "Papelería de oficina",
      invoiceDate: "2026-10-05",
      dueDate: "2026-10-20",
      contractMatch: null,
      missingFields: [],
      extractionWarnings: [],
      evidence: [],
      ...overrides,
    };
  }

  async function seedPolicy(monthlyBudgetMinor = 2_000_000) {
    await prisma.paymentPolicy.create({
      data: {
        organizationId: ORG,
        version: 1,
        autoApprovalLimitMinor: 200_000,
        monthlyBudgetMinor,
        currency: "USD",
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        createdBy: "user_admin",
      },
    });
  }

  async function seedAuthorization(supplierId: string, account: string, maxAmountMinor = 10_000) {
    return prisma.paymentAuthorization.create({
      data: {
        organizationId: ORG,
        supplierId,
        beneficiaryAccountRef: account,
        currency: "USD",
        maxAmountMinor,
        scope: "recurring",
        frequency: "monthly",
        validFrom: date("2026-01-01"),
        validUntil: date("2027-12-31"),
        authorizedBy: "user_admin",
      },
    });
  }

  beforeEach(async () => {
    invoiceSeq = 0;
    await prisma.$executeRawUnsafe(
      `TRUNCATE audit_events, payment_decisions, approval_requests, payment_authorizations, payment_policies,
       bank_transactions, bank_import_batches, contracts, suppliers, approval_permissions, organization_memberships,
       users, organizations CASCADE`,
    );
    await prisma.organization.createMany({ data: [{ id: ORG, name: "A" }, { id: OTHER_ORG, name: "B" }] });
    await prisma.supplier.createMany({
      data: [
        { id: PAPELERIA, organizationId: ORG, name: "Papelería Central", normalizedName: "papeleria central" },
        { id: NUBE, organizationId: ORG, name: "Nube Hosting LLC", normalizedName: "nube hosting llc" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("approves an authorized invoice and records the covering authorization and audit", async () => {
    await seedPolicy();
    const auth = await seedAuthorization(PAPELERIA, "****4821");
    const result = await evaluateInvoice(invoice());

    expect(result.decision).toBe("aprobada");
    const row = await prisma.paymentDecision.findUniqueOrThrow({ where: { id: result.decisionId } });
    expect(row).toMatchObject({ authorizationId: auth.id, invoiceDate: date("2026-10-05"), decisionSource: "automatica" });
    expect(await prisma.approvalRequest.count()).toBe(0);
    expect(await prisma.auditEvent.count({ where: { entityId: result.decisionId, eventType: "decision_pago.creada" } })).toBe(1);
  });

  it("is idempotent: re-evaluating an approved invoice returns the same decision", async () => {
    await seedPolicy();
    await seedAuthorization(PAPELERIA, "****4821");
    const inv = invoice();
    const first = await evaluateInvoice(inv);
    const second = await evaluateInvoice(inv);
    expect(second.decisionId).toBe(first.decisionId);
    expect(await prisma.paymentDecision.count({ where: { invoiceId: inv.invoiceId } })).toBe(1);
  });

  it("opens exactly one approval request for an escalated invoice, even when re-evaluated", async () => {
    await seedPolicy();
    await seedAuthorization(PAPELERIA, "****4821");
    const inv = invoice({ amountMinor: 15_000 }); // supera el máximo autorizado (100.00)
    expect((await evaluateInvoice(inv)).decision).toBe("requiere_aprobacion");
    expect((await evaluateInvoice(inv)).decision).toBe("requiere_aprobacion");
    expect(await prisma.paymentDecision.count({ where: { invoiceId: inv.invoiceId } })).toBe(2);
    expect(await prisma.approvalRequest.count({ where: { invoiceId: inv.invoiceId, status: "pendiente" } })).toBe(1);
  });

  it("cancels the pending request when a re-evaluation no longer needs a person", async () => {
    await seedPolicy();
    const inv = invoice();
    expect((await evaluateInvoice(inv)).decision).toBe("requiere_aprobacion"); // sin autorización
    await seedAuthorization(PAPELERIA, "****4821");
    expect((await evaluateInvoice(inv)).decision).toBe("aprobada");
    expect(await prisma.approvalRequest.findFirstOrThrow({ where: { invoiceId: inv.invoiceId } })).toMatchObject({ status: "cancelada" });
  });

  it("lets a monthly authorization cover one invoice per calendar month of the invoice date", async () => {
    await seedPolicy();
    await seedAuthorization(PAPELERIA, "****4821");
    expect((await evaluateInvoice(invoice({ invoiceDate: "2026-10-05" }))).decision).toBe("aprobada");
    const sameMonth = await evaluateInvoice(invoice({ invoiceDate: "2026-10-20" }));
    expect(sameMonth.decision).toBe("requiere_aprobacion");
    expect(sameMonth.rulesEvaluated.find((r) => r.ruleId === "proveedor_autorizado")?.explanation).toContain("already covered");
    expect((await evaluateInvoice(invoice({ invoiceDate: "2026-11-05" }))).decision).toBe("aprobada");
  });

  it("blocks a confirmed duplicate (same supplier and normalized number)", async () => {
    await seedPolicy();
    await seedAuthorization(PAPELERIA, "****4821");
    await evaluateInvoice(invoice({ invoiceNumber: "PC-1042" }));
    const copy = await evaluateInvoice(invoice({ invoiceNumber: "pc 1042", invoiceDate: "2026-11-05" }));
    expect(copy.decision).toBe("bloqueada");
    expect(copy.reasonCodes).toContain("FACTURA_DUPLICADA");
  });

  it("approves exactly one of many concurrent invoices competing for the last budget", async () => {
    await seedPolicy(6_000); // presupuesto mensual 60.00: alcanza para una sola factura de 50.00
    await seedAuthorization(PAPELERIA, "****4821");
    // Meses de factura distintos: el periodo de la autorización no interfiere; solo compiten por presupuesto.
    const months = ["01", "02", "03", "04", "05", "06", "07", "08"];
    const results = await Promise.all(
      months.map((m) => evaluateInvoice(invoice({ amountMinor: 5_000, invoiceDate: `2026-${m}-10` }))),
    );
    expect(results.filter((r) => r.decision === "aprobada")).toHaveLength(1);
    for (const r of results.filter((r) => r.decision !== "aprobada")) {
      expect(r.decision).toBe("bloqueada");
      expect(r.reasonCodes).toContain("PRESUPUESTO_INSUFICIENTE");
    }
  });

  it("escalates when the organization has no policy", async () => {
    await seedAuthorization(PAPELERIA, "****4821");
    const result = await evaluateInvoice(invoice());
    expect(result.decision).toBe("requiere_aprobacion");
    expect(result.policyVersion).toBeNull();
  });

  it("ignores another organization's policy, authorizations and decisions", async () => {
    await prisma.paymentPolicy.create({
      data: { organizationId: OTHER_ORG, version: 1, autoApprovalLimitMinor: 200_000, monthlyBudgetMinor: 2_000_000, currency: "USD", effectiveFrom: new Date("2026-01-01T00:00:00Z"), createdBy: "x" },
    });
    await seedAuthorization(PAPELERIA, "****4821");
    const result = await evaluateInvoice(invoice());
    expect(result.policyVersion).toBeNull();
    expect(result.decision).toBe("requiere_aprobacion");
  });

  it("runs every simulator scenario to its expected result against demo-like data", async () => {
    const { buildDemoInvoice } = await import("./fixtures/demo-invoices");
    const { DEMO_SCENARIOS } = await import("./fixtures/scenarios");
    await seedPolicy();
    await seedAuthorization(PAPELERIA, "****4821");
    await prisma.supplier.create({ data: { id: "sup_diseno", organizationId: ORG, name: "Diseño Studio", normalizedName: "diseno studio" } });
    await prisma.contract.create({
      data: { organizationId: ORG, supplierId: NUBE, agreedAmountMinor: 150_000, currency: "USD", frequency: "monthly", validFrom: date("2026-01-01"), beneficiaryAccountRef: "****1234", createdBy: "user_admin" },
    });

    // En el orden de la UI: la primera de Papelería se aprueba y las siguientes ya encuentran el periodo usado.
    for (const scenario of DEMO_SCENARIOS) {
      const built = await buildDemoInvoice(scenario.id, ORG, new Date());
      if (!built.ok) throw new Error(`${scenario.id}: ${built.error}`);
      const result = await evaluateInvoice(built.invoice);
      expect({ scenario: scenario.id, decision: result.decision }).toEqual({ scenario: scenario.id, decision: scenario.expected });
      // Cada escenario debe mostrar su propio motivo, no uno colateral de otro escenario.
      const shown = scenario.reasons.some((code) => (result.reasonCodes as string[]).includes(code));
      expect({ scenario: scenario.id, reasons: result.reasonCodes, shown }).toMatchObject({ scenario: scenario.id, shown: true });
      if (scenario.id !== "papeleria_duplicate") {
        expect({ scenario: scenario.id, reasons: result.reasonCodes }).not.toMatchObject({ reasons: expect.arrayContaining(["FACTURA_DUPLICADA"]) });
      }
    }
  });

  it("evaluates test invoices typed in the form, with empty fields treated as missing", async () => {
    const { buildCustomInvoice, CustomInvoiceInputSchema } = await import("./fixtures/custom-invoice");
    await seedPolicy();
    await seedAuthorization(PAPELERIA, "****4821");
    const form = (values: Record<string, string>) =>
      CustomInvoiceInputSchema.parse({ supplierId: PAPELERIA, invoiceNumber: "", amount: "", currency: "USD", beneficiaryAccountReference: "", invoiceDate: "2026-10-05", description: "", ...values });
    const run = async (values: Record<string, string>) => {
      const built = await buildCustomInvoice(form(values), ORG, new Date());
      if (!built.ok) throw new Error(built.error);
      return evaluateInvoice(built.invoice);
    };

    const ok = await run({ invoiceNumber: "PC-77", amount: "45.90", beneficiaryAccountReference: "****4821" });
    expect(ok.decision).toBe("aprobada");

    const unknownSupplier = await run({ supplierId: "", invoiceNumber: "X-1", amount: "10.00", beneficiaryAccountReference: "****1111" });
    expect(unknownSupplier.decision).toBe("requiere_aprobacion");
    expect(unknownSupplier.reasonCodes).toContain("DATOS_INSUFICIENTES");

    const noAmount = await run({ invoiceNumber: "PC-78", beneficiaryAccountReference: "****4821", invoiceDate: "2026-11-05" });
    expect(noAmount.decision).toBe("requiere_aprobacion");
    expect(noAmount.rulesEvaluated.find((r) => r.ruleId === "presupuesto_disponible")?.result).toBe("desconocido");

    await prisma.supplier.create({ data: { id: "sup_foreign", organizationId: OTHER_ORG, name: "Ajeno", normalizedName: "ajeno" } });
    expect(await buildCustomInvoice(form({ supplierId: "sup_foreign", amount: "1.00" }), ORG, new Date())).toEqual({ ok: false, error: "Proveedor no encontrado." });
    expect(await buildCustomInvoice(form({ amount: "1.234" }), ORG, new Date())).toMatchObject({ ok: false });
  });

  it("rejects an invalid invoice before touching the database", async () => {
    await expect(evaluateInvoice({ ...invoice(), amountMinor: 20.5 })).rejects.toThrow();
    expect(await prisma.paymentDecision.count()).toBe(0);
  });
});
