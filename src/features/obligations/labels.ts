/**
 * Purpose: etiquetas en español para lo que muestran las pantallas de obligaciones (los valores guardados siguen en inglés).
 * Runs in: cualquier lugar (constantes puras).
 */
import type { OccurrenceStatus } from "@/shared/schemas/obligation-context";
import type { Phase } from "./store";

export const OCCURRENCE_STATUS_LABEL: Record<OccurrenceStatus, string> = {
  scheduled: "Programada",
  collecting_evidence: "Recolectando evidencia",
  evaluated: "Evaluada",
  in_approval: "Con excepciones por resolver",
  ready_to_execute: "Lista para ejecutar",
  simulated_executed: "Ejecutada (simulada)",
  held: "Retenida",
  failed: "Con error",
  cancelled: "Cancelada",
};

export const PHASE_LABEL: Record<Phase, string> = {
  prepare: "Preparar corrida",
  alert_early: "Aviso temprano",
  alert_urgent: "Aviso urgente",
  execute: "Ejecutar (simulado)",
};

export const OUTCOME_LABEL = { approved: "Aprobada", blocked: "Bloqueada", requires_approval: "Requiere aprobación" } as const;

export const OBLIGATION_STATUS_LABEL = { draft: "Borrador", active: "Activa", paused: "Pausada" } as const;

export const LINE_TYPE_LABEL: Record<string, string> = { salary: "Salario", bonus: "Prima", severance: "Cesantías", final_settlement: "Liquidación final" };
