/**
 * Purpose: validar la estructura de un grafo de contrato (un solo inicio, sin ciclos, todo
 *   alcanzable, ramas completas, rangos coherentes) y devolver errores ligados a un nodo.
 * Runs in: servidor (guardar/activar) y cliente (feedback en el canvas); puro.
 * Triggered by: saveFlowDraft, activateFlow y el panel de validación del editor.
 * Receives → Returns: JSON desconocido → { ok, graph?, errors[] }; nunca lanza.
 * Talks to: ./schema.ts.
 */
import { ContractFlowGraphSchema, FLOW_LIMITS, type ContractFlowGraph } from "./schema";

export type FlowIssue = { code: string; message: string; nodeId: string | null };
export type FlowValidation =
  | { ok: true; graph: ContractFlowGraph; errors: [] }
  | { ok: false; graph: null; errors: FlowIssue[] };

export function validateFlow(input: unknown): FlowValidation {
  if (JSON.stringify(input ?? null).length > FLOW_LIMITS.maxBytes) {
    return fail([{ code: "TOO_LARGE", message: "El flujo supera el tamaño máximo permitido.", nodeId: null }]);
  }
  const parsed = ContractFlowGraphSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      parsed.error.issues.map((i) => ({
        code: "SCHEMA",
        message: `${i.path.join(".") || "flujo"}: ${i.message}`,
        nodeId: null,
      })),
    );
  }
  const errors = structuralIssues(parsed.data);
  return errors.length === 0 ? { ok: true, graph: parsed.data, errors: [] } : fail(errors);
}

function fail(errors: FlowIssue[]): FlowValidation {
  return { ok: false, graph: null, errors };
}

function structuralIssues(graph: ContractFlowGraph): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const add = (code: string, message: string, nodeId: string | null = null) =>
    issues.push({ code, message, nodeId });

  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (ids.has(n.id)) add("DUPLICATE_NODE", `Id de nodo repetido: ${n.id}.`, n.id);
    ids.add(n.id);
  }
  const edgeIds = new Set<string>();
  for (const e of graph.edges) {
    if (edgeIds.has(e.id)) add("DUPLICATE_EDGE", `Id de arista repetido: ${e.id}.`);
    edgeIds.add(e.id);
    if (!ids.has(e.source) || !ids.has(e.target)) {
      add("DANGLING_EDGE", `La arista ${e.id} apunta a un nodo inexistente.`);
    }
  }
  if (issues.length > 0) return issues;

  const starts = graph.nodes.filter((n) => n.type === "start");
  if (starts.length !== 1) add("START_COUNT", "Debe haber exactamente un nodo de inicio.");
  if (!graph.nodes.some((n) => n.type === "end")) add("NO_END", "Debe haber al menos un nodo final.");

  const out = new Map<string, typeof graph.edges>();
  for (const n of graph.nodes) out.set(n.id, []);
  for (const e of graph.edges) out.get(e.source)!.push(e);

  for (const n of graph.nodes) {
    const edges = out.get(n.id)!;
    if (n.type === "end") {
      if (edges.length > 0) add("END_HAS_OUTPUT", "Un nodo final no puede tener salidas.", n.id);
    } else if (n.type === "condition") {
      const handles = edges.map((e) => e.sourceHandle).sort().join(",");
      if (handles !== "false,true") add("CONDITION_BRANCHES", "La condición necesita exactamente una salida 'sí' y una 'no'.", n.id);
    } else if (edges.length !== 1 || edges[0].sourceHandle !== "default") {
      add("SINGLE_OUTPUT", "Este nodo necesita exactamente una salida.", n.id);
    }
    if (n.type === "start" && graph.edges.some((e) => e.target === n.id)) {
      add("START_HAS_INPUT", "El inicio no puede tener entradas.", n.id);
    }
    if (n.type === "amount" && n.data.mode === "range" && n.data.minMinor > n.data.maxMinor) {
      add("RANGE", "El mínimo no puede superar el máximo.", n.id);
    }
    if (n.type === "start" && n.data.validTo !== null && n.data.validTo < n.data.validFrom) {
      add("PERIOD", "La vigencia termina antes de empezar.", n.id);
    }
  }
  if (issues.length > 0 || starts.length !== 1) return issues;

  // Ciclos y alcanzabilidad (DFS desde el inicio).
  const state = new Map<string, 1 | 2>(); // 1 = en curso, 2 = terminado
  let cyclic = false;
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id)!) {
      const s = state.get(e.target);
      if (s === 1) cyclic = true;
      else if (s === undefined) visit(e.target);
    }
    state.set(id, 2);
  };
  visit(starts[0].id);
  if (cyclic) add("CYCLE", "El flujo contiene un ciclo.");
  for (const n of graph.nodes) {
    if (!state.has(n.id)) add("UNREACHABLE", "Este nodo no es alcanzable desde el inicio.", n.id);
  }
  return issues;
}
