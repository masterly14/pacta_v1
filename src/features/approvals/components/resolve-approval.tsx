"use client";
/**
 * Purpose: Approve / Reject controls for one pending request, with an optional comment and an
 *   optional recurring authorization for the supplier's future invoices.
 * Runs in: browser (React client component).
 * Triggered by: rendered per pending request on /platform/approvals for people who can approve.
 * Receives → Returns: props (request id, invoice defaults, permissions) → form UI.
 * Talks to: ../actions.ts#resolveApprovalAction, useFormAction, sonner toast, shadcn Button, Input, Label.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormAction } from "@/shared/forms/use-form-action";
import { resolveApprovalAction } from "../actions";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ResolveApproval({
  approvalRequestId,
  defaults,
  canAuthorize,
  canApproveThis,
}: {
  approvalRequestId: string;
  defaults: { account: string; maxAmount: string; validFrom: string; validUntil: string };
  canAuthorize: boolean;
  canApproveThis: boolean; // false si la solicitud no guarda los datos para revalidar
}) {
  const [authorize, setAuthorize] = useState(false);
  // Al resolverse, la fila desaparece de la lista: el resultado va en un toast. Un bloqueo al
  // revalidar también resuelve la solicitud (mensaje con 🔴) y se muestra como error.
  const { state, pending, onSubmit } = useFormAction(resolveApprovalAction, {
    onSuccess: (result) => (result.message.startsWith("🔴") ? toast.error(result.message) : toast.success(result.message)),
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <input type="hidden" name="approvalRequestId" value={approvalRequestId} />
      <Input name="comment" maxLength={1000} placeholder="Comentario (opcional)" aria-label="Comentario" />

      {canAuthorize && (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="authorize" checked={authorize} onChange={(e) => setAuthorize(e.target.checked)} />
          Al aprobar, autorizar también sus facturas futuras
        </label>
      )}
      {authorize && (
        <div className="grid grid-cols-2 gap-2 rounded-lg border p-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`acc-${approvalRequestId}`} className="text-xs">Cuenta</Label>
            <Input id={`acc-${approvalRequestId}`} name="authAccount" defaultValue={defaults.account} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`max-${approvalRequestId}`} className="text-xs">Máximo por factura (USD)</Label>
            <Input id={`max-${approvalRequestId}`} name="authMaxAmount" inputMode="decimal" defaultValue={defaults.maxAmount} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`freq-${approvalRequestId}`} className="text-xs">Frecuencia</Label>
            <select id={`freq-${approvalRequestId}`} name="authFrequency" className={selectClass} defaultValue="monthly">
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensual</option>
              <option value="quarterly">Trimestral</option>
              <option value="yearly">Anual</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`from-${approvalRequestId}`} className="text-xs">Vigente desde</Label>
            <Input id={`from-${approvalRequestId}`} name="authValidFrom" type="date" defaultValue={defaults.validFrom} />
          </div>
          <div className="col-span-2 flex flex-col gap-1">
            <Label htmlFor={`until-${approvalRequestId}`} className="text-xs">Vigente hasta</Label>
            <Input id={`until-${approvalRequestId}`} name="authValidUntil" type="date" defaultValue={defaults.validUntil} />
          </div>
        </div>
      )}

      <div className="flex gap-2">
        {canApproveThis && (
          <Button type="submit" name="action" value="approve" size="sm" disabled={pending}>
            {pending ? "Revalidando…" : "Aprobar"}
          </Button>
        )}
        <Button type="submit" name="action" value="reject" size="sm" variant="outline" disabled={pending}>
          Rechazar
        </Button>
      </div>
      {state !== null && !state.ok && (
        <p role="status" className="text-xs text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}
