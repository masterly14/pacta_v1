/**
 * Purpose: the list of fictitious invoice scenarios for the simulator, with the expected result
 *   and the reason code each one is meant to show.
 * Runs in: anywhere (static data; safe to import from client components).
 * Triggered by: components/simulator.tsx (buttons), demo-invoices.ts and actions.ts (validation).
 * Receives → Returns: nothing → DEMO_SCENARIOS, isDemoScenario(value).
 * Talks to: nothing.
 */

// `reasons`: al menos uno debe aparecer en la decisión (Nube puede variar si hay historial CSV).
export const DEMO_SCENARIOS = [
  { id: "papeleria_ok", label: "Papelería Central · $45.90 (1ª del mes)", expected: "aprobada", reasons: ["REGLAS_AUTOAPROBACION_CUMPLIDAS"] },
  { id: "papeleria_duplicate", label: "Papelería · mismo número otra vez", expected: "bloqueada", reasons: ["FACTURA_DUPLICADA"] },
  { id: "papeleria_over_limit", label: "Papelería · $150.00 (sobre el máximo)", expected: "requiere_aprobacion", reasons: ["MONTO_EXCEDE_LIMITE"] },
  { id: "papeleria_second_this_month", label: "Papelería · 2ª factura del mes", expected: "requiere_aprobacion", reasons: ["PROVEEDOR_NO_AUTORIZADO"] },
  { id: "papeleria_new_account", label: "Papelería · cuenta cambiada", expected: "requiere_aprobacion", reasons: ["BENEFICIARIO_CAMBIADO"] },
  { id: "nube_recurring", label: "Nube Hosting · $1,500 sin autorización", expected: "requiere_aprobacion", reasons: ["PROVEEDOR_NO_AUTORIZADO", "RECURRENCIA_NO_AUTORIZADA"] },
  { id: "nube_contract_mismatch", label: "Nube Hosting · $1,600 (contrato $1,500)", expected: "requiere_aprobacion", reasons: ["CONTRATO_NO_COINCIDE"] },
  { id: "eur_invoice", label: "Diseño Studio · 820.00 EUR", expected: "requiere_aprobacion", reasons: ["MONEDA_NO_SOPORTADA"] },
  { id: "missing_amount", label: "Diseño Studio · sin monto", expected: "requiere_aprobacion", reasons: ["DATOS_INSUFICIENTES"] },
  { id: "extraction_warning", label: "Diseño Studio · advertencia de extracción", expected: "requiere_aprobacion", reasons: ["DATOS_INSUFICIENTES"] },
] as const;

export type DemoScenarioId = (typeof DEMO_SCENARIOS)[number]["id"];

export function isDemoScenario(value: string): value is DemoScenarioId {
  return DEMO_SCENARIOS.some((s) => s.id === value);
}
