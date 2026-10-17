/**
 * Purpose: fictitious test data; a legitimate, fully authorized Vercel invoice plus facts.
 * Runs in: tests only (Vitest).
 * Triggered by: imported by decide.test.ts.
 * Receives → Returns: optional overrides → InvoiceContext, EngineFacts, authorization or
 *   prior-decision objects.
 * Talks to: ./facts.ts and src/shared/schemas/invoice-context.ts (types only).
 */
import type { InvoiceContext } from "@/shared/schemas/invoice-context";
import type { EngineAuthorization, EngineFacts, EnginePriorDecision } from "./facts";

// Datos ficticios. Base: factura legítima de Vercel, totalmente autorizada y con presupuesto.

export const ORG_ID = "org_demo";
export const SUPPLIER_ID = "sup_vercel";
export const ACCOUNT = "****1234";

export function makeInvoice(overrides: Partial<InvoiceContext> = {}): InvoiceContext {
  return {
    schemaVersion: 1,
    invoiceId: "inv_current",
    organizationId: ORG_ID,
    invoiceNumber: "VER-2026-10",
    source: "email",
    sourceAccountId: "gc_demo",
    sourceMessageId: "msg_1",
    documentId: "doc_current",
    documentType: "pdf",
    receivedAt: "2026-10-17T11:00:00Z",
    supplierId: SUPPLIER_ID,
    supplierName: "Vercel Inc.",
    supplierMatchStatus: "matched",
    beneficiaryAccountReference: ACCOUNT,
    amountMinor: 2000, // 20.00 USD
    currency: "USD",
    description: "Pro plan, October 2026",
    invoiceDate: "2026-10-01",
    dueDate: "2026-10-15",
    contractMatch: null,
    missingFields: [],
    extractionWarnings: [],
    evidence: [],
    ...overrides,
  };
}

export function makeAuthorization(overrides: Partial<EngineAuthorization> = {}): EngineAuthorization {
  return {
    authorizationId: "auth_vercel",
    supplierId: SUPPLIER_ID,
    beneficiaryAccountRef: ACCOUNT,
    currency: "USD",
    maxAmountMinor: 2500, // 25.00 USD
    scope: "recurring",
    frequency: "monthly",
    validFrom: "2026-01-01",
    validUntil: "2026-12-31",
    status: "active",
    approvalsInCurrentPeriod: 0, // aún no cubrió ninguna factura este mes
    ...overrides,
  };
}

export function makePriorDecision(overrides: Partial<EnginePriorDecision> = {}): EnginePriorDecision {
  return {
    decisionId: "dec_prior",
    evaluatedAt: "2026-09-02T12:00:00Z",
    invoiceId: "inv_prior",
    supplierId: SUPPLIER_ID,
    invoiceNumber: "VER-2026-09",
    amountMinor: 2000,
    invoiceDate: "2026-09-01",
    decision: "approved",
    ...overrides,
  };
}

export function makeFacts(overrides: Partial<EngineFacts> = {}): EngineFacts {
  return {
    policy: {
      policyId: "pol_demo",
      version: 3,
      autoApprovalLimitMinor: 50_000, // 500.00 USD
      monthlyBudgetMinor: 1_000_000, // 10,000.00 USD
      currency: "USD",
    },
    authorizations: [makeAuthorization()],
    priorDecisions: [makePriorDecision()],
    documentDuplicateInvoiceIds: [],
    budgetUsedMinor: 320_000, // 3,200.00 USD
    recurrenceSuggested: true,
    now: "2026-10-17T12:00:00Z",
    decisionId: "dec_current",
    traceId: null,
    ...overrides,
  };
}
