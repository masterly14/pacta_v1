/**
 * Purpose: Spanish labels for the fiscal preview UI: reason codes, outcomes, tax types and
 *   rule ids. Display only; nothing here affects a decision.
 * Runs in: server and client (pure constants).
 * Triggered by: the fiscal preview page (/platform/obligations/fiscal).
 * Receives → Returns: code → label (and badge variant for outcomes).
 * Talks to: ./schemas.ts (types only).
 */
import type { FiscalOutcome, FiscalReasonCode, FiscalType } from "./schemas";

export const FISCAL_REASON: Record<FiscalReasonCode, string> = {
  AUTO_APPROVAL_RULES_PASSED: "Reglas cumplidas",
  HUMAN_APPROVAL_REQUIRED: "Requiere aprobación humana",
  INSUFFICIENT_DATA: "Datos incompletos",
  BENEFICIARY_CHANGED: "Referencia de pago cambiada",
  OBLIGATION_NOT_AUTHORIZED: "Obligación sin autorizar",
  STALE_EVIDENCE: "Evidencia contable no vigente",
  SETTLEMENT_UNCONFIRMED: "Liquidación sin confirmar",
  SETTLEMENT_AMOUNT_MISMATCH: "Monto distinto de la liquidación",
  VARIANCE_EXCEEDED: "Variación sobre la tolerancia",
  DUPLICATE_LINE: "Periodo ya pagado",
  DEADLINE_PASSED: "Plazo vencido",
  DEADLINE_AT_RISK: "Plazo en riesgo",
  FUNDS_INSUFFICIENT: "Fondos insuficientes",
  PROVISION_EXCEEDED: "Supera la provisión",
};

export const FISCAL_OUTCOME: Record<FiscalOutcome, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  approved: { label: "Aprobada (pago simulado)", variant: "default" },
  requires_approval: { label: "Requiere aprobación", variant: "secondary" },
  blocked: { label: "Bloqueada", variant: "destructive" },
};

export const FISCAL_TYPE: Record<FiscalType, string> = {
  vat: "IVA",
  withholding: "Retención en la fuente",
  ica: "ICA",
  social_security: "Seguridad social",
  parafiscal: "Parafiscales",
};

export const FISCAL_RULE: Record<string, string> = {
  obligacion_autorizada: "Plantilla activa y autorizada",
  datos_completos: "Borrador completo",
  evidencia_vigente: "Contabilidad vigente",
  periodo_contable_cerrado: "Mes contable cerrado",
  liquidacion_confirmada: "Liquidación confirmada",
  monto_coincide_con_liquidacion: "Borrador = liquidación",
  variacion_vs_periodos_previos: "Variación vs. periodo anterior",
  referencia_pago_estable: "Referencia de pago autorizada",
  periodo_no_pagado: "Periodo no pagado",
  dentro_de_plazo: "Dentro del plazo",
  fondos_suficientes: "Fondos para la línea",
  fondos_corrida: "Fondos para la corrida",
  tope_corrida: "Tope de la plantilla",
  provision_suficiente: "Dentro de la provisión",
};
