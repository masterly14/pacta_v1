/**
 * Purpose: construir el grafo lineal equivalente a un contrato plano (igual que el backfill SQL)
 *   y resumir un grafo en las columnas planas de Contract.
 * Runs in: servidor, cliente y tests; puro.
 * Triggered by: createContract (versión inicial), activateFlow (resumen) y el editor (plantilla).
 * Receives → Returns: términos planos → ContractFlowGraph; grafo → resumen | null.
 * Talks to: ./schema.ts.
 */
import type { ContractFlowGraph } from "./schema";

export type FlatTerms = {
  frequency: "one_time" | "weekly" | "monthly" | "quarterly" | "yearly";
  validFrom: string;
  validTo: string | null;
  currency: string;
  agreedAmountMinor: number;
  beneficiaryAccountRef: string | null;
};

export function templateGraph(t: FlatTerms): ContractFlowGraph {
  const hasAccount = t.beneficiaryAccountRef !== null;
  const at = (i: number) => ({ x: i * 260, y: 0 });
  const nodes: ContractFlowGraph["nodes"] = [
    { id: "start", type: "start", position: at(0), data: { frequency: t.frequency, validFrom: t.validFrom, validTo: t.validTo } },
    { id: "amount", type: "amount", position: at(1), data: { mode: "fixed", currency: t.currency, amountMinor: t.agreedAmountMinor, toleranceBps: 0 } },
  ];
  if (t.beneficiaryAccountRef !== null) {
    nodes.push({ id: "beneficiary", type: "beneficiary", position: at(2), data: { accountRef: t.beneficiaryAccountRef } });
  }
  nodes.push({ id: "end", type: "end", position: at(hasAccount ? 3 : 2), data: { outcome: "expect_payment" } });

  const chain = nodes.map((n) => n.id);
  const edges: ContractFlowGraph["edges"] = chain.slice(0, -1).map((source, i) => ({
    id: `e${i + 1}`,
    source,
    target: chain[i + 1],
    sourceHandle: "default",
  }));
  return { schemaVersion: 1, nodes, edges };
}

// Resumen para las columnas planas de Contract. null si el grafo no tiene exactamente
// un nodo de monto: sin resumen no se puede activar.
export function summarizeGraph(graph: ContractFlowGraph): FlatTerms | null {
  const starts = graph.nodes.filter((n) => n.type === "start");
  const amounts = graph.nodes.filter((n) => n.type === "amount");
  if (starts.length !== 1 || amounts.length !== 1) return null;
  const start = starts[0];
  const amount = amounts[0];
  if (start.type !== "start" || amount.type !== "amount") return null;
  const d = amount.data;
  const beneficiaries = graph.nodes.flatMap((n) => (n.type === "beneficiary" ? [n.data.accountRef] : []));
  return {
    frequency: start.data.frequency,
    validFrom: start.data.validFrom,
    validTo: start.data.validTo,
    currency: d.currency,
    // Monto fijo o, en rango/tope, el máximo permitido.
    agreedAmountMinor: d.mode === "fixed" ? d.amountMinor : d.maxMinor,
    beneficiaryAccountRef: beneficiaries.length === 1 ? beneficiaries[0] : null,
  };
}
