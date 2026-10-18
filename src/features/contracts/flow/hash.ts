/**
 * Purpose: hash canónico (sha256) de un grafo de contrato, para congelar y referenciar versiones.
 * Runs in: solo servidor y tests (usa node:crypto; no importar desde componentes cliente).
 * Triggered by: createContract, saveFlowDraft y activateFlow.
 * Receives → Returns: ContractFlowGraph → string hex de 64 caracteres.
 * Talks to: ./schema.ts (solo el tipo).
 */
import { createHash } from "node:crypto";
import type { ContractFlowGraph } from "./schema";

// JSON con claves ordenadas: el mismo grafo siempre produce el mismo hash.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashGraph(graph: ContractFlowGraph): string {
  return createHash("sha256").update(canonical(graph)).digest("hex");
}
