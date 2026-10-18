/**
 * Purpose: etiquetas de resultado para los flujos de obligaciones (nómina e impuestos), con el
 *   mismo vocabulario en ambos. Solo presentación: no cambia ninguna decisión.
 * Runs in: servidor y navegador (constantes puras).
 * Triggered by: fiscal-flow.tsx y payroll-flow.tsx.
 * Receives → Returns: decisión → etiqueta y variante de insignia.
 * Talks to: nada.
 */
export type FlowDecision = "approved" | "requires_approval" | "blocked";

export const FLOW_OUTCOME: Record<FlowDecision, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  approved: { label: "Aprobada para pago", variant: "default" },
  requires_approval: { label: "Requiere aprobación", variant: "secondary" },
  blocked: { label: "Bloqueada", variant: "destructive" },
};
