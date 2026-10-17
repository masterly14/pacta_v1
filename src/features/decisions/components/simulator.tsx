"use client";
/**
 * Purpose: buttons that run fictitious invoice scenarios through the real decision flow,
 *   showing the expected result next to each and the actual result after running it.
 * Runs in: browser (React client component).
 * Triggered by: rendered on /platform/audit for administrators.
 * Receives → Returns: nothing (scenarios are static) → simulator UI.
 * Talks to: ../actions.ts#simulateInvoiceAction, useFormAction, shadcn Button, Badge.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useFormAction } from "@/shared/forms/use-form-action";
import { simulateInvoiceAction } from "../actions";
import { DEMO_SCENARIOS } from "../fixtures/scenarios";

const EXPECTED = {
  approved: { label: "aprobada", variant: "default" },
  blocked: { label: "bloqueada", variant: "destructive" },
  requires_approval: { label: "requiere aprobación", variant: "secondary" },
} as const;

function ScenarioButton({ id, label, expected }: (typeof DEMO_SCENARIOS)[number]) {
  const { state, pending, onSubmit } = useFormAction(simulateInvoiceAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1.5 rounded-lg border p-3">
      <input type="hidden" name="scenario" value={id} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Badge variant={EXPECTED[expected].variant}>esperado: {EXPECTED[expected].label}</Badge>
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Evaluando…" : "Evaluar"}
      </Button>
      {state !== null && (
        <p role="status" className={state.ok ? "text-xs text-emerald-600" : "text-xs text-destructive"}>
          {state.message}
        </p>
      )}
    </form>
  );
}

export function DecisionSimulator() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {DEMO_SCENARIOS.map((scenario) => (
        <ScenarioButton key={scenario.id} {...scenario} />
      ))}
    </div>
  );
}
