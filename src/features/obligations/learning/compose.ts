/**
 * Purpose: combina la decisión de las reglas fijas con los hallazgos aprendidos. Regla de oro: el resultado nunca es
 *   más permisivo que la decisión base. Lo aprendido solo puede subir la cautela (CLAUDE.md §6.11).
 * Runs in: servidor y pruebas (puro).
 */
import type { OracleDecision } from "../fixtures/buk/oracle-rules";
import type { LearnedFinding } from "./types";

const RANK: Record<OracleDecision, number> = { approved: 0, requires_approval: 1, blocked: 2 };

export const isAtLeastAsCautious = (candidate: OracleDecision, base: OracleDecision) => RANK[candidate] >= RANK[base];

export function composeDecision(base: OracleDecision, learned: readonly LearnedFinding[]): OracleDecision {
  if (base === "blocked") return "blocked";
  return learned.length > 0 ? "requires_approval" : base;
}

export function composeReasons(baseReasons: readonly string[], learned: readonly LearnedFinding[]): string[] {
  return [...new Set([...baseReasons, ...learned.map((finding) => finding.reasonCode)])];
}
