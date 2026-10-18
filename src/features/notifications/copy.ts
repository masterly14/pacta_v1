/**
 * Purpose: Spanish wording shared by every notification channel (decision states and the reason a
 *   payment needs a person), so Slack and WhatsApp say the same thing in the same words.
 * Runs in: server (Node) only; pure.
 * Triggered by: channels/slack/blocks.ts and channels/whatsapp/templates.ts while rendering.
 * Receives → Returns: a decision outcome or reason codes → human-readable Spanish text.
 * Talks to: src/shared/schemas/payment-decision.ts (types only). No I/O.
 */
import type { DecisionOutcome, ReasonCode } from "@/shared/schemas/payment-decision";

// `approved` = aprobada para PAGO SIMULADO; nunca se dice "pagada".
export const DECISION_LABEL: Record<DecisionOutcome, string> = {
  approved: "Aprobada (pago simulado)",
  blocked: "Bloqueada",
  requires_approval: "Requiere aprobación",
};

export const REASON_LABEL: Record<ReasonCode, string> = {
  SUPPLIER_NOT_AUTHORIZED: "Proveedor sin autorización de pago",
  DUPLICATE_INVOICE: "Factura duplicada",
  AMOUNT_LIMIT_EXCEEDED: "El monto supera el límite autorizado",
  BUDGET_INSUFFICIENT: "Presupuesto insuficiente",
  CONTRACT_NOT_FOUND: "No hay contrato asociado",
  CONTRACT_MISMATCH: "No coincide con el contrato",
  INSUFFICIENT_DATA: "Datos incompletos en la factura",
  HUMAN_APPROVAL_REQUIRED: "Requiere revisión de una persona",
  RECURRENCE_NOT_AUTHORIZED: "Pago recurrente no autorizado",
  AUTO_APPROVAL_RULES_PASSED: "Cumple todas las reglas de aprobación automática",
  BENEFICIARY_CHANGED: "Cambió la cuenta del beneficiario",
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

// El motivo genérico solo aporta cuando es el único; si hay causas concretas, se omite.
export function describeReasons(reasonCodes: readonly ReasonCode[]): string {
  const specific = reasonCodes.filter((code) => code !== "HUMAN_APPROVAL_REQUIRED");
  const shown = specific.length > 0 ? specific : reasonCodes;
  return shown.map((code) => REASON_LABEL[code]).join("; ");
}
