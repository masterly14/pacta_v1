import { describe, expect, it } from "vitest";
import type { PolicyActor } from "../../policies/permissions";
import type { SupplierAssociationAuditEvent } from "../schemas/supplier-association";
import {
  associateTransactions,
  confirmSuggestion,
  type AssociationContext,
  type SupplierAssociationStore,
  type SupplierRow,
} from "./association-service";
import type { MatchTransaction } from "./supplier-matching";

// Almacén en memoria que cumple el puerto. No tiene ningún método de autorizaciones: por construcción
// el servicio no puede crear ni tocar una PaymentAuthorization.
type FakeTxn = MatchTransaction & { organizationId: string; importBatchId: string };

function createFakeStore(seed: { transactions: FakeTxn[]; suppliers?: (SupplierRow & { organizationId: string })[] }) {
  const state = {
    transactions: seed.transactions.map((transaction) => ({ ...transaction })),
    suppliers: (seed.suppliers ?? []).map((supplier) => ({ ...supplier })),
    audit: [] as (SupplierAssociationAuditEvent & { organizationId: string })[],
    nextId: 1,
    truncate: false,
    forceExistingOnCreate: false,
  };

  const store: SupplierAssociationStore = {
    async withTransaction(work) {
      return work(store);
    },
    async listUnlinkedTransactions(organizationId, filter) {
      const rows = state.transactions.filter(
        (transaction) =>
          transaction.organizationId === organizationId &&
          transaction.supplierId === null &&
          (!filter.importBatchId || transaction.importBatchId === filter.importBatchId),
      );
      return { transactions: rows.map((row) => ({ ...row })), truncated: state.truncate };
    },
    async listSuppliers(organizationId) {
      return state.suppliers.filter((supplier) => supplier.organizationId === organizationId);
    },
    async findSupplier(organizationId, supplierId) {
      return state.suppliers.find((supplier) => supplier.organizationId === organizationId && supplier.id === supplierId) ?? null;
    },
    async createSupplier(organizationId, input) {
      const existing = state.suppliers.find(
        (supplier) => supplier.organizationId === organizationId && supplier.normalizedName === input.normalizedName,
      );
      if (existing) return { supplier: existing, created: false };
      if (state.forceExistingOnCreate) {
        const raced = { id: `sup_race`, name: input.name, normalizedName: input.normalizedName, organizationId };
        state.suppliers.push(raced);
        return { supplier: raced, created: false };
      }
      const created = { id: `sup_new_${state.nextId++}`, name: input.name, normalizedName: input.normalizedName, organizationId };
      state.suppliers.push(created);
      return { supplier: created, created: true };
    },
    async linkTransactions(organizationId, supplierId, transactionIds) {
      let count = 0;
      for (const transaction of state.transactions) {
        if (transaction.organizationId === organizationId && transaction.supplierId === null && transactionIds.includes(transaction.id)) {
          transaction.supplierId = supplierId;
          count++;
        }
      }
      return count;
    },
    async appendAuditEvents(organizationId, events) {
      for (const event of events) state.audit.push({ ...event, organizationId });
    },
  };
  return { store, state };
}

let counter = 0;
function txn(description: string, overrides: Partial<FakeTxn> = {}): FakeTxn {
  counter += 1;
  return {
    id: `t${String(counter).padStart(3, "0")}`,
    organizationId: "org_a",
    importBatchId: "batch_1",
    postedOn: "2026-01-15",
    amountMinor: -2000,
    supplierId: null,
    description,
    ...overrides,
  };
}

const hosting = { id: "sup_hosting", name: "Hosting Demo Inc", normalizedName: "hosting demo inc", organizationId: "org_a" };

function actor(overrides: Partial<PolicyActor> = {}): PolicyActor {
  return {
    userId: "user_admin",
    organizationId: "org_a",
    role: "admin",
    permission: { canApprove: false, approvalLimitMinor: null, canManagePolicies: true },
    ...overrides,
  };
}

const system: AssociationContext = { organizationId: "org_a", actor: null };
const asAdmin: AssociationContext = { organizationId: "org_a", actor: actor() };

describe("associateTransactions", () => {
  it("sin autoCreate vincula solo exactos y deja el resto como sugerencia; no crea proveedores", async () => {
    const { store, state } = createFakeStore({
      transactions: [txn("HOSTING DEMO"), txn("NUEVO PROVEEDOR"), txn("NUEVO PROVEEDOR")],
      suppliers: [hosting],
    });
    const result = await associateTransactions(store, system, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.linked.length).toBe(1);
    expect(result.report.created.length).toBe(0);
    expect(result.report.suggestions.length).toBe(1);
    expect(state.suppliers.length).toBe(1);
    expect(state.transactions.filter((transaction) => transaction.supplierId !== null).length).toBe(1);
    expect(state.audit.length).toBe(1);
    expect(state.audit[0].eventType).toBe("transacciones_bancarias.vinculadas");
    expect(state.audit[0].actorId).toBe(null);
  });

  it("con autoCreate crea solo los elegibles y deja auditoría con actor sistema y solicitante", async () => {
    const { store, state } = createFakeStore({
      transactions: [txn("NUEVO PROVEEDOR SAC"), txn("NUEVO PROVEEDOR SAC"), txn("UNICO COMERCIO")],
    });
    const result = await associateTransactions(store, asAdmin, { autoCreate: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.created.length).toBe(1);
    expect(result.report.created[0].name).toBe("Nuevo Proveedor");
    expect(result.report.created[0].transactionCount).toBe(2);
    expect(result.report.suggestions.length).toBe(1); // el de una sola aparición sigue como sugerencia
    expect(state.suppliers.length).toBe(1);
    expect(state.suppliers[0].normalizedName).toBe("nuevo proveedor");
    const created = state.audit.find((event) => event.eventType === "proveedor.creado_automaticamente");
    if (created?.eventType !== "proveedor.creado_automaticamente") throw new Error("falta el evento supplier.auto_created");
    expect(created.actorId).toBe(null);
    expect(created.payload.requestedBy).toBe("user_admin");
  });

  it("autoCreate exige una persona con permiso de gestionar políticas", async () => {
    const seed = { transactions: [txn("NUEVO PROVEEDOR"), txn("NUEVO PROVEEDOR")] };
    for (const context of [
      system,
      { organizationId: "org_a", actor: actor({ role: "member", permission: null }) },
      { organizationId: "org_a", actor: actor({ permission: { canApprove: true, approvalLimitMinor: 1000, canManagePolicies: false } }) },
    ]) {
      const { store, state } = createFakeStore(seed);
      const result = await associateTransactions(store, context, { autoCreate: true });
      expect(result.ok).toBe(false);
      expect(state.suppliers.length).toBe(0);
      expect(state.audit.length).toBe(0);
    }
  });

  it("rechaza un actor de otra organización", async () => {
    const { store, state } = createFakeStore({ transactions: [txn("HOSTING DEMO")], suppliers: [hosting] });
    const result = await associateTransactions(store, { organizationId: "org_a", actor: actor({ organizationId: "org_b" }) }, {});
    expect(result.ok).toBe(false);
    expect(state.audit.length).toBe(0);
  });

  it("es idempotente: la segunda ejecución no vincula, crea ni audita nada", async () => {
    const { store, state } = createFakeStore({ transactions: [txn("NUEVO PROVEEDOR"), txn("NUEVO PROVEEDOR")] });
    await associateTransactions(store, asAdmin, { autoCreate: true });
    const auditAfterFirst = state.audit.length;
    const second = await associateTransactions(store, asAdmin, { autoCreate: true });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.report.linked.length).toBe(0);
    expect(second.report.created.length).toBe(0);
    expect(state.suppliers.length).toBe(1);
    expect(state.audit.length).toBe(auditAfterFirst);
  });

  it("si otro proceso creó el proveedor primero (carrera) no lo reporta como creado, pero vincula", async () => {
    const { store, state } = createFakeStore({ transactions: [txn("NUEVO PROVEEDOR"), txn("NUEVO PROVEEDOR")] });
    state.forceExistingOnCreate = true;
    const result = await associateTransactions(store, asAdmin, { autoCreate: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.created.length).toBe(0);
    expect(result.report.linked.length).toBe(1);
    expect(state.audit.some((event) => event.eventType === "proveedor.creado_automaticamente")).toBe(false);
  });

  it("no toca movimientos ya vinculados, entradas ni de otra organización", async () => {
    const { store, state } = createFakeStore({
      transactions: [
        txn("HOSTING DEMO", { supplierId: "otro" }),
        txn("HOSTING DEMO", { amountMinor: 9000 }),
        txn("HOSTING DEMO", { organizationId: "org_b" }),
        txn("HOSTING DEMO"),
      ],
      suppliers: [hosting],
    });
    await associateTransactions(store, system, {});
    const linked = state.transactions.filter((transaction) => transaction.supplierId === "sup_hosting");
    expect(linked.length).toBe(1);
    expect(linked[0].organizationId).toBe("org_a");
    expect(linked[0].amountMinor).toBe(-2000);
  });

  it("acota por lote de importación", async () => {
    const { store, state } = createFakeStore({
      transactions: [txn("HOSTING DEMO", { importBatchId: "batch_1" }), txn("HOSTING DEMO", { importBatchId: "batch_2" })],
      suppliers: [hosting],
    });
    await associateTransactions(store, system, { importBatchId: "batch_2" });
    expect(state.transactions.map((transaction) => transaction.supplierId)).toEqual([null, "sup_hosting"]);
  });

  it("fail-closed: con datos truncados no escribe nada", async () => {
    const { store, state } = createFakeStore({ transactions: [txn("HOSTING DEMO")], suppliers: [hosting] });
    state.truncate = true;
    const result = await associateTransactions(store, system, {});
    expect(result.ok).toBe(false);
    expect(state.audit.length).toBe(0);
    expect(state.transactions[0].supplierId).toBe(null);
  });

  it("petición inválida => error", async () => {
    const { store } = createFakeStore({ transactions: [] });
    expect((await associateTransactions(store, system, { autoCreate: "sí" })).ok).toBe(false);
    expect((await associateTransactions(store, system, { extra: true })).ok).toBe(false);
  });

  it("el servicio no tiene acceso a autorizaciones de pago", () => {
    const { store } = createFakeStore({ transactions: [] });
    expect(Object.keys(store).some((method) => /authoriz/i.test(method))).toBe(false);
  });
});

describe("confirmSuggestion", () => {
  it("link_existing vincula todas las salidas de la clave al proveedor elegido y audita al usuario", async () => {
    const { store, state } = createFakeStore({
      transactions: [txn("HOSTING DEMOS"), txn("HOSTING DEMOS"), txn("HOSTING DEMOS", { amountMinor: 500 })],
      suppliers: [hosting],
    });
    const result = await confirmSuggestion(store, asAdmin, { action: "link_existing", key: "hosting demos", supplierId: "sup_hosting" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.linkedCount).toBe(2);
    expect(result.createdSupplier).toBe(false);
    expect(state.transactions[2].supplierId).toBe(null); // la entrada no se vincula
    expect(state.audit[0].actorId).toBe("user_admin");
    expect(state.audit[0].eventType).toBe("transacciones_bancarias.vinculadas");
  });

  it("create_new crea el proveedor con el nombre elegido y audita ambas cosas", async () => {
    const { store, state } = createFakeStore({ transactions: [txn("NUEVO PROVEEDOR"), txn("NUEVO PROVEEDOR")] });
    const result = await confirmSuggestion(store, asAdmin, { action: "create_new", key: "nuevo proveedor", name: "Nuevo Proveedor S.A." });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createdSupplier).toBe(true);
    expect(state.suppliers[0].normalizedName).toBe("nuevo proveedor s a");
    expect(state.audit.map((event) => event.eventType).sort()).toEqual(["transacciones_bancarias.vinculadas", "proveedor.creado_desde_banco"]);
    expect(state.audit.every((event) => event.actorId === "user_admin")).toBeTruthy();
  });

  it("rechaza un proveedor de otra organización", async () => {
    const { store, state } = createFakeStore({
      transactions: [txn("HOSTING DEMO")],
      suppliers: [{ ...hosting, id: "sup_foreign", organizationId: "org_b" }],
    });
    const result = await confirmSuggestion(store, asAdmin, { action: "link_existing", key: "hosting demo", supplierId: "sup_foreign" });
    expect(result.ok).toBe(false);
    expect(state.transactions[0].supplierId).toBe(null);
  });

  it("rechaza una clave que ya no está vigente", async () => {
    const { store } = createFakeStore({ transactions: [txn("HOSTING DEMO")], suppliers: [hosting] });
    const result = await confirmSuggestion(store, asAdmin, { action: "link_existing", key: "otra cosa", supplierId: "sup_hosting" });
    expect(result.ok).toBe(false);
  });

  it("exige persona con permiso de gestionar políticas", async () => {
    const { store, state } = createFakeStore({ transactions: [txn("HOSTING DEMO")], suppliers: [hosting] });
    const request = { action: "link_existing", key: "hosting demo", supplierId: "sup_hosting" };
    expect((await confirmSuggestion(store, system, request)).ok).toBe(false);
    expect((await confirmSuggestion(store, { organizationId: "org_a", actor: actor({ role: "member", permission: null }) }, request)).ok).toBe(false);
    expect(state.transactions[0].supplierId).toBe(null);
    expect(state.audit.length).toBe(0);
  });

  it("rechaza nombres sin letras ni números y peticiones inválidas", async () => {
    const { store } = createFakeStore({ transactions: [txn("NUEVO PROVEEDOR")] });
    expect((await confirmSuggestion(store, asAdmin, { action: "create_new", key: "nuevo proveedor", name: "***" })).ok).toBe(false);
    expect((await confirmSuggestion(store, asAdmin, { action: "authorize", key: "x" })).ok).toBe(false);
  });
});
