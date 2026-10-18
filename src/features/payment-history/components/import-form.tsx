"use client";
/**
 * Purpose: CSV upload form for /platform/payment-history.
 * Runs in: browser.
 * Triggered by: the payment history page, for organization admins.
 * Receives → Returns: nothing → a file field and the server's summary.
 * Talks to: ../actions.ts, useFormAction, shadcn Button and Input.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormAction } from "@/shared/forms/use-form-action";
import { importBankCsvAction, type ActionState } from "../actions";

export function ImportCsvForm() {
  const { state, pending, formRef, onSubmit } = useFormAction(importBankCsvAction, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="bank-csv">Archivo CSV</Label>
        <Input id="bank-csv" name="file" type="file" accept=".csv,text/csv" required />
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Importando…" : "Importar"}
        </Button>
      </div>
      <ImportResult state={state} />
    </form>
  );
}

function ImportResult({ state }: { state: ActionState }) {
  if (state === null) return null;
  return (
    <p role="status" className={state.ok ? "text-sm text-emerald-600" : "text-sm text-destructive"}>
      {state.message}
    </p>
  );
}
