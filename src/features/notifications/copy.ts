/**
 * Purpose: Spanish wording shared by every notification channel (decision states and the reason a
 *   payment needs a person), so Slack and WhatsApp say the same thing in the same words.
 * Runs in: server (Node) only; pure.
 * Triggered by: channels/slack/blocks.ts and channels/whatsapp/templates.ts while rendering.
 * Receives → Returns: a decision outcome or reason codes → human-readable Spanish text.
 * Talks to: src/shared/schemas/payment-decision.ts (types only). No I/O.
 */
import type { DecisionOutcome, ReasonCode } from "@/shared/schemas/payment-decision";

// `aprobada` = aprobada para PAGO SIMULADO; nunca se dice "pagada".
export const DECISION_LABEL: Record<DecisionOutcome, string> = {
  aprobada: "Aprobada (pago simulado)",
  bloqueada: "Bloqueada",
  requiere_aprobacion: "Requiere aprobación",
};

export const REASON_LABEL: Record<ReasonCode, string> = {
  PROVEEDOR_NO_AUTORIZADO: "Proveedor sin autorización de pago",
  FACTURA_DUPLICADA: "Factura duplicada",
  MONTO_EXCEDE_LIMITE: "El monto supera el límite autorizado",
  PRESUPUESTO_INSUFICIENTE: "Presupuesto insuficiente",
  CONTRATO_NO_ENCONTRADO: "No hay contrato asociado",
  CONTRATO_NO_COINCIDE: "No coincide con el contrato",
  DATOS_INSUFICIENTES: "Datos incompletos en la factura",
  REQUIERE_APROBACION_HUMANA: "Requiere revisión de una persona",
  RECURRENCIA_NO_AUTORIZADA: "Pago recurrente no autorizado",
  REGLAS_AUTOAPROBACION_CUMPLIDAS: "Cumple todas las reglas de aprobación automática",
  BENEFICIARIO_CAMBIADO: "Cambió la cuenta del beneficiario",
  MONEDA_NO_SOPORTADA: "Moneda no soportada",
};

// El motivo genérico solo aporta cuando es el único; si hay causas concretas, se omite.
export function describeReasons(reasonCodes: readonly ReasonCode[]): string {
  const specific = reasonCodes.filter((code) => code !== "REQUIERE_APROBACION_HUMANA");
  const shown = specific.length > 0 ? specific : reasonCodes;
  return shown.map((code) => REASON_LABEL[code]).join("; ");
}
