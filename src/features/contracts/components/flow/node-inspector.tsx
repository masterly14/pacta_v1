"use client";
/**
 * Purpose: formulario de propiedades del nodo seleccionado. Cada cambio produce un `data` nuevo
 *   del grafo; el validador del editor decide si el conjunto sigue siendo correcto.
 * Runs in: browser.
 * Triggered by: el panel derecho del editor cuando hay un nodo seleccionado.
 * Receives → Returns: (tipo, data, onChange) → formulario; montos en decimal ↔ unidades menores.
 * Talks to: ../../money.ts (parseAmountToMinor, currencyScale, SUPPORTED_CURRENCIES), shadcn Input, Label.
 */
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FlowNode } from "../../flow/schema";
import { currencyScale, parseAmountToMinor, SUPPORTED_CURRENCIES } from "../../money";
import { END_LABEL, FREQUENCY_LABEL, OP_OPTIONS } from "./flow-model";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint !== undefined && <p className="text-[0.7rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function toDecimal(minor: number, currency: string): string {
  const scale = currencyScale(currency);
  if (scale === null || scale === 0) return String(minor);
  const digits = String(minor).padStart(scale + 1, "0");
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

// Campo de dinero: se escribe en decimal y se guarda en unidades menores enteras.
function MoneyField({ label, minor, currency, onChange }: { label: string; minor: number; currency: string; onChange: (minor: number) => void }) {
  const [text, setText] = useState(() => toDecimal(minor, currency));
  const [error, setError] = useState<string | null>(null);
  return (
    <Field label={label}>
      <Input
        value={text}
        inputMode="decimal"
        aria-invalid={error !== null}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseAmountToMinor(e.target.value, currency);
          if (parsed.ok) {
            setError(null);
            onChange(parsed.amountMinor);
          } else {
            setError(parsed.error);
          }
        }}
      />
      {error !== null && <p className="text-[0.7rem] text-destructive">{error}</p>}
    </Field>
  );
}

type Props<T extends FlowNode["type"]> = { data: Extract<FlowNode, { type: T }>["data"]; onChange: (data: Extract<FlowNode, { type: T }>["data"]) => void };

function CurrencySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Moneda">
      <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {SUPPORTED_CURRENCIES.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </Field>
  );
}

function StartForm({ data, onChange }: Props<"start">) {
  return (
    <>
      <Field label="Frecuencia">
        <select className={selectClass} value={data.frequency} onChange={(e) => onChange({ ...data, frequency: e.target.value as typeof data.frequency })}>
          {Object.entries(FREQUENCY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </Field>
      <Field label="Vigente desde">
        <Input type="date" value={data.validFrom} onChange={(e) => e.target.value && onChange({ ...data, validFrom: e.target.value })} />
      </Field>
      <Field label="Vigente hasta (opcional)">
        <Input type="date" value={data.validTo ?? ""} onChange={(e) => onChange({ ...data, validTo: e.target.value || null })} />
      </Field>
    </>
  );
}

function AmountForm({ data, onChange }: Props<"amount">) {
  // Al cambiar de modo se conservan moneda y un monto de partida razonable.
  const base = data.mode === "fixed" ? data.amountMinor : data.mode === "range" ? data.maxMinor : data.maxMinor;
  const setMode = (mode: typeof data.mode) => {
    const currency = data.currency;
    if (mode === "fixed") onChange({ mode, currency, amountMinor: Math.max(base, 1), toleranceBps: 0 });
    else if (mode === "range") onChange({ mode, currency, minMinor: 0, maxMinor: Math.max(base, 1) });
    else onChange({ mode, currency, maxMinor: Math.max(base, 1) });
  };
  // `key` reinicia los campos de dinero al cambiar de moneda o de modo.
  const k = `${data.mode}-${data.currency}`;
  return (
    <>
      <Field label="Tipo de monto">
        <select className={selectClass} value={data.mode} onChange={(e) => setMode(e.target.value as typeof data.mode)}>
          <option value="fixed">Monto fijo</option>
          <option value="range">Rango</option>
          <option value="cap">Tope máximo</option>
        </select>
      </Field>
      <CurrencySelect value={data.currency} onChange={(currency) => onChange({ ...data, currency })} />
      {data.mode === "fixed" && (
        <>
          <MoneyField key={k} label="Monto por factura" minor={data.amountMinor} currency={data.currency} onChange={(amountMinor) => onChange({ ...data, amountMinor })} />
          <Field label="Tolerancia (%)" hint="0 = exacto. Solo la fija una persona al activar el flujo.">
            <Input
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={data.toleranceBps / 100}
              onChange={(e) => onChange({ ...data, toleranceBps: Math.min(10_000, Math.max(0, Math.round(Number(e.target.value || 0) * 100))) })}
            />
          </Field>
        </>
      )}
      {data.mode === "range" && (
        <>
          <MoneyField key={`${k}-min`} label="Mínimo" minor={data.minMinor} currency={data.currency} onChange={(minMinor) => onChange({ ...data, minMinor })} />
          <MoneyField key={`${k}-max`} label="Máximo" minor={data.maxMinor} currency={data.currency} onChange={(maxMinor) => onChange({ ...data, maxMinor })} />
        </>
      )}
      {data.mode === "cap" && (
        <MoneyField key={k} label="Máximo por factura" minor={data.maxMinor} currency={data.currency} onChange={(maxMinor) => onChange({ ...data, maxMinor })} />
      )}
    </>
  );
}

function ConditionForm({ data, onChange }: Props<"condition">) {
  return (
    <>
      <Field label="Dato de la factura">
        <select
          className={selectClass}
          value={data.field}
          onChange={(e) =>
            onChange(e.target.value === "currency" ? { field: "currency", op: "eq", value: "USD" } : { field: "amountMinor", op: "gt", value: 100_000 })
          }
        >
          <option value="amountMinor">Monto (unidades menores)</option>
          <option value="currency">Moneda</option>
        </select>
      </Field>
      <Field label="Operador">
        <select className={selectClass} value={data.op} onChange={(e) => onChange({ ...data, op: e.target.value } as typeof data)}>
          {OP_OPTIONS.filter(([op]) => data.field === "amountMinor" || op === "eq" || op === "neq").map(([op, label]) => (
            <option key={op} value={op}>{label}</option>
          ))}
        </select>
      </Field>
      {data.field === "amountMinor" ? (
        <Field label="Valor (unidades menores, ej. 100000 = $1,000.00)">
          <Input type="number" min={0} step={1} value={data.value} onChange={(e) => onChange({ ...data, value: Math.max(0, Math.trunc(Number(e.target.value || 0))) })} />
        </Field>
      ) : (
        <Field label="Moneda">
          <select className={selectClass} value={data.value} onChange={(e) => onChange({ ...data, value: e.target.value })}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
      )}
      <p className="text-[0.7rem] text-muted-foreground">Conecta la salida «Sí» y la salida «No»; si falta el dato de la factura, el resultado queda ambiguo.</p>
    </>
  );
}

export function NodeInspector({ type, data, onChange }: { type: FlowNode["type"]; data: FlowNode["data"]; onChange: (data: FlowNode["data"]) => void }) {
  // Cada rama está acotada por `type`; el cast refleja esa correspondencia que TypeScript no enlaza.
  switch (type) {
    case "start":
      return <StartForm data={data as Props<"start">["data"]} onChange={onChange} />;
    case "amount":
      return <AmountForm data={data as Props<"amount">["data"]} onChange={onChange} />;
    case "beneficiary": {
      const d = data as Props<"beneficiary">["data"];
      return (
        <Field label="Cuenta pactada" hint="Referencia enmascarada, nunca el número completo. Un cambio de cuenta en la factura siempre escala.">
          <Input value={d.accountRef} maxLength={120} onChange={(e) => onChange({ accountRef: e.target.value })} />
        </Field>
      );
    }
    case "condition":
      return <ConditionForm data={data as Props<"condition">["data"]} onChange={onChange} />;
    case "milestone": {
      const d = data as Props<"milestone">["data"];
      return (
        <>
          <Field label="Nombre del hito">
            <Input value={d.label} maxLength={80} onChange={(e) => onChange({ ...d, label: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.requiresEvidence} onChange={(e) => onChange({ ...d, requiresEvidence: e.target.checked })} />
            Exige evidencia de entrega
          </label>
        </>
      );
    }
    case "paymentTerms": {
      const d = data as Props<"paymentTerms">["data"];
      return (
        <Field label="Días netos" hint="El vencimiento esperado es la fecha de la factura más estos días.">
          <Input type="number" min={0} max={365} step={1} value={d.netDays} onChange={(e) => onChange({ netDays: Math.min(365, Math.max(0, Math.trunc(Number(e.target.value || 0)))) })} />
        </Field>
      );
    }
    case "end": {
      const d = data as Props<"end">["data"];
      return (
        <Field label="Resultado" hint="Ningún final aprueba un pago: la autorización siempre es aparte.">
          <select className={selectClass} value={d.outcome} onChange={(e) => onChange({ outcome: e.target.value as typeof d.outcome })}>
            {Object.entries(END_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
      );
    }
  }
}
