/**
 * Purpose: unit tests for the pure parts of the policies feature: money parsing, supplier
 *   name normalization, form schemas and permission checks.
 * Runs in: Vitest (`npm test`).
 * Triggered by: `npm test` / `npm run test:watch`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: ./money.ts, ./normalize.ts, ./schemas.ts, ./permissions.ts.
 */
import { describe, expect, it } from "vitest";
import { formatUsd, parseUsdToMinor, toUsdInput } from "./money";
import { normalizeSupplierName } from "./normalize";
import { checkCanAuthorize, checkCanGrantPermissions, checkCanManagePolicies, type PolicyActor } from "./permissions";
import { AuthorizationInputSchema, PermissionInputSchema, PolicyInputSchema, SupplierInputSchema } from "./schemas";

describe("money", () => {
  it.each([
    ["25", 2500],
    ["25.5", 2550],
    ["25.50", 2550],
    ["1,234.56", 123456],
    ["$1500.00", 150000],
    [" 0.01 ", 1],
    ["0", 0],
  ])("parses %s as %i minor units", (input, expected) => {
    expect(parseUsdToMinor(input)).toBe(expected);
  });

  it.each(["", "-5", "1.234", "abc", "12.3.4", "1e5", "99999999999"])("rejects %s", (input) => {
    expect(parseUsdToMinor(input)).toBeNull();
  });

  it("never goes through floats (0.1 + 0.2 style errors)", () => {
    expect(parseUsdToMinor("0.29")).toBe(29);
    expect(parseUsdToMinor("1.15")).toBe(115);
  });

  it("formats and round-trips amounts", () => {
    expect(formatUsd(123456)).toBe("$1,234.56");
    expect(formatUsd(5)).toBe("$0.05");
    expect(toUsdInput(200000)).toBe("2000.00");
    expect(parseUsdToMinor(toUsdInput(123456))).toBe(123456);
  });
});

describe("normalizeSupplierName", () => {
  // Debe coincidir con normalizeName de payment-history (el CSV asocia proveedores con este valor).
  function paymentHistoryNormalizeName(value: string): string {
    return value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  it.each(["Nube Hosting LLC", "Diseño Studio", "Papelería Central", "  ACME,  Inc. ", "Ñandú & Cía."])(
    "normalizes %s the same way as payment-history",
    (name) => {
      expect(normalizeSupplierName(name)).toBe(paymentHistoryNormalizeName(name));
    },
  );

  it("drops accents, case and punctuation", () => {
    expect(normalizeSupplierName("Papelería Central")).toBe("papeleria central");
    expect(normalizeSupplierName("NUBE-HOSTING, LLC.")).toBe("nube hosting llc");
  });
});

describe("form schemas", () => {
  it("parses a supplier with an optional account", () => {
    expect(SupplierInputSchema.parse({ name: " Nube Hosting LLC ", beneficiaryAccountRef: "" })).toEqual({
      name: "Nube Hosting LLC",
      beneficiaryAccountRef: null,
    });
  });

  it("converts policy amounts to minor units", () => {
    expect(PolicyInputSchema.parse({ autoApprovalLimitMinor: "2000", monthlyBudgetMinor: "20,000.00" })).toEqual({
      autoApprovalLimitMinor: 200000,
      monthlyBudgetMinor: 2000000,
    });
  });

  const authorization = {
    supplierId: "sup_1",
    beneficiaryAccountRef: "****1234",
    maxAmountMinor: "1500.00",
    scope: "recurring",
    frequency: "monthly",
    validFrom: "2026-10-01",
    validUntil: "2027-09-30",
  };

  it("accepts a valid recurring authorization", () => {
    expect(AuthorizationInputSchema.parse(authorization)).toMatchObject({ maxAmountMinor: 150000, frequency: "monthly" });
  });

  it.each([
    ["recurring without frequency", { frequency: "" }],
    ["one-time with frequency", { scope: "one_time" }],
    ["inverted validity", { validUntil: "2026-09-01" }],
    ["zero amount", { maxAmountMinor: "0" }],
    ["non-USD style amount", { maxAmountMinor: "1.500,00" }],
    ["short account reference", { beneficiaryAccountRef: "12" }],
  ])("rejects an authorization with %s", (_label, overrides) => {
    expect(AuthorizationInputSchema.safeParse({ ...authorization, ...overrides }).success).toBe(false);
  });

  it("requires an explicit limit for approvers", () => {
    expect(PermissionInputSchema.safeParse({ userId: "user_1", canApprove: "on", approvalLimitMinor: "" }).success).toBe(false);
  });

  // Formularios reales: un campo oculto no se envía (no llega como "" sino ausente).
  const formData = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return Object.fromEntries(fd);
  };

  it("saves a member without 'Aprueba' when the limit field is not rendered", () => {
    expect(PermissionInputSchema.parse(formData({ userId: "user_1", canManagePolicies: "on" }))).toEqual({
      userId: "user_1",
      canApprove: false,
      approvalLimitMinor: null,
      canManagePolicies: true,
    });
  });

  it("accepts a one-time authorization when the frequency field is not rendered", () => {
    const result = AuthorizationInputSchema.parse(
      formData({ supplierId: "s1", beneficiaryAccountRef: "****1234", maxAmountMinor: "100", scope: "one_time", validFrom: "2026-10-17", validUntil: "2026-12-31" }),
    );
    expect(result).toMatchObject({ scope: "one_time", frequency: null, maxAmountMinor: 10_000 });
  });

  it("drops the limit when the person cannot approve (matches the table CHECK)", () => {
    expect(
      PermissionInputSchema.parse({ userId: "user_1", approvalLimitMinor: "500", canManagePolicies: "on" }),
    ).toEqual({ userId: "user_1", canApprove: false, approvalLimitMinor: null, canManagePolicies: true });
  });
});

describe("permissions", () => {
  const base: PolicyActor = { userId: "user_1", organizationId: "org_1", role: "member", permission: null };
  const manager: PolicyActor = {
    ...base,
    permission: { canApprove: true, approvalLimitMinor: 100_000, canManagePolicies: true },
  };

  it("denies everything to a member without permission rows", () => {
    expect(checkCanManagePolicies(base)).not.toBeNull();
    expect(checkCanGrantPermissions(base)).not.toBeNull();
    expect(checkCanAuthorize(base, 1)).not.toBeNull();
  });

  it("lets only Clerk admins change permissions, regardless of payment permissions", () => {
    expect(checkCanGrantPermissions(manager)).not.toBeNull();
    expect(checkCanGrantPermissions({ ...base, role: "admin" })).toBeNull();
  });

  it("an admin role alone does not grant policy management", () => {
    expect(checkCanManagePolicies({ ...base, role: "admin" })).not.toBeNull();
  });

  it("allows authorizing up to the actor's own approval limit, not beyond", () => {
    expect(checkCanAuthorize(manager, 100_000)).toBeNull();
    expect(checkCanAuthorize(manager, 100_001)).toContain("límite");
  });

  it("requires approval permission to authorize, even for policy managers", () => {
    const noApprove: PolicyActor = { ...base, permission: { canApprove: false, approvalLimitMinor: null, canManagePolicies: true } };
    expect(checkCanAuthorize(noApprove, 1)).not.toBeNull();
  });
});
