/**
 * Purpose: compara una línea de salario con el perfil histórico de su empleado. Solo produce hallazgos que ESCALAN:
 *   un patrón conocido nunca vuelve aprobada una línea. Reutiliza los códigos VARIANCE_EXCEEDED y BENEFIT_MISMATCH y se
 *   distingue por `ruleId`. Con menos de MIN_OBSERVATIONS observaciones no hay hallazgo y rige la regla fija.
 * Runs in: servidor y pruebas (puro).
 * Receives → Returns: (perfil | undefined, línea, { month }) → LearnedFinding[].
 */
import type { ObligationContext } from "@/shared/schemas/obligation-context";
import { K_ROBUST, MIN_OBSERVATIONS } from "./config";
import { monthsBetween } from "./profile";
import type { CounterpartyProfile, LearnedFinding } from "./types";

const BASE_COMPONENT_CODES = new Set(["net_pay", "net_base"]);

export function assessLine(profile: CounterpartyProfile | undefined, line: ObligationContext, context: { month: string }): LearnedFinding[] {
  if (!profile || profile.n < MIN_OBSERVATIONS) return [];
  if (line.lineType !== "salary" || line.amountMinor === null) return [];
  const findings: LearnedFinding[] = [];

  const deviation = Math.abs(line.amountMinor - profile.baselineMinor);
  if (deviation > K_ROBUST * profile.scaleMinor) {
    const deviationBps = Math.round((deviation * 10_000) / profile.baselineMinor);
    findings.push({
      ruleId: "patron_historico",
      reasonCode: "VARIANCE_EXCEEDED",
      explanation: `El neto se aleja ${(deviationBps / 100).toFixed(1)} % de lo habitual de este empleado (${profile.n} meses de historia), más de ${K_ROBUST} veces su variación normal.`,
      detail: { deviationBps, baselineMinor: profile.baselineMinor, scaleMinor: profile.scaleMinor, observations: profile.n },
    });
  }

  const present = line.components.filter((component) => !BASE_COMPONENT_CODES.has(component.code));
  for (const component of present) {
    const concept = profile.concepts.find((candidate) => candidate.code === component.code);
    if (!concept) {
      findings.push({
        ruleId: "concepto_inesperado",
        reasonCode: "BENEFIT_MISMATCH",
        explanation: `El concepto «${component.code}» no aparece en el historial de este empleado.`,
        detail: { code: component.code, amountMinor: component.amountMinor },
      });
    } else if (concept.cadenceMonths !== null && concept.cadenceMonths > 1 && monthsBetween(concept.lastMonth, context.month) % concept.cadenceMonths !== 0) {
      findings.push({
        ruleId: "concepto_inesperado",
        reasonCode: "BENEFIT_MISMATCH",
        explanation: `El concepto «${component.code}» suele pagarse cada ${concept.cadenceMonths} meses y este mes no le toca.`,
        detail: { code: component.code, cadenceMonths: concept.cadenceMonths, lastMonth: concept.lastMonth },
      });
    }
  }
  for (const concept of profile.concepts) {
    if (concept.cadenceMonths === null || concept.cadenceMonths < 2) continue;
    const elapsed = monthsBetween(concept.lastMonth, context.month);
    const due = elapsed > 0 && elapsed % concept.cadenceMonths === 0;
    if (due && !present.some((component) => component.code === concept.code)) {
      findings.push({
        ruleId: "concepto_recurrente_ausente",
        reasonCode: "BENEFIT_MISMATCH",
        explanation: `Este mes tocaba el concepto «${concept.code}» (cada ${concept.cadenceMonths} meses) y no viene en la liquidación.`,
        detail: { code: concept.code, cadenceMonths: concept.cadenceMonths, lastMonth: concept.lastMonth },
      });
    }
  }
  return findings;
}
