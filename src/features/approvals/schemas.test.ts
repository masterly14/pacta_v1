/**
 * Purpose: tests for the resolve-approval form schema with real FormData shapes (fields the
 *   browser does not send when the authorization checkbox is unticked).
 * Runs in: Vitest (`npm test`).
 * Triggered by: `npm test` / `npm run test:watch`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: ./schemas.ts.
 */
import { describe, expect, it } from "vitest";
import { ResolveApprovalInputSchema } from "./schemas";

// Igual que la server action: Object.fromEntries(FormData) del formulario real.
function submit(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  return ResolveApprovalInputSchema.safeParse(Object.fromEntries(formData));
}

describe("ResolveApprovalInputSchema", () => {
  it("accepts a reject without the authorization fields (checkbox unticked)", () => {
    const result = submit({ approvalRequestId: "apr_1", action: "reject", comment: "No corresponde" });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ approvalRequestId: "apr_1", action: "reject", comment: "No corresponde", authorization: null });
  });

  it("accepts an approve without authorization and an empty comment", () => {
    const result = submit({ approvalRequestId: "apr_1", action: "approve", comment: "" });
    expect(result.data).toEqual({ approvalRequestId: "apr_1", action: "approve", comment: null, authorization: null });
  });

  it("builds the authorization when the checkbox is ticked", () => {
    const result = submit({
      approvalRequestId: "apr_1",
      action: "approve",
      comment: "",
      authorize: "on",
      authAccount: "****1234",
      authMaxAmount: "1500.00",
      authFrequency: "monthly",
      authValidFrom: "2026-10-17",
      authValidUntil: "2027-10-17",
    });
    expect(result.data?.authorization).toEqual({
      beneficiaryAccountRef: "****1234",
      maxAmountMinor: 150_000,
      frequency: "monthly",
      validFrom: "2026-10-17",
      validUntil: "2027-10-17",
    });
  });

  it("ignores authorization fields on reject even if the checkbox is ticked", () => {
    const result = submit({ approvalRequestId: "apr_1", action: "reject", authorize: "on", authAccount: "****1234" });
    expect(result.data?.authorization).toBeNull();
  });

  it.each([
    ["missing max amount", { authMaxAmount: "" }],
    ["zero max amount", { authMaxAmount: "0" }],
    ["inverted validity", { authValidFrom: "2027-10-17", authValidUntil: "2026-10-17" }],
  ])("rejects an approve + authorization with %s", (_label, overrides) => {
    const base = {
      approvalRequestId: "apr_1",
      action: "approve",
      authorize: "on",
      authAccount: "****1234",
      authMaxAmount: "1500.00",
      authFrequency: "monthly",
      authValidFrom: "2026-10-17",
      authValidUntil: "2027-10-17",
    };
    expect(submit({ ...base, ...overrides }).success).toBe(false);
  });

  it("rejects an unknown action", () => {
    expect(submit({ approvalRequestId: "apr_1", action: "delete" }).success).toBe(false);
  });
});
