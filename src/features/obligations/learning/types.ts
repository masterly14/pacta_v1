/** Tipos del aprendizaje histórico. Los perfiles son datos derivados y recalculables, nunca una autorización. */

export type ConceptProfile = {
  code: string;
  /** Meses en que apareció el concepto, ascendentes. */
  months: string[];
  occurrences: number;
  /** Meses entre apariciones cuando el patrón es estable; null si no lo es. */
  cadenceMonths: number | null;
  medianMinor: number;
  maxMinor: number;
  lastMonth: string;
};

export type CounterpartyProfile = {
  counterpartyRef: string;
  /** Observaciones usadas. */
  n: number;
  baselineMinor: number;
  scaleMinor: number;
  /** Mes desde el que se detectó un cambio de nivel persistente, o null. */
  levelShiftFrom: string | null;
  concepts: ConceptProfile[];
  accountChanges: { month: string; from: string | null; to: string | null }[];
  lastMonth: string;
};

export type LearnedRuleId = "patron_historico" | "concepto_inesperado" | "concepto_recurrente_ausente";

/** Hallazgo aprendido. Solo puede escalar: reutiliza códigos de razón existentes y se distingue por `ruleId`. */
export type LearnedFinding = {
  ruleId: LearnedRuleId;
  reasonCode: "VARIANCE_EXCEEDED" | "BENEFIT_MISMATCH";
  explanation: string;
  detail: Record<string, number | string | null>;
};
