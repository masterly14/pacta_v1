/**
 * Purpose: motor determinista de nómina (platform-core §7.1): decide cada línea de una corrida de
 *   pago (aprobada, bloqueada o requiere aprobación) y la corrida completa. `approved` significa
 *   aprobado para pago SIMULADO. El LLM no decide; las señales sin verificar solo suben la cautela.
 * Runs in: servidor, navegador y tests (puro: sin I/O, reloj, red ni IA; `asOf` viene en la ocurrencia).
 * Triggered by: el flujo de nómina de obligaciones y sus pruebas contra los escenarios de Buk.
 * Receives → Returns: { template, occurrence, lines, dataset } → PayrollRunResult con reglas por línea.
 * Talks to: src/shared/schemas/{obligation-config,obligation-context,payment-decision}.ts.
 */
import type { ObligationTemplate, PayrollDataset, PayrollEmployee } from "@/shared/schemas/obligation-config";
import type { ObligationContext, OccurrenceContext, OccurrenceStatus } from "@/shared/schemas/obligation-context";
import type { ReasonCode } from "@/shared/schemas/payment-decision";

export type PayrollDecision = "approved" | "blocked" | "requires_approval";
type Effect = "requires_approval" | "blocked";

export type PayrollRuleEvaluation = {
  ruleId: string;
  result: "pass" | "fail";
  reasonCode: ReasonCode | null;
  effect: Effect | null;
  explanation: string;
};

export type PayrollRunRuleId = "obligacion_autorizada" | "evidencia_vigente" | "corrida_completa" | "fondos_suficientes";

export type PayrollRunFinding = {
  ruleId: PayrollRunRuleId;
  reasonCode: ReasonCode;
  effect: Effect;
  counterpartyRef: string | null;
  explanation: string;
};

export type PayrollLineDecision = {
  lineId: string;
  counterpartyRef: string;
  displayName: string;
  lineType: ObligationContext["lineType"];
  amountMinor: number | null;
  decision: PayrollDecision;
  reasonCodes: ReasonCode[];
  rulesEvaluated: PayrollRuleEvaluation[];
  dataOrigin: "fixture";
  isSimulated: true;
};

export type PayrollRunResult = {
  occurrenceId: string;
  asOf: string;
  occurrenceStatus: Extract<OccurrenceStatus, "ready_to_execute" | "in_approval" | "held">;
  counts: Record<PayrollDecision, number>;
  runFindings: PayrollRunFinding[];
  lines: PayrollLineDecision[];
  held: boolean;
};

export type PayrollRunInput = {
  template: ObligationTemplate;
  occurrence: OccurrenceContext;
  lines: readonly ObligationContext[];
  dataset: PayrollDataset;
};

type Finding = { ruleId: string; code: ReasonCode; effect: Effect; explanation: string };

// Orden fijo de las reglas de línea; el de los códigos en la decisión sigue este orden.
export const PAYROLL_LINE_RULE_IDS = [
  "datos_completos",
  "linea_esperada",
  "empleado_activo",
  "empleado_sin_licencia",
  "cuenta_estable",
  "variacion_aceptable",
  "beneficios_esperados",
  "sin_linea_duplicada",
  "sin_senales_pendientes",
] as const;

// Campos cuyo faltante hace insuficiente la línea. Los `lastConfirmed*` los trata su propia regla.
const ESSENTIAL_MISSING = new Set(["beneficiaryAccountReference", "amountMinor", "currency"]);
const DAY_MS = 86_400_000;

function lineFindings(
  line: ObligationContext,
  employee: PayrollEmployee | null,
  dataset: PayrollDataset,
  template: ObligationTemplate,
  sameOccurrence: readonly ObligationContext[],
): Finding[] {
  const out: Finding[] = [];
  const add = (ruleId: string, code: ReasonCode, effect: Effect, explanation: string) => out.push({ ruleId, code, effect, explanation });

  if (line.currency !== null && line.currency !== template.currency) {
    add("datos_completos", "CURRENCY_NOT_SUPPORTED", "requires_approval", `La línea está en ${line.currency}; la plantilla paga en ${template.currency}.`);
  }
  if (line.amountMinor === null || line.missingFields.some((field) => ESSENTIAL_MISSING.has(field))) {
    add("datos_completos", "INSUFFICIENT_DATA", "requires_approval", "Falta el monto, la moneda o la cuenta de la línea.");
  }

  if (!employee) add("linea_esperada", "EMPLOYEE_NOT_FOUND", "requires_approval", "La contraparte no figura en la nómina de la organización.");

  // Una línea ordinaria de alguien retirado se bloquea; la liquidación final nunca se aprueba sola.
  if (employee?.status === "terminated") {
    if (line.lineType === "final_settlement") add("empleado_activo", "EMPLOYEE_TERMINATED", "requires_approval", "Liquidación final de un empleado retirado: requiere aprobación humana.");
    else add("empleado_activo", "EMPLOYEE_TERMINATED", "blocked", "El empleado figura como retirado; no se paga una línea ordinaria.");
  } else if (line.lineType === "final_settlement") {
    add("empleado_activo", "INSUFFICIENT_DATA", "requires_approval", "Hay una liquidación final pero el empleado no figura como retirado.");
  }

  if (employee?.status === "on_leave") add("empleado_sin_licencia", "INSUFFICIENT_DATA", "requires_approval", "El empleado está en licencia; se confirma el monto antes de pagar.");

  if (line.lastConfirmedBeneficiaryReference === null) {
    add("cuenta_estable", "INSUFFICIENT_DATA", "requires_approval", "No hay una cuenta confirmada previamente con la que comparar.");
  } else if (line.beneficiaryAccountReference !== line.lastConfirmedBeneficiaryReference) {
    add("cuenta_estable", "BENEFICIARY_CHANGED", "requires_approval", "La cuenta de pago cambió respecto a la última confirmada. Un cambio de cuenta nunca se aprueba solo.");
  }

  // Solo el salario tiene un monto confirmado recurrente con el que comparar.
  if (line.lineType === "salary" && line.amountMinor !== null) {
    if (line.lastConfirmedAmountMinor === null) {
      add("variacion_aceptable", "INSUFFICIENT_DATA", "requires_approval", "No hay un salario confirmado previamente con el que comparar.");
    } else if (Math.abs(line.amountMinor - line.lastConfirmedAmountMinor) * 10_000 > template.varianceToleranceBps * line.lastConfirmedAmountMinor) {
      add("variacion_aceptable", "VARIANCE_EXCEEDED", "requires_approval", "El salario varía más de la tolerancia respecto al último confirmado.");
    }
  }

  if (employee) {
    const expected = dataset.benefits.filter(
      (benefit) => benefit.counterpartyRef === line.counterpartyRef && benefit.periodStart >= line.periodStart && benefit.periodStart <= line.periodEnd,
    );
    if (line.lineType === "salary") {
      for (const benefit of expected) {
        const present = sameOccurrence.some((other) => other.counterpartyRef === line.counterpartyRef && other.lineType === benefit.lineType);
        if (!present) add("beneficios_esperados", "BENEFIT_MISMATCH", "requires_approval", "Este mes corresponde un beneficio (p. ej. prima) que no viene en la corrida.");
      }
    } else if (line.lineType === "bonus" || line.lineType === "severance") {
      if (!expected.some((benefit) => benefit.lineType === line.lineType && benefit.expectedAmountMinor === line.amountMinor)) {
        add("beneficios_esperados", "BENEFIT_MISMATCH", "requires_approval", "El beneficio no coincide con el esperado (concepto o monto).");
      }
    }
  }

  const index = sameOccurrence.findIndex((other) => other.lineId === line.lineId);
  if (sameOccurrence.slice(0, index).some((other) => other.counterpartyRef === line.counterpartyRef && other.lineType === line.lineType)) {
    add("sin_linea_duplicada", "DUPLICATE_LINE", "blocked", "La misma contraparte ya tiene una línea de esta clase en la corrida.");
  }

  // Una señal sin resolver solo sube la cautela; verificarla es una acción humana.
  if (line.signals.some((signal) => signal.status === "proposed" || signal.status === "verified")) {
    add("sin_senales_pendientes", "SIGNAL_PENDING_REVIEW", "requires_approval", "Hay una novedad del correo o de Buk pendiente de revisión.");
  }
  return out;
}

const unique = <T>(values: T[]): T[] => [...new Set(values)];

function evaluationsOf(findings: Finding[]): PayrollRuleEvaluation[] {
  return PAYROLL_LINE_RULE_IDS.flatMap((ruleId): PayrollRuleEvaluation[] => {
    const own = findings.filter((finding) => finding.ruleId === ruleId);
    if (own.length === 0) return [{ ruleId, result: "pass", reasonCode: null, effect: null, explanation: "Cumple." }];
    return own.map((finding) => ({ ruleId, result: "fail", reasonCode: finding.code, effect: finding.effect, explanation: finding.explanation }));
  });
}

export function decidePayrollRun(input: PayrollRunInput): PayrollRunResult {
  const { template, occurrence, lines, dataset } = input;
  const employees = new Map(dataset.employees.map((employee) => [employee.counterpartyRef, employee]));

  const results: PayrollLineDecision[] = lines.map((line) => {
    const findings = lineFindings(line, employees.get(line.counterpartyRef) ?? null, dataset, template, lines);
    return {
      lineId: line.lineId,
      counterpartyRef: line.counterpartyRef,
      displayName: line.displayName,
      lineType: line.lineType,
      amountMinor: line.amountMinor,
      decision: findings.some((f) => f.effect === "blocked") ? "blocked" : findings.length > 0 ? "requires_approval" : "approved",
      reasonCodes: unique(findings.map((f) => f.code)),
      rulesEvaluated: evaluationsOf(findings),
      dataOrigin: "fixture",
      isSimulated: true,
    };
  });

  const run: PayrollRunFinding[] = [];
  const total = lines.reduce((sum, line) => sum + (line.amountMinor ?? 0), 0);
  if (template.status !== "active" || template.activatedAt === null) {
    run.push({ ruleId: "obligacion_autorizada", reasonCode: "OBLIGATION_NOT_AUTHORIZED", effect: "requires_approval", counterpartyRef: null, explanation: "La plantilla de nómina no está activada por una persona autorizada." });
  } else if (total > template.runCapMinor) {
    run.push({ ruleId: "obligacion_autorizada", reasonCode: "OBLIGATION_NOT_AUTHORIZED", effect: "requires_approval", counterpartyRef: null, explanation: "El total de la corrida supera el tope autorizado." });
  }

  const ageMs = occurrence.evidenceCapturedAt ? Date.parse(occurrence.asOf) - Date.parse(occurrence.evidenceCapturedAt) : Number.POSITIVE_INFINITY;
  if (ageMs > template.evidenceMaxAgeDays * DAY_MS) {
    run.push({ ruleId: "evidencia_vigente", reasonCode: "STALE_EVIDENCE", effect: "requires_approval", counterpartyRef: null, explanation: "La evidencia de Buk es más antigua que lo permitido por la plantilla." });
  }

  for (const expected of occurrence.expectedCounterparties) {
    if (!lines.some((line) => line.counterpartyRef === expected && line.lineType === "salary")) {
      run.push({ ruleId: "corrida_completa", reasonCode: "PAYROLL_OMISSION", effect: "requires_approval", counterpartyRef: expected, explanation: `Falta la línea de salario de ${expected}, que figura como activo.` });
    }
  }

  // Las reglas de corrida afectan a todas las líneas: las que escalan suben toda línea no bloqueada.
  for (const result of results) {
    if (result.decision === "blocked") continue;
    for (const finding of run) {
      result.decision = "requires_approval";
      if (!result.reasonCodes.includes(finding.reasonCode)) result.reasonCodes.push(finding.reasonCode);
    }
  }

  // Los fondos libres deben cubrir todo lo que podría pagarse; si no, se bloquea toda la corrida.
  const payable = results.filter((r) => r.decision !== "blocked").reduce((sum, r) => sum + (r.amountMinor ?? 0), 0);
  const free = occurrence.fundsAvailableMinor === null || occurrence.fundsReservedMinor === null ? null : occurrence.fundsAvailableMinor - occurrence.fundsReservedMinor;
  if (free === null || payable > free) {
    run.push({ ruleId: "fondos_suficientes", reasonCode: "FUNDS_INSUFFICIENT", effect: "blocked", counterpartyRef: null, explanation: free === null ? "Se desconocen los fondos libres." : "Los fondos libres no cubren la corrida." });
    for (const result of results) {
      result.decision = "blocked";
      if (!result.reasonCodes.includes("FUNDS_INSUFFICIENT")) result.reasonCodes.push("FUNDS_INSUFFICIENT");
    }
  }

  const counts: Record<PayrollDecision, number> = { approved: 0, blocked: 0, requires_approval: 0 };
  for (const result of results) counts[result.decision]++;
  const held = run.some((finding) => finding.effect === "blocked");
  return {
    occurrenceId: occurrence.occurrenceId,
    asOf: occurrence.asOf,
    occurrenceStatus: held ? "held" : counts.requires_approval > 0 ? "in_approval" : "ready_to_execute",
    counts,
    runFindings: run,
    lines: results,
    held,
  };
}
