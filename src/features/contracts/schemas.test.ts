/**
 * Purpose: tests for the contract form/API schema (amount by currency scale, optional
 *   fields, validity order).
 * Runs in: Vitest (`npm test`).
 * Triggered by: `npm test`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: ./schemas.ts.
 */
import { describe, expect, it } from "vitest";
import { ContractInputSchema } from "./schemas";

function raw(overrides: Record<string, string> = {}) {
  return {
    supplierId: "sup_vercel",
    agreedAmount: "20.00",
    currency: "usd",
    frequency: "monthly",
    validFrom: "2026-01-01",
    validTo: "",
    beneficiaryAccountRef: "",
    description: "",
    ...overrides,
  };
}

describe("ContractInputSchema", () => {
  it("parses a form submission into minor units with nulls for empty fields", () => {
    expect(ContractInputSchema.parse(raw())).toEqual({
      supplierId: "sup_vercel",
      agreedAmountMinor: 2000,
      currency: "USD",
      frequency: "monthly",
      validFrom: "2026-01-01",
      validTo: null,
      beneficiaryAccountRef: null,
      description: null,
    });
  });

  it("treats optional fields omitted from a JSON body (POST /api/contracts) as null", () => {
    const onlyRequired = { supplierId: "sup_vercel", agreedAmount: "20.00", currency: "USD", frequency: "monthly", validFrom: "2026-01-01" };
    expect(ContractInputSchema.parse(onlyRequired)).toMatchObject({ validTo: null, beneficiaryAccountRef: null, description: null });
  });

  it("uses the currency scale for the amount", () => {
    expect(ContractInputSchema.parse(raw({ agreedAmount: "1500", currency: "JPY" })).agreedAmountMinor).toBe(1500);
    expect(ContractInputSchema.safeParse(raw({ agreedAmount: "15.5", currency: "JPY" })).success).toBe(false);
  });

  it.each(["0", "0.00", "-5", "abc", ""])("rejects amount %j", (agreedAmount) => {
    expect(ContractInputSchema.safeParse(raw({ agreedAmount })).success).toBe(false);
  });

  it("rejects a validity that ends before it starts", () => {
    expect(ContractInputSchema.safeParse(raw({ validTo: "2025-12-31" })).success).toBe(false);
    expect(ContractInputSchema.safeParse(raw({ validTo: "2026-01-01" })).success).toBe(true);
  });

  it("rejects invalid currencies and frequencies", () => {
    expect(ContractInputSchema.safeParse(raw({ currency: "US" })).success).toBe(false);
    expect(ContractInputSchema.safeParse(raw({ currency: "XOF" })).success).toBe(false);
    expect(ContractInputSchema.safeParse(raw({ frequency: "daily" })).success).toBe(false);
  });

  it("rejects a too-short account reference", () => {
    expect(ContractInputSchema.safeParse(raw({ beneficiaryAccountRef: "12" })).success).toBe(false);
  });
});
