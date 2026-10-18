import { describe, expect, it } from "vitest";
import { evaluateFlow, toContractMatch, type FlowInvoiceFacts } from "./evaluate";
import { validateFlow } from "./validate";
import type { ContractFlowGraph } from "./schema";

const pos = { x: 0, y: 0 };
const edge = (id: string, source: string, target: string, sourceHandle: "default" | "true" | "false" = "default") =>
  ({ id, source, target, sourceHandle }) as const;

// Equivale a un contrato plano: Inicio → Monto fijo → Cuenta → Fin.
function linear(over: { toleranceBps?: number } = {}): ContractFlowGraph {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "s", type: "start", position: pos, data: { frequency: "monthly", validFrom: "2026-01-01", validTo: "2026-12-31" } },
      { id: "a", type: "amount", position: pos, data: { mode: "fixed", currency: "USD", amountMinor: 150_000, toleranceBps: over.toleranceBps ?? 0 } },
      { id: "b", type: "beneficiary", position: pos, data: { accountRef: "ACC-1" } },
      { id: "e", type: "end", position: pos, data: { outcome: "expect_payment" } },
    ],
    edges: [edge("1", "s", "a"), edge("2", "a", "b"), edge("3", "b", "e")],
  };
}

const facts = (over: Partial<FlowInvoiceFacts> = {}): FlowInvoiceFacts => ({
  amountMinor: 150_000,
  currency: "USD",
  invoiceDate: "2026-06-01",
  dueDate: null,
  beneficiaryAccountReference: "ACC-1",
  deliveredMilestones: null,
  ...over,
});

describe("validateFlow", () => {
  it("acepta el grafo lineal", () => {
    expect(validateFlow(linear()).ok).toBe(true);
  });

  it("rechaza ciclos", () => {
    const g = linear();
    g.edges.push(edge("4", "b", "a")); // b ya tiene una salida
    g.edges = g.edges.filter((e) => e.id !== "3");
    expect(validateFlow(g).errors.map((e) => e.code)).toContain("CYCLE");
  });

  it("rechaza nodos huérfanos, dos inicios, condición sin rama y campos extra", () => {
    const orphan = linear();
    orphan.nodes.push({ id: "x", type: "end", position: pos, data: { outcome: "block" } });
    expect(validateFlow(orphan).errors.map((e) => e.code)).toContain("UNREACHABLE");

    const twoStarts = linear();
    twoStarts.nodes.push({ id: "s2", type: "start", position: pos, data: { frequency: "monthly", validFrom: "2026-01-01", validTo: null } });
    expect(validateFlow(twoStarts).errors.map((e) => e.code)).toContain("START_COUNT");

    const cond = linear();
    cond.nodes.push({ id: "c", type: "condition", position: pos, data: { field: "amountMinor", op: "gt", value: 1 } });
    cond.edges = [edge("1", "s", "c"), edge("t", "c", "a", "true"), edge("2", "a", "b"), edge("3", "b", "e")];
    expect(validateFlow(cond).errors.map((e) => e.code)).toContain("CONDITION_BRANCHES");

    const extra = { ...linear(), evil: "instrucciones" };
    expect(validateFlow(extra).ok).toBe(false);
  });

  it("rechaza demasiados nodos y rango invertido", () => {
    const big = linear();
    for (let i = 0; i < 60; i++) big.nodes.push({ id: `n${i}`, type: "end", position: pos, data: { outcome: "block" } });
    expect(validateFlow(big).ok).toBe(false);

    const range = linear();
    range.nodes[1] = { id: "a", type: "amount", position: pos, data: { mode: "range", currency: "USD", minMinor: 10, maxMinor: 5 } };
    expect(validateFlow(range).errors.map((e) => e.code)).toContain("RANGE");
  });
});

describe("evaluateFlow", () => {
  const run = (g: ContractFlowGraph, f: FlowInvoiceFacts) => evaluateFlow(validated(g), f);
  const validated = (g: ContractFlowGraph) => {
    const v = validateFlow(g);
    if (!v.ok) throw new Error(JSON.stringify(v.errors));
    return v.graph;
  };

  it("coincide cuando todo cumple", () => {
    expect(run(linear(), facts()).status).toBe("matched");
  });

  it("monto distinto con tolerancia 0 → mismatch; dentro de la tolerancia → matched", () => {
    expect(run(linear(), facts({ amountMinor: 150_001 })).status).toBe("mismatch");
    expect(run(linear({ toleranceBps: 100 }), facts({ amountMinor: 151_500 })).status).toBe("matched"); // borde exacto 1 %
    expect(run(linear({ toleranceBps: 100 }), facts({ amountMinor: 151_501 })).status).toBe("mismatch");
  });

  it("moneda distinta, monto o cuenta desconocidos y cuenta cambiada escalan", () => {
    expect(run(linear(), facts({ currency: "EUR" })).discrepancies[0].field).toBe("currency");
    expect(run(linear(), facts({ amountMinor: null })).status).toBe("mismatch");
    expect(run(linear(), facts({ beneficiaryAccountReference: "ACC-9" })).discrepancies[0].field).toBe("beneficiary_account");
    expect(run(linear(), facts({ beneficiaryAccountReference: null })).status).toBe("ambiguous");
  });

  it("factura fuera de vigencia o sin fecha", () => {
    expect(run(linear(), facts({ invoiceDate: "2027-02-01" })).discrepancies[0].field).toBe("period");
    expect(run(linear(), facts({ invoiceDate: null })).status).toBe("ambiguous");
  });

  it("tope: sobre el máximo falla", () => {
    const g = linear();
    g.nodes[1] = { id: "a", type: "amount", position: pos, data: { mode: "cap", currency: "USD", maxMinor: 100_000 } };
    expect(run(g, facts()).status).toBe("mismatch");
    expect(run(g, facts({ amountMinor: 100_000 })).status).toBe("matched");
  });

  it("hito sin evidencia → ambiguo; con evidencia → matched", () => {
    const g = linear();
    g.nodes.push({ id: "m", type: "milestone", position: pos, data: { label: "Entrega", requiresEvidence: true } });
    g.edges = [edge("1", "s", "a"), edge("2", "a", "b"), edge("3", "b", "m"), edge("4", "m", "e")];
    expect(run(g, facts()).status).toBe("ambiguous");
    expect(run(g, facts({ deliveredMilestones: ["Entrega"] })).status).toBe("matched");
  });

  it("condición ramifica y end.block nunca coincide", () => {
    const g = linear();
    g.nodes.push(
      { id: "c", type: "condition", position: pos, data: { field: "amountMinor", op: "gt", value: 1_000_000 } },
      { id: "blk", type: "end", position: pos, data: { outcome: "block" } },
    );
    g.edges = [edge("1", "s", "c"), edge("t", "c", "blk", "true"), edge("f", "c", "a", "false"), edge("2", "a", "b"), edge("3", "b", "e")];
    expect(run(g, facts()).status).toBe("matched");
    expect(run(g, facts({ amountMinor: 2_000_000 })).status).toBe("mismatch");
    expect(run(g, facts({ amountMinor: null })).status).toBe("ambiguous");
  });

  it("plazo de pago", () => {
    const g = linear();
    g.nodes.push({ id: "p", type: "paymentTerms", position: pos, data: { netDays: 30 } });
    g.edges = [edge("1", "s", "a"), edge("2", "a", "b"), edge("3", "b", "p"), edge("4", "p", "e")];
    expect(run(g, facts({ dueDate: "2026-07-01" })).status).toBe("matched");
    expect(run(g, facts({ dueDate: "2026-07-05" })).status).toBe("mismatch");
  });
});

describe("toContractMatch", () => {
  it("publica un ContractMatch válido y nunca autoriza", () => {
    const g = validateFlow(linear());
    if (!g.ok) throw new Error("grafo inválido");
    const match = toContractMatch(g.graph, { contractId: "c1", version: 2 }, evaluateFlow(g.graph, facts()));
    expect(match).toMatchObject({ contractId: "c1", matchStatus: "matched", agreedAmountMinor: 150_000, frequency: "monthly" });
    expect(match.evidence[0].evidenceId).toBe("contract:c1");
  });
});
