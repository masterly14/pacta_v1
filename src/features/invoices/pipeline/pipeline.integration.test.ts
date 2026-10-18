/**
 * Purpose: integration tests for the invoice pipeline against a real PostgreSQL: manual and
 *   email intake → extraction (fake model) → supplier resolution → invoices row → decision;
 *   idempotency, failures and retries.
 * Runs in: Vitest, only when TEST_DATABASE_URL points at a disposable database with all
 *   migrations applied (skipped otherwise, so `npm test` needs no database).
 * Triggered by: `TEST_DATABASE_URL=… npx vitest run src/features/invoices/pipeline/pipeline.integration.test.ts`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: ./process-invoice.ts, ./process-email.ts with `@/lib/db` on TEST_DATABASE_URL, a fake
 *   blob store and a fake extraction model.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractDeps } from "../extraction/extract-invoice";
import type { RawExtraction } from "../extraction/raw-extraction.schema";
import type { BlobStorePort } from "../gmail/ports";

const url = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return { db: new Client({ datasourceUrl: process.env.TEST_DATABASE_URL }) };
});

describe.skipIf(!url)("invoice pipeline (integration)", async () => {
  const { processInvoice } = await import("./process-invoice");
  const { processInboundMessage, reprocessEmailInvoice } = await import("./process-email");
  const prisma = new PrismaClient({ datasourceUrl: url });

  const ORG = "org_pipe";
  const PAPELERIA = "sup_papeleria";
  const TEXT = "Factura PC-901\nProveedor: Papelería Central\nCuenta: 1234504821\nTotal: 45.90 USD\nFecha: 2026-10-05";
  const claim = (value: string, excerpt = value) => ({ value, excerpt });
  const none = { value: null, excerpt: null };
  const raw = (overrides: Partial<RawExtraction> = {}): RawExtraction => ({
    isInvoice: true,
    invoiceNumber: claim("PC-901", "Factura PC-901"),
    supplierName: claim("Papelería Central", "Proveedor: Papelería Central"),
    beneficiaryAccount: claim("1234504821", "Cuenta: 1234504821"),
    amount: claim("45.90", "Total: 45.90 USD"),
    currency: claim("USD", "Total: 45.90 USD"),
    description: none,
    invoiceDate: claim("2026-10-05", "Fecha: 2026-10-05"),
    dueDate: none,
    injectionSuspected: false,
    ...overrides,
  });
  // Modelo falso: devuelve una extracción por llamada (en orden) o falla.
  const fakeModel = (...outputs: Array<RawExtraction | Error>): ExtractDeps => ({
    extractPdfPages: async () => [TEXT],
    transcribeWithVision: async () => TEXT,
    runExtraction: async () => {
      const next = outputs.length > 1 ? outputs.shift() : outputs[0];
      if (next instanceof Error) throw next;
      return next;
    },
  });
  const blobs = new Map<string, Uint8Array>();
  const fakeBlob: BlobStorePort = {
    put: async () => { throw new Error("no se usa"); },
    get: async (fileRef) => ({ body: blobs.get(fileRef) ?? new Uint8Array(), contentType: "application/octet-stream" }),
  };

  beforeEach(async () => {
    blobs.clear();
    await prisma.$executeRawUnsafe(
      `TRUNCATE invoices, document_groups, ignored_inbound_items, documents, gmail_inbound_messages, gmail_connections,
       audit_events, payment_decisions, approval_requests, payment_authorizations, payment_policies, bank_transactions,
       bank_import_batches, contracts, suppliers, approval_permissions, organization_memberships, users, organizations CASCADE`,
    );
    await prisma.organization.create({ data: { id: ORG, name: "Pipe" } });
    await prisma.user.create({ data: { id: "user_admin", email: "admin@demo.test" } });
    await prisma.supplier.create({ data: { id: PAPELERIA, organizationId: ORG, name: "Papelería Central", normalizedName: "papeleria central" } });
    await prisma.paymentPolicy.create({
      data: { organizationId: ORG, version: 1, autoApprovalLimitMinor: 200_000, monthlyBudgetMinor: 2_000_000, currency: "USD", effectiveFrom: new Date("2026-01-01T00:00:00Z"), createdBy: "user_admin" },
    });
    await prisma.paymentAuthorization.create({
      data: { organizationId: ORG, supplierId: PAPELERIA, beneficiaryAccountRef: "****4821", currency: "USD", maxAmountMinor: 10_000, scope: "recurring", frequency: "monthly", validFrom: new Date("2026-01-01T00:00:00Z"), validUntil: new Date("2027-12-31T00:00:00Z"), authorizedBy: "user_admin" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const manualInput = (invoiceId: string) => ({
    invoiceId,
    organizationId: ORG,
    source: "dashboard" as const,
    documentGroupId: null,
    gmailInboundMessageId: null,
    primaryDocumentId: null,
    documents: [{ documentId: "upload", kind: "pdf" as const, mediaType: "application/pdf", bytes: new Uint8Array([1]), text: null }],
    metadata: { senderName: null, senderEmail: null, subject: null, attachmentFilenames: [] },
    meta: { sourceAccountId: null, sourceMessageId: null, documentId: null, documentType: "pdf" as const, receivedAt: "2026-10-17T12:00:00Z" },
  });

  // Correo con dos adjuntos de factura y cuerpo: dos candidatos + grupo de contexto.
  async function seedEmail() {
    await prisma.gmailConnection.create({
      data: { id: "gc_1", organizationId: ORG, connectedByUserId: "user_admin", composioUserId: "cu", composioConnectedAccountId: "ca", composioAuthConfigId: "ac", status: "active" },
    });
    await prisma.gmailInboundMessage.create({
      data: { id: "in_1", organizationId: ORG, gmailConnectionId: "gc_1", composioEventId: "ev_1", gmailMessageId: "gm_1", sender: "Papelería Central <facturas@papeleria.test>", subject: "Facturas de octubre", receivedAt: new Date("2026-10-17T12:00:00Z"), processingStatus: "received" },
    });
    const doc = (id: string, source: "invoice_document" | "email_body", mimeType: string, groupId: string, role: "primary" | "supporting") =>
      prisma.document.create({
        data: { id, organizationId: ORG, gmailInboundMessageId: "in_1", fileRef: `ref/${id}`, publicUrl: `https://r2.test/${id}`, mimeType, sha256: `sha_${id}`, originalFilename: `${id}.pdf`, source, byteSize: 10, receivedAt: new Date("2026-10-17T12:00:00Z"), groupId, groupRole: role },
      });
    for (const [id, kind] of [["grp_a", "invoice_candidate"], ["grp_b", "invoice_candidate"], ["grp_ctx", "message_context"]] as const) {
      await prisma.documentGroup.create({ data: { id, organizationId: ORG, gmailInboundMessageId: "in_1", kind } });
    }
    await doc("doc_a", "invoice_document", "application/pdf", "grp_a", "primary");
    await doc("doc_b", "invoice_document", "application/pdf", "grp_b", "primary");
    await doc("doc_body", "email_body", "text/plain", "grp_ctx", "supporting");
    blobs.set("ref/doc_a", new Uint8Array([1]));
    blobs.set("ref/doc_b", new Uint8Array([2]));
    blobs.set("ref/doc_body", new TextEncoder().encode("Adjuntamos las facturas de octubre."));
  }

  it("manual upload: extracts, resolves the supplier and auto-approves an authorized invoice", async () => {
    const result = await processInvoice(manualInput("inv_manual_1"), { extract: fakeModel(raw()) });
    expect(result).toMatchObject({ ok: true, invoiceId: "inv_manual_1", decision: { decision: "aprobada" } });
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: "inv_manual_1" } });
    expect(invoice).toMatchObject({ extractionStatus: "extracted", supplierId: PAPELERIA, supplierMatchStatus: "matched", amountMinor: 4590, source: "dashboard" });
    expect(await prisma.paymentDecision.count({ where: { invoiceId: "inv_manual_1" } })).toBe(1);
    expect(JSON.stringify(invoice.contextJson)).not.toContain("1234504821");
  });

  it("email: one invoice per candidate group, email marked processed, sender parsed", async () => {
    await seedEmail();
    const second = raw({ invoiceNumber: claim("PC-902", "Factura PC-901") });
    const result = await processInboundMessage("in_1", { blob: fakeBlob, extract: () => fakeModel(raw(), second) });
    expect(result.status).toBe("processed");
    expect(result.results).toHaveLength(2);

    const invoices = await prisma.invoice.findMany({ where: { gmailInboundMessageId: "in_1" }, orderBy: { id: "asc" } });
    expect(invoices.map((i) => [i.id, i.documentGroupId, i.extractionStatus])).toEqual([
      ["inv_grp_a", "grp_a", "extracted"],
      ["inv_grp_b", "grp_b", "extracted"],
    ]);
    const context = invoices[0].contextJson as { email: string; source: string; sourceMessageId: string };
    expect(context).toMatchObject({ email: "facturas@papeleria.test", source: "email", sourceMessageId: "gm_1" });
    expect(await prisma.gmailInboundMessage.findUniqueOrThrow({ where: { id: "in_1" } })).toMatchObject({ processingStatus: "processed" });
    // Misma autorización mensual: la primera se aprueba y la segunda del mes escala.
    const decisions = result.results.map((r) => ("decision" in r ? r.decision.decision : null)).sort();
    expect(decisions).toEqual(["aprobada", "requiere_aprobacion"]);
  });

  it("is idempotent: reprocessing an email or a decided group creates nothing new", async () => {
    await seedEmail();
    await processInboundMessage("in_1", { blob: fakeBlob, extract: () => fakeModel(raw(), raw({ invoiceNumber: claim("PC-902", "Factura PC-901") })) });
    expect(await processInboundMessage("in_1", { blob: fakeBlob, extract: () => fakeModel(raw()) })).toMatchObject({ status: "skipped" });
    expect(await reprocessEmailInvoice("inv_grp_a", ORG, { blob: fakeBlob, extract: () => fakeModel(raw()) })).toMatchObject({ ok: true, skipped: "already_decided" });
    expect(await prisma.invoice.count()).toBe(2);
    expect(await prisma.paymentDecision.count()).toBe(2);
  });

  it("records an extraction failure without a decision, and a retry recovers it", async () => {
    await seedEmail();
    await processInboundMessage("in_1", { blob: fakeBlob, extract: () => fakeModel(new Error("modelo caído")) });
    const failed = await prisma.invoice.findUniqueOrThrow({ where: { id: "inv_grp_a" } });
    expect(failed).toMatchObject({ extractionStatus: "failed" });
    expect(failed.extractionError).toContain("extraction/llm");
    expect(await prisma.paymentDecision.count()).toBe(0);

    const retried = await reprocessEmailInvoice("inv_grp_a", ORG, { blob: fakeBlob, extract: () => fakeModel(raw()) });
    expect(retried).toMatchObject({ ok: true, decision: { decision: "aprobada" } });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: "inv_grp_a" } })).toMatchObject({ extractionStatus: "extracted", extractionError: null });
  });

  it("escalates when the extracted name only resembles a catalog supplier (ambiguous)", async () => {
    const result = await processInvoice(manualInput("inv_manual_2"), {
      extract: fakeModel(raw({ supplierName: claim("Papeleria Centrall", "Proveedor: Papelería Central") })),
    });
    expect(result).toMatchObject({ ok: true, decision: { decision: "requiere_aprobacion" } });
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: "inv_manual_2" } })).toMatchObject({ supplierMatchStatus: "ambiguous", supplierId: null });
  });

  it("does not reprocess another organization's invoice", async () => {
    await seedEmail();
    await processInboundMessage("in_1", { blob: fakeBlob, extract: () => fakeModel(new Error("caído")) });
    expect(await reprocessEmailInvoice("inv_grp_a", "org_other", { blob: fakeBlob, extract: () => fakeModel(raw()) })).toBeNull();
  });
});
