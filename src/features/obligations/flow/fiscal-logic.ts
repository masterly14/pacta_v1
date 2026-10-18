/**
 * Purpose: lógica pura de la plantilla fiscal que usa el flujo visual: reglas editables →
 *   plantilla activa validada, reloj de demo y conversión de montos. Mismo comportamiento que la
 *   guía de pasos de /platform/obligations/fiscal; no calcula impuestos, solo arma la plantilla.
 * Runs in: navegador, servidor y tests (puro).
 * Triggered by: flow/components/fiscal-flow.tsx.
 * Receives → Returns: (escenario, reglas) → RulesDraft; (plantilla base, reglas, versión) → plantilla activa | error.
 * Talks to: ../fiscal/schemas, ../../contracts/money.
 */
import { parseAmountToMinor } from "@/features/contracts/money";
import { FiscalTemplateSchema, type FiscalScenario, type FiscalTemplate } from "../fiscal/schemas";

export const DEMO_USER = "usuario_demo";
export const ACTIVATED_AT = "2026-11-01T15:00:00Z"; // antes de cualquier fecha del reloj de demo

// Reloj de demo: aviso temprano, aviso urgente y vencido. 14:00 UTC = mañana en Bogotá.
export const FISCAL_DATES = [
  { date: "2026-11-03", label: "3 nov · T-7" },
  { date: "2026-11-07", label: "7 nov · T-3" },
  { date: "2026-11-11", label: "11 nov · vencido" },
] as const;

export const asOfFor = (date: string) => `${date}T14:00:00Z`;

// Unidades menores → texto decimal para un campo editable. Sin floats.
export function toDecimal(amountMinor: number): string {
  return `${Math.trunc(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

// "30" o "12.5" → puntos básicos (3000, 1250), con la misma aritmética de texto que los montos.
export function percentToBps(value: string): number | null {
  const parsed = parseAmountToMinor(value, "USD");
  return parsed.ok ? parsed.amountMinor : null;
}

export type RulesDraft = {
  taxes: Record<string, { enabled: boolean; reference: string }>;
  provisionPercent: string; // vacío = sin regla de provisión
  tolerancePercent: string;
  runCap: string;
};

export function rulesFrom(scenario: FiscalScenario): RulesDraft {
  const taxes: RulesDraft["taxes"] = {};
  for (const item of scenario.snapshot.items) {
    const authorized = scenario.template.taxes.find((tax) => tax.fiscalType === item.fiscalType);
    taxes[item.fiscalType] = { enabled: authorized !== undefined, reference: authorized?.authorizedPaymentReference ?? "" };
  }
  return {
    taxes,
    provisionPercent: scenario.template.provisionBps === null ? "" : String(scenario.template.provisionBps / 100),
    tolerancePercent: String(scenario.template.varianceToleranceBps / 100),
    runCap: toDecimal(scenario.template.runCapMinor),
  };
}

export function buildFiscalTemplate(
  base: FiscalTemplate,
  rules: RulesDraft,
  version: number,
): { ok: true; template: FiscalTemplate } | { ok: false; error: string } {
  const tolerance = percentToBps(rules.tolerancePercent);
  if (tolerance === null) return { ok: false, error: "La tolerancia debe ser un porcentaje, por ejemplo 10." };
  const provision = rules.provisionPercent.trim() === "" ? null : percentToBps(rules.provisionPercent);
  if (rules.provisionPercent.trim() !== "" && (provision === null || provision === 0)) {
    return { ok: false, error: "La provisión debe ser un porcentaje mayor que 0, o quedar vacía." };
  }
  const cap = parseAmountToMinor(rules.runCap, base.currency);
  if (!cap.ok) return { ok: false, error: `Tope de la corrida: ${cap.error}` };
  const taxes = Object.entries(rules.taxes)
    .filter(([, tax]) => tax.enabled)
    .map(([fiscalType, tax]) => ({ fiscalType, authorizedPaymentReference: tax.reference.trim() }));
  const parsed = FiscalTemplateSchema.safeParse({
    ...base,
    version,
    status: "active",
    activatedBy: DEMO_USER,
    activatedAt: ACTIVATED_AT,
    taxes,
    varianceToleranceBps: tolerance,
    provisionBps: provision,
    runCapMinor: cap.amountMinor,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue.path[0] === "taxes" && issue.path.length === 1) return { ok: false, error: "Elige al menos un impuesto para vigilar." };
    if (issue.path.includes("authorizedPaymentReference")) return { ok: false, error: "Cada referencia de pago debe ir enmascarada, por ejemplo DIAN-****4410." };
    return { ok: false, error: issue.message };
  }
  return { ok: true, template: parsed.data };
}
