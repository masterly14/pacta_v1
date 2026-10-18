"use client";
/**
 * Purpose: run fictitious invoices through the real decision flow: fixed scenarios (with
 *   their expected result) and a "Factura de prueba" form for any combination of values.
 * Runs in: browser (React client components).
 * Triggered by: rendered on /platform/audit for administrators.
 * Receives → Returns: props (suppliers, today) → simulator UI.
 * Talks to: ../actions.ts (simulateInvoiceAction, evaluateCustomInvoiceAction), useFormAction,
 *   contracts/money#SUPPORTED_CURRENCIES, shadcn Button, Badge, Input, Label.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SUPPORTED_CURRENCIES } from "@/features/contracts/money";
import { useFormAction } from "@/shared/forms/use-form-action";
import { evaluateCustomInvoiceAction, simulateInvoiceAction } from "../actions";
import { DEMO_SCENARIOS } from "../fixtures/scenarios";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const EXPECTED = {
  aprobada: { label: "aprobada", variant: "default" },
  bloqueada: { label: "bloqueada", variant: "destructive" },
  requiere_aprobacion: { label: "requiere aprobación", variant: "secondary" },
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
        <p role="status" className={state.ok ? "text-xs" : "text-xs text-destructive"}>
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

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

// Conserva los valores tras evaluar: se puede cambiar un campo y volver a probar.
export function CustomInvoiceForm({ suppliers, today }: { suppliers: { id: string; name: string }[]; today: string }) {
  const { state, pending, onSubmit } = useFormAction(evaluateCustomInvoiceAction);
  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Proveedor" htmlFor="test-supplier">
        <select id="test-supplier" name="supplierId" className={selectClass} defaultValue={suppliers[0]?.id ?? ""}>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value="">— Proveedor no reconocido —</option>
        </select>
      </Field>
      <Field label="Número de factura (vacío = falta)" htmlFor="test-number">
        <Input id="test-number" name="invoiceNumber" placeholder="PC-1042" />
      </Field>
      <Field label="Monto (vacío = falta)" htmlFor="test-amount">
        <Input id="test-amount" name="amount" inputMode="decimal" placeholder="45.90" />
      </Field>
      <Field label="Moneda" htmlFor="test-currency">
        <select id="test-currency" name="currency" className={selectClass} defaultValue="USD">
          {SUPPORTED_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Cuenta beneficiaria (vacío = falta)" htmlFor="test-account">
        <Input id="test-account" name="beneficiaryAccountReference" placeholder="****4821" />
      </Field>
      <Field label="Fecha de factura" htmlFor="test-date">
        <Input id="test-date" name="invoiceDate" type="date" defaultValue={today} />
      </Field>
      <Field label="Descripción (opcional)" htmlFor="test-description">
        <Input id="test-description" name="description" placeholder="Papelería de oficina" />
      </Field>
      <label className="flex items-end gap-2 pb-1.5 text-sm">
        <input type="checkbox" name="withWarning" />
        Simular advertencia de extracción
      </label>
      <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-4">
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Evaluando…" : "Evaluar factura de prueba"}
          </Button>
        </div>
        {state !== null && (
          <p role="status" className={state.ok ? "text-sm" : "text-sm text-destructive"}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
