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
  { id: "papeleria_ok", label: "Papelería Central · $45.90 (1ª del mes)", expected: "approved", reasons: ["AUTO_APPROVAL_RULES_PASSED"] },
  { id: "papeleria_duplicate", label: "Papelería · mismo número otra vez", expected: "blocked", reasons: ["DUPLICATE_INVOICE"] },
  { id: "papeleria_over_limit", label: "Papelería · $150.00 (sobre el máximo)", expected: "requires_approval", reasons: ["AMOUNT_LIMIT_EXCEEDED"] },
  { id: "papeleria_second_this_month", label: "Papelería · 2ª factura del mes", expected: "requires_approval", reasons: ["SUPPLIER_NOT_AUTHORIZED"] },
  { id: "papeleria_new_account", label: "Papelería · cuenta cambiada", expected: "requires_approval", reasons: ["BENEFICIARY_CHANGED"] },
  { id: "nube_recurring", label: "Nube Hosting · $1,500 sin autorización", expected: "requires_approval", reasons: ["SUPPLIER_NOT_AUTHORIZED", "RECURRENCE_NOT_AUTHORIZED"] },
  { id: "nube_contract_mismatch", label: "Nube Hosting · $1,600 (contrato $1,500)", expected: "requires_approval", reasons: ["CONTRACT_MISMATCH"] },
  { id: "eur_invoice", label: "Diseño Studio · 820.00 EUR", expected: "requires_approval", reasons: ["CURRENCY_NOT_SUPPORTED"] },
  { id: "missing_amount", label: "Diseño Studio · sin monto", expected: "requires_approval", reasons: ["INSUFFICIENT_DATA"] },
  { id: "extraction_warning", label: "Diseño Studio · advertencia de extracción", expected: "requires_approval", reasons: ["INSUFFICIENT_DATA"] },
] as const;

export type DemoScenarioId = (typeof DEMO_SCENARIOS)[number]["id"];

export function isDemoScenario(value: string): value is DemoScenarioId {
  return DEMO_SCENARIOS.some((s) => s.id === value);
}
