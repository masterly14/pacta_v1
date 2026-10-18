/**
 * Purpose: puente entre el grafo del contrato (ContractFlowGraph) y los nodos/aristas de
 *   @xyflow/react: metadatos de cada tipo, datos por defecto, resúmenes y conversiones.
 * Runs in: browser y servidor (sin APIs del navegador); puro.
 * Triggered by: el editor, el visor y sus nodos.
 * Receives → Returns: ContractFlowGraph ↔ { nodes, edges } de React Flow; tipo → datos iniciales.
 * Talks to: ../../flow/schema.ts, ../../money.ts.
 */
import type { Edge, Node } from "@xyflow/react";
import type { ContractFlowGraph, FlowNode, FlowNodeType } from "../../flow/schema";
import { formatMinor } from "../../money";

export type NodeStatus = "idle" | "pass" | "fail" | "unknown";

// `payload` es el `data` del nodo del grafo; lo demás es solo presentación (no se guarda).
export type RfNodeData = {
  payload: FlowNode["data"];
  status: NodeStatus;
  issue: string | null;
  [key: string]: unknown;
};
export type RfNode = Node<RfNodeData>;

export const NODE_ORDER: FlowNodeType[] = ["start", "amount", "beneficiary", "condition", "milestone", "paymentTerms", "end"];

export const NODE_META: Record<FlowNodeType, { label: string; description: string }> = {
  start: { label: "Inicio y vigencia", description: "Frecuencia y periodo en que aplica el contrato." },
  amount: { label: "Monto", description: "Monto fijo, rango o tope por factura." },
  beneficiary: { label: "Cuenta beneficiaria", description: "Cuenta a la que debe pedirse el pago." },
  condition: { label: "Condición", description: "Bifurca el flujo según el monto o la moneda." },
  milestone: { label: "Hito de entrega", description: "Exige evidencia de que se cumplió una entrega." },
  paymentTerms: { label: "Plazo de pago", description: "Días entre la factura y el vencimiento." },
  end: { label: "Fin", description: "Resultado esperado al llegar aquí." },
};

export const FREQUENCY_LABEL = {
  one_time: "pago único",
  weekly: "semanal",
  monthly: "mensual",
  quarterly: "trimestral",
  yearly: "anual",
} as const;

export const END_LABEL = {
  expect_payment: "Se espera el pago",
  escalate: "Escalar a revisión humana",
  block: "Bloquear",
} as const;

const OP_LABEL = { eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤" } as const;
export const OP_OPTIONS = Object.entries(OP_LABEL) as [keyof typeof OP_LABEL, string][];

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultData(type: FlowNodeType, ctx: { currency: string; today: string }): FlowNode["data"] {
  switch (type) {
    case "start":
      return { frequency: "monthly", validFrom: ctx.today, validTo: null };
    case "amount":
      return { mode: "fixed", currency: ctx.currency, amountMinor: 100, toleranceBps: 0 };
    case "beneficiary":
      return { accountRef: "****0000" };
    case "condition":
      return { field: "amountMinor", op: "gt", value: 100_000 };
    case "milestone":
      return { label: "Entrega", requiresEvidence: true };
    case "paymentTerms":
      return { netDays: 30 };
    case "end":
      return { outcome: "expect_payment" };
  }
}

// Línea corta con lo esencial del nodo, para mostrar en el canvas.
type NodeBody<N = FlowNode> = N extends FlowNode ? { type: N["type"]; data: N["data"] } : never;

export function nodeSummary(node: NodeBody): string {
  switch (node.type) {
    case "start":
      return `${FREQUENCY_LABEL[node.data.frequency]} · ${node.data.validFrom} → ${node.data.validTo ?? "sin fin"}`;
    case "amount": {
      const d = node.data;
      if (d.mode === "fixed") {
        const tol = d.toleranceBps > 0 ? ` ±${d.toleranceBps / 100}%` : " exacto";
        return `${formatMinor(d.amountMinor, d.currency)}${tol}`;
      }
      if (d.mode === "range") return `${formatMinor(d.minMinor, d.currency)} a ${formatMinor(d.maxMinor, d.currency)}`;
      return `hasta ${formatMinor(d.maxMinor, d.currency)}`;
    }
    case "beneficiary":
      return node.data.accountRef;
    case "condition": {
      const d = node.data;
      const value = d.field === "amountMinor" ? String(d.value) : d.value;
      return `${d.field === "amountMinor" ? "monto (unid. menores)" : "moneda"} ${OP_LABEL[d.op]} ${value}`;
    }
    case "milestone":
      return `${node.data.label}${node.data.requiresEvidence ? " · con evidencia" : ""}`;
    case "paymentTerms":
      return `${node.data.netDays} días`;
    case "end":
      return END_LABEL[node.data.outcome];
  }
}

export function toRf(graph: ContractFlowGraph): { nodes: RfNode[]; edges: Edge[] } {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { payload: n.data, status: "idle", issue: null },
    })),
    edges: graph.edges.map(toRfEdge),
  };
}

export function toRfEdge(e: { id: string; source: string; target: string; sourceHandle: "default" | "true" | "false" }): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    label: e.sourceHandle === "true" ? "Sí" : e.sourceHandle === "false" ? "No" : undefined,
  };
}

// Devuelve JSON sin validar: el validador (cliente y servidor) decide si es un grafo correcto.
export function toGraphJson(nodes: RfNode[], edges: Edge[]): unknown {
  return {
    schemaVersion: 1,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      data: n.data.payload,
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? "default" })),
  };
}
