"use client";
/**
 * Purpose: client forms for invoices: manual upload (PDF, image or pasted text) and retry of a
 *   failed email invoice; results show inline and keep the input after an error.
 * Runs in: browser (React client components).
 * Triggered by: rendered on /platform/invoices and /platform/invoices/[id].
 * Receives → Returns: props (invoice id) → form UI.
 * Talks to: ../actions.ts (uploadInvoiceAction, retryInvoiceAction), useFormAction, shadcn Button,
 *   Input, Label, Textarea.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useFormAction } from "@/shared/forms/use-form-action";
import { retryInvoiceAction, uploadInvoiceAction } from "../actions";

function Result({ state }: { state: { ok: boolean; message: string } | null }) {
  if (state === null) return null;
  return (
    <p role="status" className={state.ok ? "text-sm" : "text-sm text-destructive"}>
      {state.message}
    </p>
  );
}

export function UploadInvoiceForm() {
  const { state, pending, formRef, onSubmit } = useFormAction(uploadInvoiceAction, { resetOnSuccess: true });
  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invoice-file">Archivo (PDF, JPEG, PNG o WEBP, hasta 10 MB)</Label>
          <Input id="invoice-file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invoice-text">…o pega el texto de la factura</Label>
          <Textarea id="invoice-text" name="text" rows={3} placeholder="Factura F-2041 · Proveedor: … · Total: 1500.00 USD" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Procesando con IA…" : "Procesar factura"}
        </Button>
        <Result state={state} />
      </div>
    </form>
  );
}

export function RetryInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const { state, pending, onSubmit } = useFormAction(retryInvoiceAction);
  return (
    <form onSubmit={onSubmit} className="flex flex-col items-start gap-1">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Reintentando…" : "Reintentar"}
      </Button>
      <Result state={state} />
    </form>
  );
}
