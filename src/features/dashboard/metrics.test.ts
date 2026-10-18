import { describe, expect, it } from "vitest";
import {
  classifyReceipt,
  dailyCounts,
  dailyDecisionSeries,
  latestPerInvoice,
  sumByCurrency,
  summarizeDecisions,
  summarizeReceipts,
  topReasonCodes,
  utcDayRange,
  type ClassifiedReceipt,
  type DecisionRow,
  type ReceiptFacts,
  type ReceiptRow,
} from "./metrics";

const at = (iso: string) => new Date(iso);
const row = (overrides: Partial<DecisionRow>): DecisionRow => ({
  invoiceId: "inv_1",
  decision: "approved",
  decisionSource: "automatic",
  reasonCodes: ["AUTO_APPROVAL_RULES_PASSED"],
  evaluatedAt: at("2026-10-10T10:00:00Z"),
  ...overrides,
});

describe("decision metrics", () => {
  it("keeps only the newest decision of each invoice", () => {
    const rows = [
      row({ invoiceId: "a", decision: "requires_approval", evaluatedAt: at("2026-10-01T00:00:00Z") }),
      row({ invoiceId: "a", decision: "approved", decisionSource: "human", evaluatedAt: at("2026-10-02T00:00:00Z") }),
      row({ invoiceId: "b", decision: "blocked" }),
    ];
    const latest = latestPerInvoice(rows);
    expect(latest).toHaveLength(2);
    expect(latest.find((d) => d.invoiceId === "a")?.decisionSource).toBe("human");
  });

  it("counts outcomes and autonomy from automatic approvals only", () => {
    const summary = summarizeDecisions([
      row({ invoiceId: "a" }),
      row({ invoiceId: "b", decisionSource: "human" }),
      row({ invoiceId: "c", decision: "blocked" }),
      row({ invoiceId: "d", decision: "requires_approval" }),
    ]);
    expect(summary).toEqual({ total: 4, approved: 2, requiresApproval: 1, blocked: 1, autoApproved: 1, autonomyRate: 0.25 });
  });

  it("has no autonomy rate without invoices", () => {
    expect(summarizeDecisions([]).autonomyRate).toBeNull();
  });

  it("ranks safety catches, ignoring generic and approved reasons", () => {
    const top = topReasonCodes([
      row({ invoiceId: "a", decision: "blocked", reasonCodes: ["DUPLICATE_INVOICE", "SUPPLIER_NOT_AUTHORIZED"] }),
      row({ invoiceId: "b", decision: "requires_approval", reasonCodes: ["SUPPLIER_NOT_AUTHORIZED", "HUMAN_APPROVAL_REQUIRED"] }),
      row({ invoiceId: "c", decision: "approved", reasonCodes: ["AUTO_APPROVAL_RULES_PASSED"] }),
    ], 5);
    expect(top).toEqual([
      { code: "SUPPLIER_NOT_AUTHORIZED", count: 2 },
      { code: "DUPLICATE_INVOICE", count: 1 },
    ]);
  });

  it("sums per currency and skips unknown amounts", () => {
    expect(sumByCurrency([
      { amountMinor: 100, currency: "USD" },
      { amountMinor: 250, currency: "EUR" },
      { amountMinor: 50, currency: "USD" },
      { amountMinor: null, currency: "USD" },
      { amountMinor: 70, currency: null },
    ])).toEqual({ USD: 150, EUR: 250 });
  });
});

describe("classifyReceipt", () => {
  const receipt = (overrides: Partial<ReceiptRow> = {}): ReceiptRow => ({
    invoiceId: "inv_r",
    supplierId: "sup_nube",
    invoiceNumber: "NH-01",
    amountMinor: 150_000,
    currency: "USD",
    paidOn: "2027-01-05",
    receivedOn: "2027-01-06",
    ...overrides,
  });
  const facts = (overrides: Partial<ReceiptFacts> = {}): ReceiptFacts => ({
    approvedDecisions: [],
    recurringAuthorizations: [],
    recurringSupplierIds: new Set(),
    bankOutflows: [],
    receiptCountBySupplier: new Map(),
    ...overrides,
  });
  const authorization = { supplierId: "sup_nube", currency: "USD", maxAmountMinor: 200_000, validFrom: "2027-01-01", validUntil: "2027-12-31" };

  it("is unapproved when nothing in Pacta covers it", () => {
    expect(classifyReceipt(receipt(), facts())).toEqual({ status: "unapproved", signals: [] });
  });

  it("recognizes a payment Pacta approved", () => {
    const result = classifyReceipt(receipt(), facts({ approvedDecisions: [{ supplierId: "sup_nube", invoiceNumber: " NH-01 " }] }));
    expect(result.status).toBe("approved_in_pacta");
  });

  it("an approved decision of another supplier does not count", () => {
    const result = classifyReceipt(receipt(), facts({ approvedDecisions: [{ supplierId: "sup_other", invoiceNumber: "NH-01" }] }));
    expect(result.status).toBe("unapproved");
  });

  it("is covered by an active recurring authorization within amount, currency and dates", () => {
    expect(classifyReceipt(receipt(), facts({ recurringAuthorizations: [authorization] })).status).toBe("covered_by_authorization");
  });

  it("is not covered when the amount, currency or validity does not fit", () => {
    const check = (a: typeof authorization, r: ReceiptRow = receipt()) => classifyReceipt(r, facts({ recurringAuthorizations: [a] })).status;
    expect(check({ ...authorization, maxAmountMinor: 100_000 })).toBe("unapproved");
    expect(check({ ...authorization, currency: "EUR" })).toBe("unapproved");
    expect(check({ ...authorization, validUntil: "2026-12-31" })).toBe("unapproved");
    expect(check(authorization, receipt({ amountMinor: null }))).toBe("unapproved");
  });

  it("uses the received date when the paid date is missing", () => {
    const result = classifyReceipt(receipt({ paidOn: null, receivedOn: "2028-02-01" }), facts({ recurringAuthorizations: [authorization] }));
    expect(result.status).toBe("unapproved");
  });

  it("flags likely recurring charges from bank history or repeated receipts", () => {
    expect(classifyReceipt(receipt(), facts({ recurringSupplierIds: new Set(["sup_nube"]) })).signals).toContain("likely_recurring");
    expect(classifyReceipt(receipt(), facts({ receiptCountBySupplier: new Map([["sup_nube", 2]]) })).signals).toContain("likely_recurring");
    expect(classifyReceipt(receipt(), facts({ receiptCountBySupplier: new Map([["sup_nube", 1]]) })).signals).not.toContain("likely_recurring");
  });

  it("confirms with a bank outflow of the same amount within five days", () => {
    const outflow = { supplierId: "sup_nube", amountMinor: 150_000, currency: "USD", postedOn: "2027-01-09" };
    expect(classifyReceipt(receipt(), facts({ bankOutflows: [outflow] })).signals).toContain("bank_confirmed");
    expect(classifyReceipt(receipt(), facts({ bankOutflows: [{ ...outflow, postedOn: "2027-01-11" }] })).signals).not.toContain("bank_confirmed");
    expect(classifyReceipt(receipt(), facts({ bankOutflows: [{ ...outflow, amountMinor: 149_999 }] })).signals).not.toContain("bank_confirmed");
  });

  it("marks an unknown supplier and gives it no other signal", () => {
    const result = classifyReceipt(receipt({ supplierId: null }), facts({ recurringAuthorizations: [authorization] }));
    expect(result).toEqual({ status: "unapproved", signals: ["supplier_unknown"] });
  });
});

describe("summarizeReceipts", () => {
  const classified = (overrides: Partial<ClassifiedReceipt>): ClassifiedReceipt => ({
    invoiceId: "r",
    supplierId: "sup_nube",
    supplierName: "Nube Hosting",
    invoiceNumber: null,
    amountMinor: 1_000,
    currency: "USD",
    paidOn: "2027-01-05",
    receivedOn: "2027-01-05",
    status: "unapproved",
    signals: [],
    ...overrides,
  });

  it("totals by status, counts signals and ranks unapproved suppliers", () => {
    const summary = summarizeReceipts([
      classified({ invoiceId: "a", signals: ["likely_recurring", "bank_confirmed"] }),
      classified({ invoiceId: "b", signals: ["likely_recurring"] }),
      classified({ invoiceId: "c", supplierId: null, supplierName: null, amountMinor: 500, currency: "EUR", signals: ["supplier_unknown"] }),
      classified({ invoiceId: "d", supplierId: "sup_soft", supplierName: "Soft", status: "covered_by_authorization", amountMinor: 200 }),
      classified({ invoiceId: "e", supplierId: "sup_pap", supplierName: "Papelería", status: "approved_in_pacta", amountMinor: 300 }),
    ], 5);
    expect(summary.count).toBe(5);
    expect(summary.byStatus).toEqual({
      unapproved: { count: 3, amountByCurrency: { USD: 2_000, EUR: 500 } },
      covered_by_authorization: { count: 1, amountByCurrency: { USD: 200 } },
      approved_in_pacta: { count: 1, amountByCurrency: { USD: 300 } },
    });
    expect(summary.likelyRecurring).toBe(2);
    expect(summary.bankConfirmed).toBe(1);
    expect(summary.topUnapprovedSuppliers).toEqual([
      { supplierId: "sup_nube", name: "Nube Hosting", count: 2, amountByCurrency: { USD: 2_000 } },
      { supplierId: null, name: "Proveedor no reconocido", count: 1, amountByCurrency: { EUR: 500 } },
    ]);
  });

  it("limits the supplier ranking and handles no receipts", () => {
    const many = ["a", "b", "c"].map((id) => classified({ invoiceId: id, supplierId: `sup_${id}`, supplierName: id }));
    expect(summarizeReceipts(many, 2).topUnapprovedSuppliers).toHaveLength(2);
    const empty = summarizeReceipts([], 3);
    expect(empty.count).toBe(0);
    expect(empty.byStatus.unapproved).toEqual({ count: 0, amountByCurrency: {} });
    expect(empty.topUnapprovedSuppliers).toEqual([]);
  });
});

describe("daily series", () => {
  const NOW = new Date("2027-01-20T15:30:00Z");

  it("lists UTC calendar days ending today, oldest first", () => {
    expect(utcDayRange(NOW, 3)).toEqual(["2027-01-18", "2027-01-19", "2027-01-20"]);
    expect(utcDayRange(new Date("2027-03-01T01:00:00Z"), 2)).toEqual(["2027-02-28", "2027-03-01"]);
  });

  it("buckets decisions by outcome and ignores days outside the range", () => {
    const days = utcDayRange(NOW, 3);
    const series = dailyDecisionSeries([
      { decision: "approved", evaluatedAt: at("2027-01-18T10:00:00Z") },
      { decision: "blocked", evaluatedAt: at("2027-01-18T23:59:59Z") },
      { decision: "requires_approval", evaluatedAt: at("2027-01-20T00:00:00Z") },
      { decision: "approved", evaluatedAt: at("2027-01-10T10:00:00Z") },
    ], days);
    expect(series).toEqual([
      { day: "2027-01-18", approved: 1, requiresApproval: 0, blocked: 1 },
      { day: "2027-01-19", approved: 0, requiresApproval: 0, blocked: 0 },
      { day: "2027-01-20", approved: 0, requiresApproval: 1, blocked: 0 },
    ]);
  });

  it("counts instants per day with zeros for empty days", () => {
    const days = utcDayRange(NOW, 2);
    expect(dailyCounts([at("2027-01-20T01:00:00Z"), at("2027-01-20T22:00:00Z"), at("2026-12-01T00:00:00Z")], days)).toEqual([
      { day: "2027-01-19", count: 0 },
      { day: "2027-01-20", count: 2 },
    ]);
  });
});
