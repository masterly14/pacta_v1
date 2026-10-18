/**
 * Purpose: motor determinístico de la nómina proactiva (platform-core §7.1). Cada línea de pago pasa por once reglas en
 *   orden fijo y luego por cuatro reglas de corrida. Todas se evalúan aunque una falle; el resultado y los motivos salen
 *   de TypeScript, nunca de un modelo. `approved` = aprobada para pago SIMULADO.
 * Runs in: servidor y pruebas (puro: sin E/S, sin IA, sin reloj; `asOf` viene en la ocurrencia).
 * Triggered by: obligations/runner.ts (preparar, reevaluar, ejecutar) y la aprobación humana de una línea.
 * Receives → Returns: decidePayrollRun({ plantilla, ocurrencia, líneas, dataset, hallazgos aprendidos? }) → PayrollRunResult.
 * Talks to: schemas compartidos (tipos), contracts/money#formatMinor, learning/types (solo tipos).
 * Regla de seguridad: desconocido o ambiguo nunca es `approved`; los hallazgos aprendidos solo pueden escalar.
 */
import { formatMinor } from "@/features/contracts/money";
import type { LearnedFinding } from "@/features/obligations/learning/types";
import type { ObligationTemplate, PayrollDataset, PayrollEmployee } from "@/shared/schemas/obligation-config";
import type { ObligationContext, OccurrenceContext } from "@/shared/schemas/obligation-context";
import type { ReasonCode } from "@/shared/schemas/payment-decision";

export type PayrollOutcome = "approved" | "blocked" | "requires_approval";

export type PayrollRuleEvaluation = {
  ruleId: string;
  result: "pass" | "fail" | "unknown";
  reasonCode: ReasonCode | null;
  explanation: string;
};

export type PayrollLineDecision = {
  lineId: string;
  counterpartyRef: string;
  displayName: string;
  lineType: ObligationContext["lineType"];
  amountMinor: number | null;
  currency: string | null;
  decision: PayrollOutcome;
  reasonCodes: ReasonCode[];
  rules: PayrollRuleEvaluation[];
};

export type PayrollRunFinding = {
  ruleId: "obligacion_autorizada" | "evidencia_vigente" | "corrida_completa" | "fondos_suficientes";
  reasonCode: ReasonCode;
  effect: "requires_approval" | "blocked";
  counterpartyRef: string | null;
};

export type PayrollRunResult = {
  occurrenceId: string;
  asOf: string;
  status: "ready_to_execute" | "in_approval" | "held";
  counts: Record<PayrollOutcome, number>;
  runFindings: PayrollRunFinding[];
  lines: PayrollLineDecision[];
};

export type PayrollRunInput = {
  template: ObligationTemplate;
  occurrence: OccurrenceContext;
  lines: readonly ObligationContext[];
  dataset: PayrollDataset;
  /** Hallazgos del perfil histórico por `lineId`. Solo escalan; una línea sin entrada no tiene hallazgos. */
  learned?: ReadonlyMap<string, readonly LearnedFinding[]>;
};

type Eval = PayrollRuleEvaluation & { hardBlock: boolean };

const pass = (ruleId: string, explanation: string): Eval => ({ ruleId, result: "pass", reasonCode: null, explanation, hardBlock: false });
const fail = (ruleId: string, reasonCode: ReasonCode, explanation: string, hardBlock = false): Eval => ({ ruleId, result: "fail", reasonCode, explanation, hardBlock });
const unknown = (ruleId: string, reasonCode: ReasonCode, explanation: string): Eval => ({ ruleId, result: "unknown", reasonCode, explanation, hardBlock: false });

/** Campos cuyo faltante hace insuficiente la línea. Los `lastConfirmed*` los trata su propia regla. */
const ESSENTIAL_MISSING = new Set(["beneficiaryAccountReference", "amountMinor", "currency"]);

const money = (amountMinor: number, currency: string | null) => formatMinor(amountMinor, currency ?? "COP");

function lineRules(
  line: ObligationContext,
  employee: PayrollEmployee | null,
  dataset: PayrollDataset,
  template: ObligationTemplate,
  all: readonly ObligationContext[],
  learned: readonly LearnedFinding[],
): Eval[] {
  const out: Eval[] = [];

  // 1 · moneda de la plantilla
  out.push(
    line.currency !== null && line.currency !== template.currency
      ? fail("moneda_soportada", "CURRENCY_NOT_SUPPORTED", `La línea viene en ${line.currency} y la plantilla paga en ${template.currency}; no se convierte moneda.`)
      : pass("moneda_soportada", `La moneda coincide con la de la plantilla (${template.currency}).`),
  );

  // 2 · datos esenciales
  const missing = line.missingFields.filter((field) => ESSENTIAL_MISSING.has(field));
  out.push(
    line.amountMinor === null || missing.length > 0
      ? fail("datos_esenciales", "INSUFFICIENT_DATA", `Faltan datos esenciales: ${(line.amountMinor === null ? ["importe", ...missing] : missing).join(", ")}.`)
      : pass("datos_esenciales", "La línea trae importe, moneda y cuenta."),
  );

  // 3 · la persona existe en la planilla
  out.push(employee ? pass("linea_esperada", "La persona está en la planilla de RR. HH.") : fail("linea_esperada", "EMPLOYEE_NOT_FOUND", "La persona no aparece en la planilla de RR. HH."));

  // 4 · empleado activo. Bloquea en línea ordinaria; la liquidación final escala y nunca se aprueba sola.
  if (employee?.status === "terminated") {
    out.push(
      line.lineType === "final_settlement"
        ? fail("empleado_activo", "EMPLOYEE_TERMINATED", "Es la liquidación final de una persona retirada: la decide una persona.")
        : fail("empleado_activo", "EMPLOYEE_TERMINATED", "La persona figura como retirada y tiene un pago ordinario: bloqueado.", true),
    );
  } else if (line.lineType === "final_settlement") {
    out.push(fail("empleado_activo", "INSUFFICIENT_DATA", "Hay una liquidación final de alguien que figura activo: no cuadra."));
  } else {
    out.push(employee ? pass("empleado_activo", "La persona figura activa.") : unknown("empleado_activo", "EMPLOYEE_NOT_FOUND", "No se pudo comprobar el estado laboral."));
  }

  // 5 · sin licencia o incapacidad en el periodo
  out.push(
    employee?.status === "on_leave"
      ? fail("empleado_sin_licencia", "INSUFFICIENT_DATA", "Tiene una licencia o incapacidad que cruza el periodo: una persona confirma el monto.")
      : pass("empleado_sin_licencia", "Sin licencias en el periodo."),
  );

  // 6 · cuenta estable
  if (line.lastConfirmedBeneficiaryReference === null) {
    out.push(unknown("cuenta_estable", "INSUFFICIENT_DATA", "No hay una cuenta confirmada anterior con la que comparar."));
  } else if (line.beneficiaryAccountReference !== line.lastConfirmedBeneficiaryReference) {
    out.push(
      fail(
        "cuenta_estable",
        "BENEFICIARY_CHANGED",
        `La cuenta cambió de ${line.lastConfirmedBeneficiaryReference} a ${line.beneficiaryAccountReference ?? "desconocida"}: un cambio legítimo existe, pero no se aprueba solo.`,
      ),
    );
  } else {
    out.push(pass("cuenta_estable", `La cuenta ${line.beneficiaryAccountReference} es la última confirmada.`));
  }

  // 7 · variación frente al último monto confirmado (solo salario: es la clase con monto recurrente)
  if (line.lineType === "salary" && line.amountMinor !== null) {
    if (line.lastConfirmedAmountMinor === null) {
      out.push(unknown("variacion_aceptable", "INSUFFICIENT_DATA", "No hay un monto confirmado anterior con el que comparar."));
    } else {
      const delta = Math.abs(line.amountMinor - line.lastConfirmedAmountMinor);
      if (delta * 10_000 > template.varianceToleranceBps * line.lastConfirmedAmountMinor) {
        const bps = Math.round((delta * 10_000) / line.lastConfirmedAmountMinor);
        out.push(
          fail(
            "variacion_aceptable",
            "VARIANCE_EXCEEDED",
            `${money(line.amountMinor, line.currency)} frente a ${money(line.lastConfirmedAmountMinor, line.currency)} confirmados: ${(bps / 100).toFixed(1)} % de variación (tolerancia ${(template.varianceToleranceBps / 100).toFixed(1)} %).`,
          ),
        );
      } else {
        out.push(pass("variacion_aceptable", "La variación está dentro de la tolerancia de la plantilla."));
      }
    }
  } else {
    out.push(pass("variacion_aceptable", "No aplica a esta clase de línea."));
  }

  // 8 · beneficios esperados en el mes (prima)
  if (employee) {
    const expected = dataset.benefits.filter((b) => b.counterpartyRef === line.counterpartyRef && b.periodStart >= line.periodStart && b.periodStart <= line.periodEnd);
    if (line.lineType === "salary") {
      const absent = expected.filter((b) => !all.some((other) => other.counterpartyRef === line.counterpartyRef && other.lineType === b.lineType));
      out.push(
        absent.length > 0
          ? fail("beneficios_esperados", "BENEFIT_MISMATCH", "Este mes toca prima y la liquidación no la trae.")
          : pass("beneficios_esperados", "Los beneficios esperados del mes están presentes."),
      );
    } else if (line.lineType === "bonus" || line.lineType === "severance") {
      const matches = expected.some((b) => b.lineType === line.lineType && b.expectedAmountMinor === line.amountMinor);
      out.push(
        matches
          ? pass("beneficios_esperados", "El beneficio coincide con el monto esperado.")
          : fail("beneficios_esperados", "BENEFIT_MISMATCH", "El beneficio no coincide con el monto que esperaba el calendario de beneficios."),
      );
    } else {
      out.push(pass("beneficios_esperados", "No aplica a esta clase de línea."));
    }
  } else {
    out.push(pass("beneficios_esperados", "Sin persona en planilla no se evalúan beneficios."));
  }

  // 9 · sin línea duplicada
  const index = all.findIndex((other) => other.lineId === line.lineId);
  const duplicated = all.slice(0, index).some((other) => other.counterpartyRef === line.counterpartyRef && other.lineType === line.lineType);
  out.push(duplicated ? fail("sin_linea_duplicada", "DUPLICATE_LINE", "La misma persona y clase de pago ya aparece antes en la corrida: bloqueada.", true) : pass("sin_linea_duplicada", "No hay otra línea igual en la corrida."));

  // 10 · sin señales pendientes (un correo o webhook solo puede aumentar la cautela)
  const pending = line.signals.filter((signal) => signal.status === "proposed" || signal.status === "verified");
  out.push(
    pending.length > 0
      ? fail("sin_senales_pendientes", "SIGNAL_PENDING_REVIEW", `Hay ${pending.length} novedad(es) pendiente(s) sobre esta persona; una persona las revisa antes de pagar.`)
      : pass("sin_senales_pendientes", "Sin novedades pendientes."),
  );

  // 11 · patrón histórico (aprendido): solo escala
  if (learned.length > 0) {
    for (const finding of learned) out.push(fail(finding.ruleId, finding.reasonCode, finding.explanation));
  } else {
    out.push(pass("patron_historico", "Sin desviaciones frente al historial (o sin historial suficiente)."));
  }
  return out;
}

const unique = <T>(values: T[]) => [...new Set(values)];

export function decidePayrollRun(input: PayrollRunInput): PayrollRunResult {
  const { template, occurrence, lines, dataset } = input;
  const employees = new Map(dataset.employees.map((employee) => [employee.counterpartyRef, employee]));

  // Reglas de corrida
  const total = lines.reduce((sum, line) => sum + (line.amountMinor ?? 0), 0);
  const runEvals: { eval: Eval; finding: PayrollRunFinding | null }[] = [];

  const authorized = template.status === "active" && template.activatedAt !== null && total <= template.runCapMinor;
  runEvals.push({
    eval: authorized
      ? pass("obligacion_autorizada", "La plantilla está activa y el total no supera su tope.")
      : fail(
          "obligacion_autorizada",
          "OBLIGATION_NOT_AUTHORIZED",
          template.status !== "active" || template.activatedAt === null
            ? "La plantilla no está activa: ninguna persona la autorizó todavía."
            : `El total ${money(total, template.currency)} supera el tope de la plantilla ${money(template.runCapMinor, template.currency)}.`,
        ),
    finding: authorized ? null : { ruleId: "obligacion_autorizada", reasonCode: "OBLIGATION_NOT_AUTHORIZED", effect: "requires_approval", counterpartyRef: null },
  });

  const ageMs = occurrence.evidenceCapturedAt ? Date.parse(occurrence.asOf) - Date.parse(occurrence.evidenceCapturedAt) : Number.POSITIVE_INFINITY;
  const fresh = ageMs <= template.evidenceMaxAgeDays * 86_400_000;
  runEvals.push({
    eval: fresh
      ? pass("evidencia_vigente", `La lectura de RR. HH. tiene menos de ${template.evidenceMaxAgeDays} día(s).`)
      : fail("evidencia_vigente", "STALE_EVIDENCE", `La lectura de RR. HH. es más vieja que ${template.evidenceMaxAgeDays} día(s) (o no existe).`),
    finding: fresh ? null : { ruleId: "evidencia_vigente", reasonCode: "STALE_EVIDENCE", effect: "requires_approval", counterpartyRef: null },
  });

  const omitted = occurrence.expectedCounterparties.filter((ref) => !lines.some((line) => line.counterpartyRef === ref && line.lineType === "salary"));
  if (omitted.length === 0) {
    runEvals.push({ eval: pass("corrida_completa", "Todas las personas activas tienen su línea."), finding: null });
  } else {
    for (const ref of omitted) {
      runEvals.push({
        eval: fail("corrida_completa", "PAYROLL_OMISSION", `Falta la línea de salario de ${ref}.`),
        finding: { ruleId: "corrida_completa", reasonCode: "PAYROLL_OMISSION", effect: "requires_approval", counterpartyRef: ref },
      });
    }
  }

  const lineResults: PayrollLineDecision[] = lines.map((line) => {
    const evals = lineRules(line, employees.get(line.counterpartyRef) ?? null, dataset, template, lines, input.learned?.get(line.lineId) ?? []);
    const blocked = evals.some((e) => e.hardBlock);
    const escalated = evals.some((e) => e.result !== "pass");
    return {
      lineId: line.lineId,
      counterpartyRef: line.counterpartyRef,
      displayName: line.displayName,
      lineType: line.lineType,
      amountMinor: line.amountMinor,
      currency: line.currency,
      decision: blocked ? "blocked" : escalated ? "requires_approval" : "approved",
      reasonCodes: unique(evals.flatMap((e) => (e.reasonCode ? [e.reasonCode] : []))),
      rules: evals.map((e) => ({ ruleId: e.ruleId, result: e.result, reasonCode: e.reasonCode, explanation: e.explanation })),
    };
  });

  const runFindings: PayrollRunFinding[] = runEvals.flatMap((r) => (r.finding ? [r.finding] : []));
  for (const result of lineResults) {
    for (const { eval: e, finding } of runEvals) {
      result.rules.push({ ruleId: e.ruleId, result: e.result, reasonCode: e.reasonCode, explanation: e.explanation });
      if (finding && result.decision !== "blocked") {
        result.decision = "requires_approval";
        if (!result.reasonCodes.includes(finding.reasonCode)) result.reasonCodes.push(finding.reasonCode);
      }
    }
  }

  // fondos suficientes: lo libre debe cubrir todo lo que podría pagarse (líneas no bloqueadas)
  const payable = lineResults.filter((r) => r.decision !== "blocked").reduce((sum, r) => sum + (r.amountMinor ?? 0), 0);
  const free = occurrence.fundsAvailableMinor === null || occurrence.fundsReservedMinor === null ? null : occurrence.fundsAvailableMinor - occurrence.fundsReservedMinor;
  const enough = free !== null && payable <= free;
  for (const result of lineResults) {
    result.rules.push(
      enough
        ? { ruleId: "fondos_suficientes", result: "pass", reasonCode: null, explanation: `Los fondos libres cubren ${money(payable, template.currency)}.` }
        : {
            ruleId: "fondos_suficientes",
            result: "fail",
            reasonCode: "FUNDS_INSUFFICIENT",
            explanation: free === null ? "No se conocen los fondos disponibles: no se paga." : `Se necesitan ${money(payable, template.currency)} y hay ${money(free, template.currency)} libres.`,
          },
    );
  }
  if (!enough) {
    runFindings.push({ ruleId: "fondos_suficientes", reasonCode: "FUNDS_INSUFFICIENT", effect: "blocked", counterpartyRef: null });
    for (const result of lineResults) {
      result.decision = "blocked";
      if (!result.reasonCodes.includes("FUNDS_INSUFFICIENT")) result.reasonCodes.push("FUNDS_INSUFFICIENT");
    }
  }

  const counts: Record<PayrollOutcome, number> = { approved: 0, blocked: 0, requires_approval: 0 };
  for (const result of lineResults) counts[result.decision]++;
  const status = runFindings.some((finding) => finding.effect === "blocked") ? "held" : counts.requires_approval > 0 ? "in_approval" : "ready_to_execute";
  return { occurrenceId: occurrence.occurrenceId, asOf: occurrence.asOf, status, counts, runFindings, lines: lineResults };
}
