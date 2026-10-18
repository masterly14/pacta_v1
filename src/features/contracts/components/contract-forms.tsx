"use client";
/**
 * Purpose: client forms for the contracts page (register a contract, terminate one); errors
 *   show inline and keep the typed values, successes clear the form or show a toast.
 * Runs in: browser (React client components).
 * Triggered by: rendered by /platform/contracts; submits to the server actions.
 * Receives → Returns: props (suppliers, today, contract id) → form UI.
 * Talks to: ../actions.ts (server actions), ../money.ts (currency list), useFormAction,
 *   sonner toast, shadcn Button, Input, Label.
 */
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormAction } from "@/shared/forms/use-form-action";
import { createContractAction, terminateContractAction, type ActionState } from "../actions";
import { SUPPORTED_CURRENCIES } from "../money";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function Result({ state }: { state: ActionState }) {
  if (state === null) return null;
  return (
    <p role="status" className={state.ok ? "text-sm text-emerald-600" : "text-sm text-destructive"}>
      {state.message}
    </p>
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

export function ContractForm({
  suppliers,
  today,
  onCreated,
  compact = false,
}: {
  suppliers: { id: string; name: string }[];
  today: string;
  onCreated?: () => void; // p. ej. cerrar el modal donde se muestra el formulario
  compact?: boolean; // dos columnas en lugar de cuatro, para espacios angostos
}) {
  const { state, pending, formRef, onSubmit } = useFormAction(createContractAction, {
    resetOnSuccess: true,
    onSuccess: (result) => {
      if (onCreated === undefined) return;
      toast.success(result.message);
      onCreated();
    },
  });
  if (suppliers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Agrega un proveedor en Políticas antes de registrar contratos.
      </p>
    );
  }
  return (
    <form ref={formRef} onSubmit={onSubmit} className={compact ? "grid gap-3 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-4"}>
      <Field label="Proveedor" htmlFor="contract-supplier">
        <select id="contract-supplier" name="supplierId" required className={selectClass}>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Monto acordado por factura" htmlFor="contract-amount">
        <Input id="contract-amount" name="agreedAmount" required inputMode="decimal" placeholder="20.00" />
      </Field>
      <Field label="Moneda" htmlFor="contract-currency">
        <select id="contract-currency" name="currency" required className={selectClass} defaultValue="USD">
          {SUPPORTED_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Frecuencia" htmlFor="contract-frequency">
        <select id="contract-frequency" name="frequency" className={selectClass} defaultValue="monthly">
          <option value="one_time">Pago único</option>
          <option value="weekly">Semanal</option>
          <option value="monthly">Mensual</option>
          <option value="quarterly">Trimestral</option>
          <option value="yearly">Anual</option>
        </select>
      </Field>
      <Field label="Vigente desde" htmlFor="contract-from">
        <Input id="contract-from" name="validFrom" type="date" required defaultValue={today} />
      </Field>
      <Field label="Vigente hasta (opcional)" htmlFor="contract-to">
        <Input id="contract-to" name="validTo" type="date" />
      </Field>
      <Field label="Cuenta beneficiaria (opcional)" htmlFor="contract-account">
        <Input id="contract-account" name="beneficiaryAccountRef" placeholder="****1234" />
      </Field>
      <Field label="Descripción (opcional)" htmlFor="contract-description">
        <Input id="contract-description" name="description" maxLength={500} placeholder="Plan Pro mensual" />
      </Field>
      <div className={compact ? "flex items-end sm:col-span-2" : "flex items-end sm:col-span-2 lg:col-span-4"}>
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Registrar contrato"}
        </Button>
      </div>
      <div className={compact ? "sm:col-span-2" : "sm:col-span-2 lg:col-span-4"}>
        <Result state={state} />
      </div>
    </form>
  );
}

export function TerminateContractButton({ contractId }: { contractId: string }) {
  // Al terminar, la fila deja de mostrar este botón: la confirmación va en un toast.
  const { state, pending, onSubmit } = useFormAction(terminateContractAction, {
    onSuccess: (result) => toast.success(result.message),
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-end gap-1">
      <input type="hidden" name="contractId" value={contractId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Terminando…" : "Terminar"}
      </Button>
      {state !== null && !state.ok && <Result state={state} />}
    </form>
  );
}
