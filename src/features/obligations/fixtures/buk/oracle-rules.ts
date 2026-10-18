/**
 * ORÁCULO DE PRUEBAS (no es el motor de Pacta): reglas de nómina de platform-core §7.1 aplicadas a los contratos compartidos.
 * Determinista y sin I/O. Sirve para comprobar que los payloads de Buk, el mapper y los esquemas producen lo que cada escenario
 * espera. El motor real vive en `src/features/decisions/` y es la fuente de verdad; este archivo no se importa desde producción.
 * Las reglas de corrida «afectan a todas las líneas»: una que escala lleva a `requires_approval` toda línea no bloqueada;
 * `fondos_suficientes` bloquea todas las líneas y deja la ocurrencia `held`.
 */
import type { ObligationTemplate, PayrollDataset, PayrollEmployee } from "@/shared/schemas/obligation-config";
import type { ObligationContext, OccurrenceContext, OccurrenceStatus } from "@/shared/schemas/obligation-context";
import type { ReasonCode } from "@/shared/schemas/payment-decision";

export type OracleDecision = "approved" | "blocked" | "requires_approval";
export type OracleEffect = "requires_approval" | "blocked";
export type OracleFinding = { code: ReasonCode; effect: OracleEffect };
export type OracleRunFinding = { ruleId: "obligacion_autorizada" | "evidencia_vigente" | "corrida_completa" | "fondos_suficientes"; code: ReasonCode; effect: OracleEffect; counterpartyRef: string | null };
export type OracleLineResult = {
  lineId: string;
  counterpartyRef: string;
  displayName: string;
  lineType: ObligationContext["lineType"];
  amountMinor: number | null;
  decision: OracleDecision;
  reasons: ReasonCode[];
};
export type OracleOccurrenceResult = {
  occurrenceId: string;
  asOf: string;
  occurrenceStatus: Extract<OccurrenceStatus, "ready_to_execute" | "in_approval" | "held">;
  counts: Record<OracleDecision, number>;
  runFindings: OracleRunFinding[];
  lines: OracleLineResult[];
};

const escalate = (code: ReasonCode): OracleFinding => ({ code, effect: "requires_approval" });
const block = (code: ReasonCode): OracleFinding => ({ code, effect: "blocked" });

/** Campos cuyo faltante hace insuficiente la línea. Los `lastConfirmed*` los trata su propia regla. */
const ESSENTIAL_MISSING = new Set(["beneficiaryAccountReference", "amountMinor", "currency"]);

export function oracleDecideLine(
  line: ObligationContext,
  employee: PayrollEmployee | null,
  dataset: PayrollDataset,
  template: ObligationTemplate,
  sameOccurrence: readonly ObligationContext[],
): OracleFinding[] {
  const findings: OracleFinding[] = [];
  if (line.currency !== null && line.currency !== template.currency) findings.push(escalate("CURRENCY_NOT_SUPPORTED"));
  if (line.amountMinor === null || line.missingFields.some((field) => ESSENTIAL_MISSING.has(field))) findings.push(escalate("INSUFFICIENT_DATA"));

  // linea_esperada
  if (!employee) findings.push(escalate("EMPLOYEE_NOT_FOUND"));
  // empleado_activo: bloquea en línea ordinaria; la liquidación final escala (nunca se aprueba sola)
  if (employee?.status === "terminated") findings.push(line.lineType === "final_settlement" ? escalate("EMPLOYEE_TERMINATED") : block("EMPLOYEE_TERMINATED"));
  else if (line.lineType === "final_settlement") findings.push(escalate("INSUFFICIENT_DATA"));
  // empleado_sin_licencia
  if (employee?.status === "on_leave") findings.push(escalate("INSUFFICIENT_DATA"));
  // cuenta_estable
  if (line.lastConfirmedBeneficiaryReference === null) findings.push(escalate("INSUFFICIENT_DATA"));
  else if (line.beneficiaryAccountReference !== line.lastConfirmedBeneficiaryReference) findings.push(escalate("BENEFICIARY_CHANGED"));
  // variacion_aceptable (solo salario: es la única clase con monto confirmado recurrente)
  if (line.lineType === "salary" && line.amountMinor !== null) {
    if (line.lastConfirmedAmountMinor === null) findings.push(escalate("INSUFFICIENT_DATA"));
    else if (Math.abs(line.amountMinor - line.lastConfirmedAmountMinor) * 10_000 > template.varianceToleranceBps * line.lastConfirmedAmountMinor) findings.push(escalate("VARIANCE_EXCEEDED"));
  }
  // beneficios_esperados
  if (employee) {
    const expected = dataset.benefits.filter((benefit) => benefit.counterpartyRef === line.counterpartyRef && benefit.periodStart >= line.periodStart && benefit.periodStart <= line.periodEnd);
    if (line.lineType === "salary") {
      for (const benefit of expected) {
        const present = sameOccurrence.some((other) => other.counterpartyRef === line.counterpartyRef && other.lineType === benefit.lineType);
        if (!present) findings.push(escalate("BENEFIT_MISMATCH")); // mes de prima sin el concepto
      }
    } else if (line.lineType === "bonus" || line.lineType === "severance") {
      if (!expected.some((benefit) => benefit.lineType === line.lineType && benefit.expectedAmountMinor === line.amountMinor)) findings.push(escalate("BENEFIT_MISMATCH"));
    }
  }
  // sin_linea_duplicada: misma contraparte y misma clase ya presente antes en la corrida
  const index = sameOccurrence.findIndex((other) => other.lineId === line.lineId);
  if (sameOccurrence.slice(0, index).some((other) => other.counterpartyRef === line.counterpartyRef && other.lineType === line.lineType)) findings.push(block("DUPLICATE_LINE"));
  // sin_senales_pendientes
  if (line.signals.some((signal) => signal.status === "proposed" || signal.status === "verified")) findings.push(escalate("SIGNAL_PENDING_REVIEW"));
  return findings;
}

const unique = <T>(values: T[]) => [...new Set(values)];

export function oracleDecideOccurrence(input: {
  template: ObligationTemplate;
  occurrence: OccurrenceContext;
  lines: readonly ObligationContext[];
  dataset: PayrollDataset;
}): OracleOccurrenceResult {
  const { template, occurrence, lines, dataset } = input;
  const employees = new Map(dataset.employees.map((employee) => [employee.counterpartyRef, employee]));

  const results: OracleLineResult[] = lines.map((line) => {
    const findings = oracleDecideLine(line, employees.get(line.counterpartyRef) ?? null, dataset, template, lines);
    const decision: OracleDecision = findings.some((finding) => finding.effect === "blocked") ? "blocked" : findings.length ? "requires_approval" : "approved";
    return {
      lineId: line.lineId,
      counterpartyRef: line.counterpartyRef,
      displayName: line.displayName,
      lineType: line.lineType,
      amountMinor: line.amountMinor,
      decision,
      reasons: unique(findings.map((finding) => finding.code)),
    };
  });

  const run: OracleRunFinding[] = [];
  // obligacion_autorizada: plantilla no activa, sin activación, o total sobre el tope
  const total = lines.reduce((sum, line) => sum + (line.amountMinor ?? 0), 0);
  if (template.status !== "active" || template.activatedAt === null || total > template.runCapMinor) {
    run.push({ ruleId: "obligacion_autorizada", code: "OBLIGATION_NOT_AUTHORIZED", effect: "requires_approval", counterpartyRef: null });
  }
  // evidencia_vigente
  const ageMs = occurrence.evidenceCapturedAt ? Date.parse(occurrence.asOf) - Date.parse(occurrence.evidenceCapturedAt) : Number.POSITIVE_INFINITY;
  if (ageMs > template.evidenceMaxAgeDays * 86_400_000) run.push({ ruleId: "evidencia_vigente", code: "STALE_EVIDENCE", effect: "requires_approval", counterpartyRef: null });
  // corrida_completa: empleado activo esperado sin línea de salario
  for (const expected of occurrence.expectedCounterparties) {
    if (!lines.some((line) => line.counterpartyRef === expected && line.lineType === "salary")) {
      run.push({ ruleId: "corrida_completa", code: "PAYROLL_OMISSION", effect: "requires_approval", counterpartyRef: expected });
    }
  }
  for (const result of results) {
    if (result.decision === "blocked") continue;
    for (const finding of run) {
      result.decision = "requires_approval";
      if (!result.reasons.includes(finding.code)) result.reasons.push(finding.code);
    }
  }

  // fondos_suficientes: disponibles − reservados debe cubrir todo lo que podría pagarse (líneas no bloqueadas)
  const payable = results.filter((result) => result.decision !== "blocked").reduce((sum, result) => sum + (result.amountMinor ?? 0), 0);
  const free = occurrence.fundsAvailableMinor === null || occurrence.fundsReservedMinor === null ? null : occurrence.fundsAvailableMinor - occurrence.fundsReservedMinor;
  if (free === null || payable > free) {
    run.push({ ruleId: "fondos_suficientes", code: "FUNDS_INSUFFICIENT", effect: "blocked", counterpartyRef: null });
    for (const result of results) {
      result.decision = "blocked";
      if (!result.reasons.includes("FUNDS_INSUFFICIENT")) result.reasons.push("FUNDS_INSUFFICIENT");
    }
  }

  const counts: Record<OracleDecision, number> = { approved: 0, blocked: 0, requires_approval: 0 };
  for (const result of results) counts[result.decision]++;
  const occurrenceStatus = run.some((finding) => finding.effect === "blocked") ? "held" : counts.requires_approval > 0 ? "in_approval" : "ready_to_execute";
  return { occurrenceId: occurrence.occurrenceId, asOf: occurrence.asOf, occurrenceStatus, counts, runFindings: run, lines: results };
}
