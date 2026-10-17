"use client";
/**
 * Purpose: client forms for the policies page (supplier, policy version, authorization,
 *   revoke, approval permission, demo data); errors show inline and keep the typed values,
 *   successes clear the form or show a toast when the control disappears.
 * Runs in: browser (React client components).
 * Triggered by: rendered by /platform/policies; submits to the server actions.
 * Receives → Returns: props (suppliers, member, authorization id) → form UI.
 * Talks to: ../actions.ts (server actions), useFormAction, sonner toast, shadcn Button, Input, Label.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormAction } from "@/shared/forms/use-form-action";
import {
  createAuthorizationAction,
  createPolicyVersionAction,
  createSupplierAction,
  loadDemoDataAction,
  revokeAuthorizationAction,
  setApprovalPermissionAction,
  type ActionState,
} from "../actions";

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

export function SupplierForm() {
  const { state, pending, formRef, onSubmit } = useFormAction(createSupplierAction, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Nombre" htmlFor="supplier-name">
        <Input id="supplier-name" name="name" required maxLength={120} placeholder="Nube Hosting LLC" />
      </Field>
      <Field label="Cuenta conocida (opcional)" htmlFor="supplier-account">
        <Input id="supplier-account" name="beneficiaryAccountRef" placeholder="****1234" />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Agregar proveedor"}
      </Button>
      <div className="sm:col-span-3">
        <Result state={state} />
      </div>
    </form>
  );
}

export function PolicyVersionForm({ autoLimit, budget }: { autoLimit: string; budget: string }) {
  // Tras crear la versión, el reset deja los valores nuevos (los defaultValue se actualizan).
  const { state, pending, formRef, onSubmit } = useFormAction(createPolicyVersionAction, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Límite de aprobación automática (USD)" htmlFor="policy-limit">
        <Input id="policy-limit" name="autoApprovalLimitMinor" required inputMode="decimal" defaultValue={autoLimit} />
      </Field>
      <Field label="Presupuesto mensual (USD)" htmlFor="policy-budget">
        <Input id="policy-budget" name="monthlyBudgetMinor" required inputMode="decimal" defaultValue={budget} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Crear nueva versión"}
      </Button>
      <div className="sm:col-span-3">
        <Result state={state} />
      </div>
    </form>
  );
}

export function AuthorizationForm({ suppliers, today }: { suppliers: { id: string; name: string }[]; today: string }) {
  const [scope, setScope] = useState<"recurring" | "one_time">("recurring");
  const { state, pending, formRef, onSubmit } = useFormAction(createAuthorizationAction, {
    resetOnSuccess: true,
    onSuccess: () => setScope("recurring"),
  });
  if (suppliers.length === 0) {
    return <p className="text-sm text-muted-foreground">Agrega un proveedor antes de autorizar pagos.</p>;
  }
  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Proveedor" htmlFor="auth-supplier">
        <select id="auth-supplier" name="supplierId" required className={selectClass}>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Cuenta beneficiaria" htmlFor="auth-account">
        <Input id="auth-account" name="beneficiaryAccountRef" required placeholder="****1234" />
      </Field>
      <Field label="Monto máximo por factura (USD)" htmlFor="auth-max">
        <Input id="auth-max" name="maxAmountMinor" required inputMode="decimal" placeholder="1500.00" />
      </Field>
      <Field label="Alcance" htmlFor="auth-scope">
        <select
          id="auth-scope"
          name="scope"
          className={selectClass}
          value={scope}
          onChange={(event) => setScope(event.target.value as "recurring" | "one_time")}
        >
          <option value="recurring">Recurrente</option>
          <option value="one_time">Pago único</option>
        </select>
      </Field>
      {scope === "recurring" && (
        <Field label="Frecuencia" htmlFor="auth-frequency">
          <select id="auth-frequency" name="frequency" className={selectClass} defaultValue="monthly">
            <option value="weekly">Semanal</option>
            <option value="monthly">Mensual</option>
            <option value="quarterly">Trimestral</option>
            <option value="yearly">Anual</option>
          </select>
        </Field>
      )}
      <Field label="Vigente desde" htmlFor="auth-from">
        <Input id="auth-from" name="validFrom" type="date" required defaultValue={today} />
      </Field>
      <Field label="Vigente hasta" htmlFor="auth-until">
        <Input id="auth-until" name="validUntil" type="date" required />
      </Field>
      <div className="flex items-end">
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Guardando…" : "Autorizar"}
        </Button>
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <Result state={state} />
      </div>
    </form>
  );
}

export function RevokeAuthorizationButton({ authorizationId }: { authorizationId: string }) {
  // Al revocar, la fila deja de mostrar este botón: la confirmación va en un toast.
  const { state, pending, onSubmit } = useFormAction(revokeAuthorizationAction, {
    onSuccess: (result) => toast.success(result.message),
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-end gap-1">
      <input type="hidden" name="authorizationId" value={authorizationId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Revocando…" : "Revocar"}
      </Button>
      {state !== null && !state.ok && <Result state={state} />}
    </form>
  );
}

export function PermissionForm({
  userId,
  canApprove,
  approvalLimit,
  canManagePolicies,
}: {
  userId: string;
  canApprove: boolean;
  approvalLimit: string;
  canManagePolicies: boolean;
}) {
  // Sin reset: el formulario muestra los permisos guardados.
  const { state, pending, onSubmit } = useFormAction(setApprovalPermissionAction);
  const [approve, setApprove] = useState(canApprove);
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="userId" value={userId} />
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" name="canApprove" checked={approve} onChange={(event) => setApprove(event.target.checked)} />
        Aprueba
      </label>
      {approve && (
        <Input
          name="approvalLimitMinor"
          aria-label="Límite de aprobación (USD)"
          required
          inputMode="decimal"
          defaultValue={approvalLimit}
          placeholder="Límite USD"
          className="w-32"
        />
      )}
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" name="canManagePolicies" defaultChecked={canManagePolicies} />
        Gestiona políticas
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
      <Result state={state} />
    </form>
  );
}

export function LoadDemoDataButton() {
  // La tarjeta desaparece en cuanto la organización tiene datos: la confirmación va en un toast.
  const { state, pending, onSubmit } = useFormAction(loadDemoDataAction, {
    onSuccess: (result) => toast.success(result.message),
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Cargando…" : "Cargar datos demo"}
      </Button>
      <Result state={state} />
    </form>
  );
}
