/**
 * Purpose: integration tests for the policies database layer against a real PostgreSQL:
 *   permission enforcement, organization scoping, versioning, revocation, audit and demo data.
 * Runs in: Vitest, only when TEST_DATABASE_URL points at a disposable database with all
 *   migrations applied (skipped otherwise, so `npm test` needs no database).
 * Triggered by: `TEST_DATABASE_URL=… npx vitest run src/features/policies/server.integration.test.ts`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: ./server.ts with `@/lib/db` replaced by a PrismaClient on TEST_DATABASE_URL.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PolicyActor } from "./permissions";

const url = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return { db: new Client({ datasourceUrl: process.env.TEST_DATABASE_URL }) };
});

describe.skipIf(!url)("policies server (integration)", async () => {
  const server = await import("./server");
  const prisma = new PrismaClient({ datasourceUrl: url });

  const ORG = "org_test_a";
  const OTHER_ORG = "org_test_b";
  const admin: PolicyActor = { userId: "user_admin", organizationId: ORG, role: "admin", permission: null };
  const member: PolicyActor = { userId: "user_member", organizationId: ORG, role: "member", permission: null };

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE audit_events, payment_decisions, approval_requests, payment_authorizations, payment_policies,
       bank_transactions, bank_import_batches, suppliers, approval_permissions, organization_memberships,
       users, organizations CASCADE`,
    );
    await prisma.organization.createMany({ data: [{ id: ORG, name: "A" }, { id: OTHER_ORG, name: "B" }] });
    await prisma.user.createMany({
      data: [
        { id: "user_admin", email: "admin@demo.test" },
        { id: "user_member", email: "member@demo.test" },
        { id: "user_outsider", email: "out@demo.test" },
      ],
    });
    await prisma.organizationMembership.createMany({
      data: [
        { userId: "user_admin", organizationId: ORG, role: "admin" },
        { userId: "user_member", organizationId: ORG, role: "member" },
        { userId: "user_outsider", organizationId: OTHER_ORG, role: "admin" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function adminWithDemo(): Promise<PolicyActor> {
    await server.loadDemoData(admin, "2026-10-17");
    return server.loadPolicyActor({
      user: { id: admin.userId } as never,
      organization: { id: ORG } as never,
      membership: { role: "admin" } as never,
    });
  }

  it("bootstraps the admin with demo data, idempotently", async () => {
    const actor = await adminWithDemo();
    expect(actor.permission).toEqual({ canApprove: true, approvalLimitMinor: 1_000_000, canManagePolicies: true });
    await server.loadDemoData(admin, "2026-10-17");
    expect(await prisma.supplier.count({ where: { organizationId: ORG } })).toBe(3);
    expect(await prisma.paymentPolicy.count({ where: { organizationId: ORG } })).toBe(1);
    expect(await prisma.paymentAuthorization.count({ where: { organizationId: ORG } })).toBe(1);
  });

  it("only authorizes Papelería Central in the demo (Nube Hosting must escalate)", async () => {
    await adminWithDemo();
    const auths = await prisma.paymentAuthorization.findMany({ include: { supplier: true } });
    expect(auths.map((a) => a.supplier.name)).toEqual(["Papelería Central"]);
  });

  it("refuses demo data and permission changes from a non-admin", async () => {
    expect(await server.loadDemoData(member, "2026-10-17")).toMatchObject({ ok: false });
    const result = await server.setApprovalPermission(member, {
      userId: "user_member",
      canApprove: true,
      approvalLimitMinor: 999_999,
      canManagePolicies: true,
    });
    expect(result).toMatchObject({ ok: false });
    expect(await prisma.approvalPermission.count()).toBe(0);
  });

  it("refuses to grant permissions to someone outside the organization", async () => {
    const result = await server.setApprovalPermission(admin, {
      userId: "user_outsider",
      canApprove: true,
      approvalLimitMinor: 1000,
      canManagePolicies: false,
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("creates policy versions instead of editing, and audits them", async () => {
    const actor = await adminWithDemo();
    expect(await server.createPolicyVersion(actor, { autoApprovalLimitMinor: 50_000, monthlyBudgetMinor: 900_000 })).toMatchObject({ ok: true });
    const versions = await prisma.paymentPolicy.findMany({ where: { organizationId: ORG }, orderBy: { version: "asc" } });
    expect(versions.map((p) => [p.version, p.autoApprovalLimitMinor])).toEqual([[1, 200_000], [2, 50_000]]);
    expect(await prisma.auditEvent.count({ where: { eventType: "politica_pago.version_creada" } })).toBe(1);
  });

  it("refuses an authorization for another organization's supplier", async () => {
    const actor = await adminWithDemo();
    const foreign = await prisma.supplier.create({ data: { organizationId: OTHER_ORG, name: "Ajeno", normalizedName: "ajeno" } });
    const result = await server.createAuthorization(actor, {
      supplierId: foreign.id,
      beneficiaryAccountRef: "****0000",
      maxAmountMinor: 1000,
      scope: "one_time",
      frequency: null,
      validFrom: "2026-10-01",
      validUntil: "2026-12-31",
    });
    expect(result).toMatchObject({ ok: false, error: "Proveedor no encontrado." });
  });

  it("refuses an authorization above the actor's own approval limit", async () => {
    const actor = await adminWithDemo();
    const nube = await prisma.supplier.findFirstOrThrow({ where: { organizationId: ORG, name: "Nube Hosting LLC" } });
    const input = {
      supplierId: nube.id,
      beneficiaryAccountRef: "****1234",
      scope: "recurring" as const,
      frequency: "monthly" as const,
      validFrom: "2026-10-01",
      validUntil: "2027-09-30",
    };
    expect(await server.createAuthorization(actor, { ...input, maxAmountMinor: 1_000_001 })).toMatchObject({ ok: false });
    expect(await server.createAuthorization(actor, { ...input, maxAmountMinor: 160_000 })).toMatchObject({ ok: true });
    const created = await prisma.paymentAuthorization.findFirstOrThrow({ where: { supplierId: nube.id } });
    expect(created).toMatchObject({ authorizedBy: "user_admin", status: "active", maxAmountMinor: 160_000 });
  });

  it("revokes only active authorizations of the actor's organization", async () => {
    const actor = await adminWithDemo();
    const auth = await prisma.paymentAuthorization.findFirstOrThrow({ where: { organizationId: ORG } });
    const outsider: PolicyActor = { ...actor, organizationId: OTHER_ORG };
    expect(await server.revokeAuthorization(outsider, auth.id)).toMatchObject({ ok: false });
    expect(await server.revokeAuthorization(actor, auth.id)).toMatchObject({ ok: true });
    expect(await server.revokeAuthorization(actor, auth.id)).toMatchObject({ ok: false });
    expect(await prisma.paymentAuthorization.findUniqueOrThrow({ where: { id: auth.id } })).toMatchObject({
      status: "revoked",
      revokedBy: "user_admin",
    });
  });

  it("rejects a duplicate supplier name after normalization", async () => {
    const actor = await adminWithDemo();
    expect(await server.createSupplier(actor, { name: "NUBE-HOSTING, llc.", beneficiaryAccountRef: null })).toMatchObject({
      ok: false,
      error: "Ya existe un proveedor con ese nombre.",
    });
  });

  it("scopes the overview to the organization", async () => {
    await adminWithDemo();
    await prisma.supplier.create({ data: { organizationId: OTHER_ORG, name: "Ajeno", normalizedName: "ajeno" } });
    const overview = await server.getPoliciesOverview(ORG);
    expect(overview.suppliers.map((s) => s.name)).not.toContain("Ajeno");
    expect(overview.members.map((m) => m.userId).sort()).toEqual(["user_admin", "user_member"]);
  });
});
