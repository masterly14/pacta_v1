"use client";
/**
 * Purpose: panel "Probar": evalúa el flujo actual (aunque sea un borrador) contra una factura de
 *   prueba y devuelve la traza para resaltar el camino en el canvas. No guarda nada.
 * Runs in: browser; la evaluación corre en el servidor (simulateFlowAction).
 * Triggered by: la pestaña "Probar" del editor.
 * Receives → Returns: (graph JSON, onResult) → formulario + resultado legible.
 * Talks to: ../../flow/actions.ts, ../../money.ts, shadcn Button, Input, Label.
 */
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { simulateFlowAction } from "../../flow/actions";
import type { FlowEvaluation } from "../../flow/evaluate";
import { parseAmountToMinor, SUPPORTED_CURRENCIES } from "../../money";

const STATUS_COPY = {
  matched: { text: "Coincide con el contrato", className: "text-emerald-600" },
  mismatch: { text: "No coincide: se escalaría", className: "text-destructive" },
  ambiguous: { text: "Ambiguo: faltan datos, se escalaría", className: "text-amber-600" },
} as const;

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function SimulatorPanel({
  graph,
  disabledReason,
  today,
  onResult,
}: {
  graph: unknown;
  disabledReason: string | null;
  today: string;
  onResult: (evaluation: FlowEvaluation | null) => void;
}) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [invoiceDate, setInvoiceDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [account, setAccount] = useState("");
  const [milestones, setMilestones] = useState("");
  const [evaluation, setEvaluation] = useState<FlowEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    let amountMinor: number | null = null;
    if (amount.trim() !== "") {
      const parsed = parseAmountToMinor(amount, currency);
      if (!parsed.ok) return setError(parsed.error);
      amountMinor = parsed.amountMinor;
    }
    const delivered = milestones.split(",").map((m) => m.trim()).filter(Boolean);
    startTransition(async () => {
      const result = await simulateFlowAction(graph, {
        amountMinor,
        currency: currency || null,
        invoiceDate: invoiceDate || null,
        dueDate: dueDate || null,
        beneficiaryAccountReference: account.trim() || null,
        deliveredMilestones: milestones.trim() === "" ? null : delivered,
      });
      if (!result.ok) {
        setError(result.message);
        setEvaluation(null);
        onResult(null);
        return;
      }
      setEvaluation(result.evaluation);
      onResult(result.evaluation);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Factura de prueba (datos ficticios). Deja un campo vacío para simular que la factura no lo trae.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sim-amount">Monto</Label>
          <Input id="sim-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1500.00" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sim-currency">Moneda</Label>
          <select id="sim-currency" className={selectClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sim-date">Fecha factura</Label>
          <Input id="sim-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sim-due">Vencimiento</Label>
          <Input id="sim-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sim-account">Cuenta de pago</Label>
        <Input id="sim-account" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="****1234" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sim-milestones">Hitos entregados (separados por coma)</Label>
        <Input id="sim-milestones" value={milestones} onChange={(e) => setMilestones(e.target.value)} placeholder="Entrega" />
      </div>
      <Button onClick={run} disabled={pending || disabledReason !== null} size="sm">
        {pending ? "Evaluando…" : "Probar flujo"}
      </Button>
      {disabledReason !== null && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
      {error !== null && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {evaluation !== null && (
        <div className="flex flex-col gap-2 rounded-lg border p-3" role="status">
          <p className={`text-sm font-medium ${STATUS_COPY[evaluation.status].className}`}>{STATUS_COPY[evaluation.status].text}</p>
          <ol className="flex flex-col gap-1 text-xs text-muted-foreground">
            {evaluation.trace.map((step, i) => (
              <li key={`${step.nodeId}-${i}`}>
                <span className="font-medium text-foreground">{i + 1}.</span> {step.note}
              </li>
            ))}
          </ol>
          <p className="text-[0.7rem] text-muted-foreground">Un contrato que coincide es evidencia: no autoriza ningún pago.</p>
        </div>
      )}
    </div>
  );
}
