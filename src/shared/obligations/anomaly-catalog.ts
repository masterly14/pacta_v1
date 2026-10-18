import type { InboxSignalKind, InboxSignalStatus, EmploymentEventSubtype } from "../schemas/inbox-signal";
import type { ObligationKind, ObligationLineType } from "../schemas/obligation-config";
import type { ReasonCode } from "../schemas/payment-decision";

// Tabla de anomalías de platform-core §7. No ejecuta las reglas: dice qué código y qué
// resultado produce cada una. Ninguna salida es `approved`. Una señal no reduce la cautela.

export type AnomalyScope = "line" | "run";
export type AnomalyOutcome = "requires_approval" | "blocked";

export type AnomalyRule = {
  ruleId: string;
  scope: AnomalyScope;
  appliesTo: ObligationKind;
  reasonCode: ReasonCode;
  outcome: AnomalyOutcome;
  absolute: boolean;
  /** Tipos de línea en los que un bloqueo absoluto escala en lugar de bloquear. */
  escalatesOnLineTypes?: readonly ObligationLineType[];
  /** Otros códigos que la misma regla puede levantar. Tampoco aprueban. */
  alsoReasonCodes?: readonly ReasonCode[];
};

export const ANOMALY_CATALOG = [
  // Nómina, corrida
  { ruleId: "obligacion_autorizada", scope: "run", appliesTo: "payroll", reasonCode: "OBLIGATION_NOT_AUTHORIZED", outcome: "requires_approval", absolute: false },
  { ruleId: "evidencia_vigente", scope: "run", appliesTo: "payroll", reasonCode: "STALE_EVIDENCE", outcome: "requires_approval", absolute: false },
  { ruleId: "corrida_completa", scope: "run", appliesTo: "payroll", reasonCode: "PAYROLL_OMISSION", outcome: "requires_approval", absolute: false },
  { ruleId: "fondos_suficientes", scope: "run", appliesTo: "payroll", reasonCode: "FUNDS_INSUFFICIENT", outcome: "blocked", absolute: true },
  // Nómina, línea
  { ruleId: "linea_esperada", scope: "line", appliesTo: "payroll", reasonCode: "EMPLOYEE_NOT_FOUND", outcome: "requires_approval", absolute: false },
  {
    ruleId: "empleado_activo",
    scope: "line",
    appliesTo: "payroll",
    reasonCode: "EMPLOYEE_TERMINATED",
    outcome: "blocked",
    absolute: true,
    escalatesOnLineTypes: ["final_settlement"],
  },
  { ruleId: "empleado_sin_licencia", scope: "line", appliesTo: "payroll", reasonCode: "INSUFFICIENT_DATA", outcome: "requires_approval", absolute: false },
  { ruleId: "cuenta_estable", scope: "line", appliesTo: "payroll", reasonCode: "BENEFICIARY_CHANGED", outcome: "requires_approval", absolute: false },
  {
    ruleId: "variacion_aceptable",
    scope: "line",
    appliesTo: "payroll",
    reasonCode: "VARIANCE_EXCEEDED",
    outcome: "requires_approval",
    absolute: false,
    alsoReasonCodes: ["INSUFFICIENT_DATA"],
  },
  { ruleId: "beneficios_esperados", scope: "line", appliesTo: "payroll", reasonCode: "BENEFIT_MISMATCH", outcome: "requires_approval", absolute: false },
  { ruleId: "sin_linea_duplicada", scope: "line", appliesTo: "payroll", reasonCode: "DUPLICATE_LINE", outcome: "blocked", absolute: true },
  { ruleId: "sin_senales_pendientes", scope: "line", appliesTo: "payroll", reasonCode: "SIGNAL_PENDING_REVIEW", outcome: "requires_approval", absolute: false },
  // Fiscal. `consistente_con_nomina` queda fuera (P1).
  { ruleId: "obligacion_autorizada", scope: "run", appliesTo: "fiscal", reasonCode: "OBLIGATION_NOT_AUTHORIZED", outcome: "requires_approval", absolute: false },
  { ruleId: "liquidacion_confirmada", scope: "line", appliesTo: "fiscal", reasonCode: "SETTLEMENT_UNCONFIRMED", outcome: "requires_approval", absolute: false },
  { ruleId: "monto_coincide_con_liquidacion", scope: "line", appliesTo: "fiscal", reasonCode: "SETTLEMENT_AMOUNT_MISMATCH", outcome: "requires_approval", absolute: false },
  { ruleId: "referencia_pago_estable", scope: "line", appliesTo: "fiscal", reasonCode: "BENEFICIARY_CHANGED", outcome: "requires_approval", absolute: false },
  { ruleId: "periodo_no_pagado", scope: "line", appliesTo: "fiscal", reasonCode: "DUPLICATE_LINE", outcome: "blocked", absolute: true },
  { ruleId: "dentro_de_plazo", scope: "line", appliesTo: "fiscal", reasonCode: "DEADLINE_PASSED", outcome: "requires_approval", absolute: false },
  {
    ruleId: "fondos_suficientes",
    scope: "run",
    appliesTo: "fiscal",
    reasonCode: "FUNDS_INSUFFICIENT",
    outcome: "blocked",
    absolute: true,
    alsoReasonCodes: ["DEADLINE_AT_RISK"],
  },
] as const satisfies readonly AnomalyRule[];

// Una señal de retiro ya verificada no aprueba: eleva la cautela a desvinculado y bloquea.
export const VERIFIED_TERMINATION_EFFECT = {
  kind: "employment_event",
  subtype: "termination",
  status: "verified",
  reasonCode: "EMPLOYEE_TERMINATED",
  outcome: "blocked",
  absolute: true,
} as const satisfies {
  kind: InboxSignalKind;
  subtype: EmploymentEventSubtype;
  status: InboxSignalStatus;
  reasonCode: ReasonCode;
  outcome: AnomalyOutcome;
  absolute: true;
};

export function rulesFor(kind: ObligationKind, scope: AnomalyScope): readonly AnomalyRule[] {
  return ANOMALY_CATALOG.filter((rule) => rule.appliesTo === kind && rule.scope === scope);
}

export function failureOutcome(rule: AnomalyRule, lineType?: ObligationLineType): AnomalyOutcome {
  if (lineType !== undefined && rule.escalatesOnLineTypes?.includes(lineType)) return "requires_approval";
  return rule.outcome;
}

export function isAbsoluteBlock(rule: AnomalyRule, lineType?: ObligationLineType): boolean {
  return rule.absolute && failureOutcome(rule, lineType) === "blocked";
}
