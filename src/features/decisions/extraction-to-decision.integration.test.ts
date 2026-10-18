/**
 * Purpose: contract test between the two verticals: A's AI extraction (with a fake model) feeds
 *   B's evaluateInvoice() and the decision is persisted, so a change on either side that breaks
 *   the InvoiceContext handoff fails here.
 * Runs in: Vitest, only when TEST_DATABASE_URL points at a disposable database with all
 *   migrations applied (skipped otherwise, so `npm test` needs no database).
 * Triggered by: `TEST_DATABASE_URL=… npx vitest run src/features/decisions/extraction-to-decision.integration.test.ts`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: invoices/extraction/extract-invoice.ts (fake LLM and readers), ./server.ts#evaluateInvoice
 *   with `@/lib/db` on TEST_DATABASE_URL.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractDeps } from "@/features/invoices/extraction/extract-invoice";
import type { RawExtraction } from "@/features/invoices/extraction/raw-extraction.schema";
import type { SourceDocument } from "@/features/invoices/extraction/read-document";
import type { IdentityResolution } from "@/features/invoices/extraction/to-invoice-context";

const url = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return { db: new Client({ datasourceUrl: process.env.TEST_DATABASE_URL }) };
});

describe.skipIf(!url)("A extraction → B evaluateInvoice (integration)", async () => {
  const { extractInvoice } = await import("@/features/invoices/extraction/extract-invoice");
  const { evaluateInvoice } = await import("./server");
  const prisma = new PrismaClient({ datasourceUrl: url });

  const ORG = "org_e2e";
  const SUPPLIER = "sup_delta";
  let seq = 0;

  // Factura ficticia en texto, como la leería unpdf.
  const PDF_TEXT = "Factura F-2041\nProveedor: Hosting Delta SAS\nCuenta: 1234567890\nTotal: 1500.50 USD\nFecha: 2026-10-01";
  const claim = (value: string, excerpt: string = value) => ({ value, excerpt });
  const none = { value: null, excerpt: null };
  const raw = (overrides: Partial<RawExtraction> = {}): RawExtraction => ({
    isInvoice: true,
    documentKind: "invoice",
    paymentConfirmation: none,
    paidDate: none,
    paymentMethod: none,
    invoiceNumber: claim("F-2041", "Factura F-2041"),
    supplierName: claim("Hosting Delta SAS", "Proveedor: Hosting Delta SAS"),
    beneficiaryAccount: claim("1234567890", "Cuenta: 1234567890"),
    amount: claim("1500.50", "Total: 1500.50 USD"),
    currency: claim("USD", "Total: 1500.50 USD"),
    description: none,
    invoiceDate: claim("2026-10-01", "Fecha: 2026-10-01"),
    dueDate: none,
    injectionSuspected: false,
    ...overrides,
  });
  const fakeModel = (output: RawExtraction): ExtractDeps => ({
    extractPdfPages: async () => [PDF_TEXT],
    transcribeWithVision: async () => PDF_TEXT,
    runExtraction: async () => output,
  });
  const pdf: SourceDocument = { documentId: "doc_1", kind: "pdf", mediaType: "application/pdf", bytes: new Uint8Array([1]), text: null };

  async function extractAndEvaluate(output: RawExtraction, identity?: IdentityResolution) {
    seq += 1;
    const extracted = await extractInvoice(
      {
        documents: [pdf],
        metadata: { senderName: "Delta", senderEmail: "billing@delta.test", subject: "Factura F-2041", attachmentFilenames: ["f.pdf"] },
        meta: {
          invoiceId: `inv_e2e_${seq}`,
          organizationId: ORG,
          source: "email",
          sourceAccountId: "gc_1",
          sourceMessageId: `msg_${seq}`,
          documentId: null,
          documentType: "pdf",
          receivedAt: "2026-10-17T12:00:00Z",
        },
        identity,
      },
      fakeModel(output),
    );
    if (!extracted.ok) throw new Error(`${extracted.stage}: ${extracted.error}`);
    return { context: extracted.context, decision: await evaluateInvoice(extracted.context) };
  }

  const confirmed: IdentityResolution = { supplierId: SUPPLIER, supplierMatchStatus: "matched", contractMatch: null };

  beforeEach(async () => {
    seq = 0;
    await prisma.$executeRawUnsafe(
      `TRUNCATE audit_events, payment_decisions, approval_requests, payment_authorizations, payment_policies,
       bank_transactions, bank_import_batches, contracts, suppliers, approval_permissions, organization_memberships,
       users, organizations CASCADE`,
    );
    await prisma.organization.create({ data: { id: ORG, name: "E2E" } });
    await prisma.supplier.create({ data: { id: SUPPLIER, organizationId: ORG, name: "Hosting Delta SAS", normalizedName: "hosting delta sas" } });
    await prisma.paymentPolicy.create({
      data: { organizationId: ORG, version: 1, autoApprovalLimitMinor: 200_000, monthlyBudgetMinor: 2_000_000, currency: "USD", effectiveFrom: new Date("2026-01-01T00:00:00Z"), createdBy: "user_admin" },
    });
    await prisma.paymentAuthorization.create({
      data: {
        organizationId: ORG,
        supplierId: SUPPLIER,
        beneficiaryAccountRef: "****7890", // la extracción enmascara "1234567890" así
        currency: "USD",
        maxAmountMinor: 200_000,
        scope: "recurring",
        frequency: "monthly",
        validFrom: new Date("2026-01-01T00:00:00Z"),
        validUntil: new Date("2027-12-31T00:00:00Z"),
        authorizedBy: "user_admin",
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("escalates while the supplier is not resolved yet (A-04 pending): never approves", async () => {
    const { context, decision } = await extractAndEvaluate(raw());
    expect(context.supplierMatchStatus).toBe("not_found");
    expect(decision.decision).toBe("requires_approval");
    expect(decision.reasonCodes).toContain("INSUFFICIENT_DATA");
  });

  it("auto-approves an extracted invoice once the supplier is confirmed and authorized", async () => {
    const { context, decision } = await extractAndEvaluate(raw(), confirmed);
    expect(context).toMatchObject({ amountMinor: 150_050, currency: "USD", beneficiaryAccountReference: "****7890", name: "Hosting Delta SAS" });
    expect(decision.decision).toBe("approved");
    const row = await prisma.paymentDecision.findUniqueOrThrow({ where: { id: decision.decisionId } });
    expect(JSON.stringify(row.invoiceContext)).not.toContain("1234567890"); // la cuenta completa nunca se guarda
  });

  it("escalates when the model flags embedded instructions, even with everything else valid", async () => {
    const { decision } = await extractAndEvaluate(raw({ injectionSuspected: true }), confirmed);
    expect(decision.decision).toBe("requires_approval");
    expect(decision.rulesEvaluated.find((r) => r.ruleId === "no_extraction_warnings")?.result).toBe("fail");
  });
});
