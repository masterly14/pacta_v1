/**
 * Purpose: pruebas de integración del flujo de contratos contra PostgreSQL real: borrador,
 *   activación, congelado por trigger, índice de una sola activa, concurrencia y aislamiento por org.
 * Runs in: Vitest, solo con TEST_DATABASE_URL apuntando a una BD desechable con todas las
 *   migraciones aplicadas (se omite si no, para que `npm test` no necesite base de datos).
 * Triggered by: `TEST_DATABASE_URL=… npx vitest run src/features/contracts/flow/server.integration.test.ts`.
 * Receives → Returns: nada; pasa o falla.
 * Talks to: ./server.ts y ../server.ts con `@/lib/db` reemplazado por un PrismaClient de prueba.
 */
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { templateGraph } from "./template";

const url = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return { db: new Client({ datasourceUrl: process.env.TEST_DATABASE_URL }) };
});

describe.skipIf(!url)("contract flow (integration)", async () => {
  const flow = await import("./server");
  const contracts = await import("../server");
  const prisma = new PrismaClient({ datasourceUrl: url });

  const ORG = "org_flow_a";
  const OTHER = "org_flow_b";
  const SUP = "sup_flow";
  const admin = { userId: "u_admin", organizationId: ORG, role: "admin" as const };
  const member = { userId: "u_member", organizationId: ORG, role: "member" as const };
  const otherAdmin = { userId: "u_other", organizationId: OTHER, role: "admin" as const };

  const terms = { frequency: "monthly" as const, validFrom: "2026-01-01", validTo: "2026-12-31", currency: "USD", agreedAmountMinor: 150_000, beneficiaryAccountRef: "ACC-1" };

  async function newContract() {
    const r = await contracts.createContract(admin, { supplierId: SUP, ...terms, description: null });
    if (!r.ok) throw new Error(r.error);
    return r.contractId;
  }
  const graphWith = (amountMinor: number) => templateGraph({ ...terms, agreedAmountMinor: amountMinor });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE audit_events, contract_flow_versions, contracts, suppliers, organization_memberships, users, organizations CASCADE`,
    );
    await prisma.organization.createMany({ data: [{ id: ORG, name: "A" }, { id: OTHER, name: "B" }] });
    await prisma.supplier.create({ data: { id: SUP, organizationId: ORG, name: "Nube", normalizedName: "nube" } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("createContract deja la versión 1 activa con su hash y su auditoría", async () => {
    const id = await newContract();
    const rows = await prisma.contractFlowVersion.findMany({ where: { contractId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 1, status: "active", organizationId: ORG });
    expect(await prisma.auditEvent.count({ where: { entityType: "contract_flow", eventType: "flow.activated" } })).toBe(1);
  });

  it("guarda un borrador, lo activa y reemplaza la versión anterior", async () => {
    const id = await newContract();
    const saved = await flow.saveFlowDraft(admin, id, graphWith(200_000), null);
    expect(saved).toMatchObject({ ok: true, version: 2 });
    if (!saved.ok) return;

    const activated = await flow.activateFlow(admin, id, saved.graphSha256);
    expect(activated.ok).toBe(true);
    const versions = await prisma.contractFlowVersion.findMany({ where: { contractId: id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => v.status)).toEqual(["superseded", "active"]);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id } })).agreedAmountMinor).toBe(200_000);
  });

  it("rechaza guardar sobre un borrador que cambió (hash base distinto) y activar con hash viejo", async () => {
    const id = await newContract();
    const first = await flow.saveFlowDraft(admin, id, graphWith(200_000), null);
    if (!first.ok) throw new Error("no guardó");
    expect(await flow.saveFlowDraft(admin, id, graphWith(300_000), null)).toMatchObject({ ok: false, reason: "conflict" });
    const second = await flow.saveFlowDraft(admin, id, graphWith(300_000), first.graphSha256);
    expect(second.ok).toBe(true);
    expect(await flow.activateFlow(admin, id, first.graphSha256)).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("solo un admin de la organización puede guardar o activar; otra org no ve el contrato", async () => {
    const id = await newContract();
    expect(await flow.saveFlowDraft(member, id, graphWith(1), null)).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await flow.saveFlowDraft(otherAdmin, id, graphWith(1), null)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await flow.getContractFlow(OTHER, id)).toBeNull();
  });

  it("rechaza grafos inválidos y no guarda nada", async () => {
    const id = await newContract();
    const bad = { ...graphWith(1), edges: [] };
    expect(await flow.saveFlowDraft(admin, id, bad, null)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await prisma.contractFlowVersion.count({ where: { contractId: id } })).toBe(1);
  });

  it("dos activaciones simultáneas dejan una sola versión activa", async () => {
    const id = await newContract();
    const saved = await flow.saveFlowDraft(admin, id, graphWith(200_000), null);
    if (!saved.ok) throw new Error("no guardó");
    const results = await Promise.all([flow.activateFlow(admin, id, saved.graphSha256), flow.activateFlow(admin, id, saved.graphSha256)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.contractFlowVersion.count({ where: { contractId: id, status: "active" } })).toBe(1);
  });

  it("una versión activa es inmutable y no se borra (trigger)", async () => {
    const id = await newContract();
    const active = await prisma.contractFlowVersion.findFirstOrThrow({ where: { contractId: id, status: "active" } });
    await expect(prisma.contractFlowVersion.update({ where: { id: active.id }, data: { graph: { schemaVersion: 1, nodes: [], edges: [] } } })).rejects.toThrow();
    await expect(prisma.contractFlowVersion.update({ where: { id: active.id }, data: { status: "draft" } })).rejects.toThrow();
    await expect(prisma.contractFlowVersion.delete({ where: { id: active.id } })).rejects.toThrow();
  });

  it("terminar el contrato reemplaza el flujo activo y descarta el borrador", async () => {
    const id = await newContract();
    await flow.saveFlowDraft(admin, id, graphWith(200_000), null);
    expect((await contracts.terminateContract(admin, id)).ok).toBe(true);
    const statuses = (await prisma.contractFlowVersion.findMany({ where: { contractId: id } })).map((v) => v.status);
    expect(statuses).toEqual(["superseded"]);
  });
});
