/**
 * Purpose: integration check that the matcher's output flows into B's engine correctly:
 *   a contract mismatch escalates and a matching contract never replaces an authorization.
 * Runs in: Vitest (`npm test`).
 * Triggered by: `npm test`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: ./match-contract.ts, src/features/decisions/engine (decide, test fixtures).
 */
import { describe, expect, it } from "vitest";
import { decide } from "@/features/decisions/engine/decide";
import { ACCOUNT, makeFacts, makeInvoice, SUPPLIER_ID } from "@/features/decisions/engine/test-fixtures";
import { matchContract, type MatchableContract } from "./match-contract";

const contract: MatchableContract = {
  contractId: "ctr_vercel",
  supplierId: SUPPLIER_ID,
  status: "active",
  agreedAmountMinor: 2000,
  currency: "USD",
  frequency: "monthly",
  validFrom: "2026-01-01",
  validTo: "2026-12-31",
  beneficiaryAccountRef: ACCOUNT,
};

function invoiceWithContract(amountMinor: number) {
  const base = makeInvoice({ amountMinor });
  return { ...base, contractMatch: matchContract(base, [contract]) };
}

describe("contract match → decide()", () => {
  it("escalates an authorized invoice whose amount contradicts the contract", () => {
    const result = decide(invoiceWithContract(2400), makeFacts()); // dentro de la autorización (25.00)
    expect(result.decision).toBe("requiere_aprobacion");
    expect(result.reasonCodes).toContain("CONTRATO_NO_COINCIDE");
  });

  it("approves an authorized invoice that also matches its contract", () => {
    expect(decide(invoiceWithContract(2000), makeFacts()).decision).toBe("aprobada");
  });

  it("never approves on a matching contract alone, without an authorization", () => {
    const result = decide(invoiceWithContract(2000), makeFacts({ authorizations: [] }));
    expect(result.decision).not.toBe("aprobada");
    expect(result.reasonCodes).toEqual(expect.arrayContaining([expect.stringMatching(/NO_AUTORIZAD/)]));
  });
});
