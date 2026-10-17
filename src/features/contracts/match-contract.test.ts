/**
 * Purpose: tests for the contract matcher, including trap cases (wrong amount, other
 *   currency, changed account, overlapping contracts, expired contract, missing date).
 * Runs in: Vitest (`npm test`).
 * Triggered by: `npm test`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: ./match-contract.ts, src/shared/schemas/invoice-context.ts.
 */
import { describe, expect, it } from "vitest";
import { ContractMatchSchema } from "@/shared/schemas/invoice-context";
import { matchContract, type ContractMatchInvoiceFacts, type MatchableContract } from "./match-contract";

// Datos ficticios: suscripción mensual de Vercel a 20.00 USD.
function makeFacts(overrides: Partial<ContractMatchInvoiceFacts> = {}): ContractMatchInvoiceFacts {
  return {
    supplierId: "sup_vercel",
    amountMinor: 2000,
    currency: "USD",
    invoiceDate: "2026-10-01",
    beneficiaryAccountReference: "****1234",
    ...overrides,
  };
}

function makeContract(overrides: Partial<MatchableContract> = {}): MatchableContract {
  return {
    contractId: "ctr_vercel",
    supplierId: "sup_vercel",
    status: "active",
    agreedAmountMinor: 2000,
    currency: "USD",
    frequency: "monthly",
    validFrom: "2026-01-01",
    validTo: "2026-12-31",
    beneficiaryAccountRef: "****1234",
    ...overrides,
  };
}

function expectValid(result: ReturnType<typeof matchContract>) {
  expect(ContractMatchSchema.safeParse(result).success).toBe(true);
}

describe("matchContract", () => {
  it("returns null when the supplier is not confirmed", () => {
    expect(matchContract(makeFacts({ supplierId: null }), [makeContract()])).toBeNull();
  });

  it("returns not_found when the supplier has no contracts", () => {
    const result = matchContract(makeFacts(), []);
    expect(result?.matchStatus).toBe("not_found");
    expect(result?.contractId).toBeNull();
    expectValid(result);
  });

  it("ignores other suppliers' contracts and terminated contracts", () => {
    const contracts = [
      makeContract({ contractId: "ctr_other", supplierId: "sup_aws" }),
      makeContract({ contractId: "ctr_old", status: "terminated" }),
    ];
    expect(matchContract(makeFacts(), contracts)?.matchStatus).toBe("not_found");
  });

  it("matches an invoice that agrees with its only contract", () => {
    const result = matchContract(makeFacts(), [makeContract()]);
    expect(result).toMatchObject({
      contractId: "ctr_vercel",
      matchStatus: "matched",
      agreedAmountMinor: 2000,
      currency: "USD",
      frequency: "monthly",
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      discrepancies: [],
    });
    expect(result?.evidence).toEqual([
      expect.objectContaining({ evidenceId: "contract:ctr_vercel", sourceType: "manual_entry", documentId: null }),
    ]);
    expectValid(result);
  });

  it("matches an open-ended contract", () => {
    const result = matchContract(makeFacts({ invoiceDate: "2030-05-01" }), [makeContract({ validTo: null })]);
    expect(result?.matchStatus).toBe("matched");
  });

  it("flags an amount off by one cent", () => {
    const result = matchContract(makeFacts({ amountMinor: 2001 }), [makeContract()]);
    expect(result?.matchStatus).toBe("mismatch");
    expect(result?.discrepancies).toEqual([
      expect.objectContaining({ field: "amount", expected: "$20.00", actual: "$20.01" }),
    ]);
    expectValid(result);
  });

  it("flags a lower amount too: no tolerance in the MVP", () => {
    expect(matchContract(makeFacts({ amountMinor: 1500 }), [makeContract()])?.matchStatus).toBe("mismatch");
  });

  it("flags an unknown amount instead of treating it as zero", () => {
    const result = matchContract(makeFacts({ amountMinor: null }), [makeContract()]);
    expect(result?.discrepancies).toEqual([expect.objectContaining({ field: "amount", actual: null })]);
  });

  it("flags a different currency without comparing amounts", () => {
    const result = matchContract(makeFacts({ currency: "EUR" }), [makeContract()]);
    expect(result?.matchStatus).toBe("mismatch");
    expect(result?.discrepancies.map((d) => d.field)).toEqual(["currency"]);
  });

  it("flags a changed beneficiary account", () => {
    const result = matchContract(makeFacts({ beneficiaryAccountReference: "****9999" }), [makeContract()]);
    expect(result?.matchStatus).toBe("mismatch");
    expect(result?.discrepancies).toEqual([
      expect.objectContaining({ field: "beneficiary_account", expected: "****1234", actual: "****9999" }),
    ]);
  });

  it("does not compare accounts when either side is unknown", () => {
    expect(matchContract(makeFacts({ beneficiaryAccountReference: null }), [makeContract()])?.matchStatus).toBe("matched");
    expect(matchContract(makeFacts(), [makeContract({ beneficiaryAccountRef: null })])?.matchStatus).toBe("matched");
  });

  it("is ambiguous when two contracts are in force on the invoice date", () => {
    const contracts = [makeContract({ contractId: "ctr_a" }), makeContract({ contractId: "ctr_b", agreedAmountMinor: 3000 })];
    const result = matchContract(makeFacts(), contracts);
    expect(result?.matchStatus).toBe("ambiguous");
    expect(result?.contractId).toBeNull();
    expect(result?.evidence.map((e) => e.evidenceId)).toEqual(["contract:ctr_a", "contract:ctr_b"]);
    expectValid(result);
  });

  it("is ambiguous when the invoice date is unknown", () => {
    const result = matchContract(makeFacts({ invoiceDate: null }), [makeContract()]);
    expect(result?.matchStatus).toBe("ambiguous");
    expectValid(result);
  });

  it("picks the in-force contract when others have expired", () => {
    const contracts = [
      makeContract({ contractId: "ctr_2025", validFrom: "2025-01-01", validTo: "2025-12-31", agreedAmountMinor: 1500 }),
      makeContract({ contractId: "ctr_2026" }),
    ];
    expect(matchContract(makeFacts(), contracts)).toMatchObject({ contractId: "ctr_2026", matchStatus: "matched" });
  });

  it("reports a period mismatch against the closest contract when none is in force", () => {
    const contracts = [
      makeContract({ contractId: "ctr_2024", validFrom: "2024-01-01", validTo: "2024-12-31" }),
      makeContract({ contractId: "ctr_2025", validFrom: "2025-01-01", validTo: "2025-12-31" }),
    ];
    const result = matchContract(makeFacts({ invoiceDate: "2026-02-01" }), contracts);
    expect(result?.contractId).toBe("ctr_2025");
    expect(result?.matchStatus).toBe("mismatch");
    expect(result?.discrepancies).toEqual([
      expect.objectContaining({ field: "period", expected: "2025-01-01 to 2025-12-31", actual: "2026-02-01" }),
    ]);
    expectValid(result);
  });

  it("treats a contract that starts after the invoice as out of period", () => {
    const result = matchContract(makeFacts({ invoiceDate: "2025-12-15" }), [makeContract()]);
    expect(result?.discrepancies.map((d) => d.field)).toEqual(["period"]);
  });

  it("includes the validity boundaries", () => {
    expect(matchContract(makeFacts({ invoiceDate: "2026-01-01" }), [makeContract()])?.matchStatus).toBe("matched");
    expect(matchContract(makeFacts({ invoiceDate: "2026-12-31" }), [makeContract()])?.matchStatus).toBe("matched");
  });

  it("is deterministic regardless of input order", () => {
    const a = makeContract({ contractId: "ctr_a" });
    const b = makeContract({ contractId: "ctr_b" });
    expect(matchContract(makeFacts(), [a, b])).toEqual(matchContract(makeFacts(), [b, a]));
  });
});
