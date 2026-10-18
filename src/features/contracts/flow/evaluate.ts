/**
 * Purpose: evaluar una factura contra el grafo de un contrato y describir el resultado como
 *   ContractMatch. Evidencia únicamente: un flujo cumplido jamás autoriza un pago.
 * Runs in: servidor, cliente (simulador) y tests; puro, sin DB, reloj, red ni IA.
 * Triggered by: findContractMatch (versión activa) y el panel "Probar" del editor.
 * Receives → Returns: (ContractFlowGraph validado, FlowInvoiceFacts) → FlowEvaluation;
 *   toContractMatch(...) lo convierte al contrato compartido, validado con Zod (falla cerrado).
 * Talks to: ./schema.ts, ../money.ts, src/shared/schemas/invoice-context.ts.
 */
import {
  ContractMatchSchema,
  type ContractMatch,
} from "@/shared/schemas/invoice-context";
import { formatMinor } from "../money";
import type { ContractFlowGraph, FlowNode } from "./schema";

export type FlowInvoiceFacts = {
  amountMinor: number | null;
  currency: string | null;
  invoiceDate: string | null; // YYYY-MM-DD
  dueDate: string | null; // YYYY-MM-DD
  beneficiaryAccountReference: string | null;
  // Hitos con evidencia de entrega confirmada; null = no se sabe.
  deliveredMilestones: string[] | null;
};

type Discrepancy = ContractMatch["discrepancies"][number];
export type NodeResult = "pass" | "fail" | "unknown";
export type TraceStep = { nodeId: string; type: FlowNode["type"]; result: NodeResult; note: string };
export type FlowEvaluation = {
  status: "matched" | "mismatch" | "ambiguous";
  discrepancies: Discrepancy[];
  trace: TraceStep[];
};

export function evaluateFlow(graph: ContractFlowGraph, facts: FlowInvoiceFacts): FlowEvaluation {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const start = graph.nodes.find((n) => n.type === "start");
  const trace: TraceStep[] = [];
  const discrepancies: Discrepancy[] = [];
  if (!start) {
    return { status: "ambiguous", discrepancies, trace };
  }

  let current: FlowNode | undefined = start;
  // Tope de pasos: defensa si llega un grafo sin validar.
  for (let steps = 0; current && steps <= graph.nodes.length; steps++) {
    const node: FlowNode = current;
    const step = evalNode(node, facts);
    trace.push({ nodeId: node.id, type: node.type, result: step.result, note: step.note });
    if (step.discrepancy) discrepancies.push(step.discrepancy);

    // Sin dato para ramificar no se sigue: el resultado queda ambiguo.
    if (node.type === "condition" && step.result === "unknown") break;
    if (node.type === "end") break;

    const handle = step.branch ?? "default";
    const next: { target: string } | undefined = graph.edges.find((e) => e.source === node.id && e.sourceHandle === handle);
    current = next ? byId.get(next.target) : undefined;
    if (!next) {
      trace.push({ nodeId: node.id, type: node.type, result: "unknown", note: "El flujo no continúa desde este nodo." });
    }
  }

  const failed = trace.some((t) => t.result === "fail");
  const unknown = trace.some((t) => t.result === "unknown");
  return { status: failed ? "mismatch" : unknown ? "ambiguous" : "matched", discrepancies, trace };
}

type NodeStep = { result: NodeResult; note: string; discrepancy?: Discrepancy; branch?: "true" | "false" };

function evalNode(node: FlowNode, f: FlowInvoiceFacts): NodeStep {
  switch (node.type) {
    case "start": {
      const { validFrom, validTo } = node.data;
      if (f.invoiceDate === null) return { result: "unknown", note: "Se desconoce la fecha de la factura." };
      if (f.invoiceDate >= validFrom && (validTo === null || f.invoiceDate <= validTo)) {
        return { result: "pass", note: "La factura está dentro de la vigencia." };
      }
      const expected = `${validFrom} a ${validTo ?? "sin fin"}`;
      return fail("period", expected, f.invoiceDate, `La fecha de la factura ${f.invoiceDate} está fuera de la vigencia del contrato.`);
    }
    case "amount":
      return evalAmount(node.data, f);
    case "beneficiary": {
      const agreed = node.data.accountRef;
      const actual = f.beneficiaryAccountReference;
      if (actual === null) return { result: "unknown", note: "La factura no indica cuenta de pago." };
      if (actual === agreed) return { result: "pass", note: "La cuenta coincide con la pactada." };
      return fail("beneficiary_account", agreed, actual, `La factura pide el pago a ${actual}; el contrato indica ${agreed}.`);
    }
    case "condition": {
      const d = node.data;
      const value = d.field === "amountMinor" ? f.amountMinor : f.currency;
      if (value === null) return { result: "unknown", note: `Se desconoce ${d.field}.` };
      // Ramificar no es incumplir: el resultado es "pass" y la rama elegida decide el camino.
      const yes = compare(value, d.op, d.value);
      return { result: "pass", branch: yes ? "true" : "false", note: `Condición sobre ${d.field}: ${yes ? "sí" : "no"}.` };
    }
    case "milestone": {
      if (!node.data.requiresEvidence) return { result: "pass", note: "Hito sin evidencia requerida." };
      if (f.deliveredMilestones?.includes(node.data.label)) return { result: "pass", note: "Hito con evidencia." };
      return { result: "unknown", note: `Falta evidencia del hito "${node.data.label}".` };
    }
    case "paymentTerms": {
      if (f.invoiceDate === null || f.dueDate === null) {
        return { result: "unknown", note: "Faltan fechas para verificar el plazo de pago." };
      }
      const expected = addDays(f.invoiceDate, node.data.netDays);
      if (f.dueDate === expected) return { result: "pass", note: "El vencimiento respeta el plazo." };
      return fail("other", expected, f.dueDate, `El vencimiento ${f.dueDate} no coincide con el plazo pactado (${node.data.netDays} días: ${expected}).`);
    }
    case "end":
      // block/escalate: el contrato pide revisión humana; no es una aprobación ni un rechazo.
      return node.data.outcome === "expect_payment"
        ? { result: "pass", note: "Fin del flujo: se espera el pago." }
        : fail("other", node.data.outcome, null, node.data.outcome === "block" ? "El flujo del contrato bloquea este caso." : "El flujo del contrato exige revisión humana en este caso.");
  }
}

function evalAmount(d: Extract<FlowNode, { type: "amount" }>["data"], f: FlowInvoiceFacts): NodeStep {
  if (f.currency !== d.currency) {
    return fail("currency", d.currency, f.currency,
      f.currency === null
        ? `Se desconoce la moneda de la factura; el contrato está en ${d.currency}.`
        : `La factura está en ${f.currency}; el contrato está en ${d.currency}.`);
  }
  const target = d.mode === "fixed" ? d.amountMinor : d.maxMinor;
  const expected = d.mode === "range" ? `${formatMinor(d.minMinor, d.currency)} a ${formatMinor(d.maxMinor, d.currency)}`
    : d.mode === "cap" ? `hasta ${formatMinor(d.maxMinor, d.currency)}` : formatMinor(target, d.currency);
  if (f.amountMinor === null) {
    return fail("amount", expected, null, `Se desconoce el monto de la factura; el contrato acuerda ${expected}.`);
  }
  const a = BigInt(f.amountMinor);
  let ok: boolean;
  if (d.mode === "fixed") {
    // |a - target| * 10000 <= target * bps, todo en enteros.
    const diff = a > BigInt(target) ? a - BigInt(target) : BigInt(target) - a;
    ok = diff * BigInt(10_000) <= BigInt(target) * BigInt(d.toleranceBps);
  } else if (d.mode === "range") {
    ok = a >= BigInt(d.minMinor) && a <= BigInt(d.maxMinor);
  } else {
    ok = a <= BigInt(d.maxMinor);
  }
  if (ok) return { result: "pass", note: "El monto está dentro de lo pactado." };
  const actual = formatMinor(f.amountMinor, d.currency);
  return fail("amount", expected, actual, `El monto de la factura ${actual} difiere de lo acordado (${expected}).`);
}

function fail(field: Discrepancy["field"], expected: string | null, actual: string | null, description: string): NodeStep {
  return { result: "fail", note: description, discrepancy: { field, expected, actual, description } };
}

function compare(a: number | string, op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte", b: number | string): boolean {
  switch (op) {
    case "eq": return a === b;
    case "neq": return a !== b;
    case "gt": return a > b;
    case "gte": return a >= b;
    case "lt": return a < b;
    case "lte": return a <= b;
  }
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Datos de la versión activa que ContractMatch necesita.
export type FlowContractRef = { contractId: string; version: number };

export function toContractMatch(graph: ContractFlowGraph, ref: FlowContractRef, evaluation: FlowEvaluation): ContractMatch {
  const start = graph.nodes.find((n) => n.type === "start");
  const amount = graph.nodes.find((n) => n.type === "amount");
  const fixed = amount?.type === "amount" && amount.data.mode === "fixed" ? amount.data : null;
  return ContractMatchSchema.parse({
    contractId: ref.contractId,
    matchStatus: evaluation.status,
    agreedAmountMinor: fixed?.amountMinor ?? null,
    currency: amount?.type === "amount" ? amount.data.currency : null,
    frequency: start?.type === "start" ? start.data.frequency : null,
    validFrom: start?.type === "start" ? start.data.validFrom : null,
    validTo: start?.type === "start" ? start.data.validTo : null,
    discrepancies: evaluation.discrepancies,
    evidence: [
      {
        evidenceId: `contract:${ref.contractId}`,
        sourceType: "manual_entry",
        documentId: null,
        field: "contractMatch",
        page: null,
        excerpt: `Contract ${ref.contractId} flow v${ref.version}`,
      },
    ],
  });
}
