/**
 * Purpose: Spanish display labels for the engine's identifiers (reason codes, rule ids). Stored
 *   values stay in English; only what people read is translated.
 * Runs in: anywhere (pure constants).
 * Triggered by: dashboard, approvals, audit and invoice detail pages.
 * Receives → Returns: ReasonCode / ruleId → label.
 * Talks to: shared PaymentDecision schema (types only).
 */
import type { ReasonCode } from "@/shared/schemas/payment-decision";

export const REASON_LABEL: Record<ReasonCode, string> = {
  SUPPLIER_NOT_AUTHORIZED: "Proveedor sin autorización",
  DUPLICATE_INVOICE: "Factura duplicada",
  AMOUNT_LIMIT_EXCEEDED: "Monto sobre el límite",
  BUDGET_INSUFFICIENT: "Presupuesto insuficiente",
  CONTRACT_NOT_FOUND: "Sin contrato",
  CONTRACT_MISMATCH: "No coincide con el contrato",
  INSUFFICIENT_DATA: "Datos incompletos",
  HUMAN_APPROVAL_REQUIRED: "Requiere aprobación humana",
  RECURRENCE_NOT_AUTHORIZED: "Recurrencia sin autorizar",
  AUTO_APPROVAL_RULES_PASSED: "Reglas cumplidas",
  BENEFICIARY_CHANGED: "Cambio de cuenta beneficiaria",
  CURRENCY_NOT_SUPPORTED: "Moneda no soportada",
  EMPLOYEE_TERMINATED: "Empleado desvinculado",
  EMPLOYEE_NOT_FOUND: "Empleado no encontrado",
  PAYROLL_OMISSION: "Nómina incompleta",
  VARIANCE_EXCEEDED: "Variación sobre la tolerancia",
  BENEFIT_MISMATCH: "Beneficio no coincide",
  DUPLICATE_LINE: "Línea duplicada",
  FUNDS_INSUFFICIENT: "Fondos insuficientes",
  OBLIGATION_NOT_AUTHORIZED: "Obligación sin autorizar",
  SETTLEMENT_UNCONFIRMED: "Liquidación sin confirmar",
  SETTLEMENT_AMOUNT_MISMATCH: "Monto distinto de la liquidación",
  DEADLINE_PASSED: "Plazo vencido",
  DEADLINE_AT_RISK: "Plazo en riesgo",
  STALE_EVIDENCE: "Evidencia desactualizada",
  SIGNAL_PENDING_REVIEW: "Señal pendiente de revisión",
};

// Un id de regla desconocido (decisiones antiguas) se muestra tal cual.
const RULE_LABELS: Record<string, string> = {
  essential_fields_present: "Datos esenciales",
  no_extraction_warnings: "Lectura sin advertencias",
  currency_supported: "Moneda admitida",
  not_duplicate: "No es duplicada",
  supplier_authorized: "Proveedor autorizado",
  beneficiary_matches_authorization: "Cuenta beneficiaria autorizada",
  within_authorization_limit: "Dentro del máximo autorizado",
  within_policy_auto_limit: "Dentro del límite automático",
  contract_consistent: "Coherente con el contrato",
  budget_available: "Presupuesto disponible",
};

export function ruleLabel(ruleId: string): string {
  return RULE_LABELS[ruleId] ?? ruleId;
}
