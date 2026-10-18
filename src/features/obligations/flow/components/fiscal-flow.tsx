"use client";
/**
 * Purpose: plantilla de flujo "Tributación" en React Flow: contabilidad simulada → reglas de la
 *   empresa → reloj → propuesta de Pacta → liquidaciones → evaluación → aprobaciones → pago
 *   simulado. Cada nodo es un paso; el motor es el mismo (decideFiscalRun). Todo en el navegador:
 *   sin persistencia y sin mover dinero (`approved` = aprobado para pago simulado).
 * Runs in: browser.
 * Triggered by: /obligations/fiscal (vía process-loader).
 * Receives → Returns: nada → el lienzo con el estado del proceso y el panel del paso elegido.
 * Talks to: ../../fiscal (fixture-source, schemas, labels), decisions/engine/obligations/fiscal,
 *   ../fiscal-logic, ./process-canvas, contracts/money, shadcn Button, Input, Label, Switch, Badge.
 */
import { Check, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatMinor, parseAmountToMinor } from "@/features/contracts/money";
import { decideFiscalRun, fiscalAlerts, fiscalProvision, type FiscalRunResult } from "@/features/decisions/engine/obligations/fiscal";
import { cn } from "@/lib/utils";
import { FISCAL_SCENARIO_NAMES, loadFiscalScenario, type FiscalScenarioName } from "../../fiscal/fixture-source";
import { FISCAL_REASON, FISCAL_RULE, FISCAL_TYPE } from "../../fiscal/labels";
import { FLOW_OUTCOME } from "../labels";
import { periodKey, type FiscalRunContext, type FiscalScenario, type FiscalTemplate, type FiscalType, type Settlement } from "../../fiscal/schemas";
import { asOfFor, buildFiscalTemplate, DEMO_USER, FISCAL_DATES, rulesFrom, toDecimal, type RulesDraft } from "../fiscal-logic";
import { ProcessCanvas, type ProcessStep, type StepStatus } from "./process-canvas";

const SCENARIO_LABEL: Record<FiscalScenarioName, string> = {
  "fiscal-limpio": "Empresa en orden",
  "fiscal-anomalias": "Empresa con anomalías",
};

const EDGES = [
  ["source", "rules"],
  ["rules", "clock"],
  ["clock", "proposal"],
  ["proposal", "settlements"],
  ["settlements", "evaluate"],
  ["evaluate", "approvals"],
  ["approvals", "payment"],
].map(([source, target]) => ({ id: `${source}-${target}`, source, target }));

export function FiscalFlow({ backHref }: { backHref: string }) {
  const [name, setName] = useState<FiscalScenarioName>("fiscal-limpio");
  const controls = (
    <>
      <span className="pl-1 text-xs text-muted-foreground">Escenario</span>
      {FISCAL_SCENARIO_NAMES.map((n) => (
        <Button key={n} size="sm" variant={n === name ? "secondary" : "ghost"} onClick={() => setName(n)}>
          {SCENARIO_LABEL[n]}
        </Button>
      ))}
    </>
  );
  // Cambiar de escenario reinicia todo el recorrido.
  return <Inner key={name} scenario={loadFiscalScenario(name)} controls={controls} backHref={backHref} />;
}

type Resolution = "approved_by_human" | "rejected";

function Inner({ scenario, controls, backHref }: { scenario: FiscalScenario; controls: React.ReactNode; backHref: string }) {
  const { snapshot } = scenario;
  const currency = snapshot.currency;

  const [selected, setSelected] = useState<string | null>("source");
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [rules, setRules] = useState<RulesDraft>(() => rulesFrom(scenario));
  const [template, setTemplate] = useState<FiscalTemplate | null>(null);
  const [version, setVersion] = useState(1);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [date, setDate] = useState<string>(FISCAL_DATES[1].date);
  // Solo llegan las liquidaciones propuestas por correo; confirmar es acción de una persona.
  const [settlements, setSettlements] = useState<Settlement[]>(() => scenario.settlements.filter((s) => s.status === "proposed"));
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      snapshot.items.map((item) => {
        const key = periodKey(item.fiscalType, item.periodStart);
        const value = scenario.settlements.find((s) => periodKey(s.fiscalType, s.periodStart) === key)?.amountMinor ?? item.draftAmountMinor;
        return [key, value === null ? "" : toDecimal(value)];
      }),
    ),
  );
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [result, setResult] = useState<{ asOf: string; run: FiscalRunResult } | null>(null);
  const [resolution, setResolution] = useState<Record<string, Resolution>>({});
  const [paid, setPaid] = useState<{ fiscalType: FiscalType; periodStart: string; amountMinor: number }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const run: FiscalRunContext = useMemo(() => {
    const spent = paid.reduce((sum, p) => sum + p.amountMinor, 0);
    return {
      fundsAvailableMinor: Math.max(scenario.run.fundsAvailableMinor - spent, 0),
      fundsReservedMinor: scenario.run.fundsReservedMinor,
      paidPeriods: [...scenario.run.paidPeriods, ...paid.map(({ fiscalType, periodStart }) => ({ fiscalType, periodStart }))],
    };
  }, [paid, scenario.run]);

  const asOf = asOfFor(date);
  const watched = template === null ? [] : snapshot.items.filter((item) => template.taxes.some((tax) => tax.fiscalType === item.fiscalType));
  const isPaid = (fiscalType: FiscalType, periodStart: string) => run.paidPeriods.some((p) => periodKey(p.fiscalType, p.periodStart) === periodKey(fiscalType, periodStart));
  const pendingConfirm = watched.filter((item) => !isPaid(item.fiscalType, item.periodStart));
  const settlementFor = (fiscalType: FiscalType, periodStart: string) => settlements.find((s) => periodKey(s.fiscalType, s.periodStart) === periodKey(fiscalType, periodStart)) ?? null;
  const humanApprovedIds = (extra?: string) => [...Object.keys(resolution).filter((id) => resolution[id] === "approved_by_human"), ...(extra === undefined ? [] : [extra])];

  // Las aprobaciones humanas entran a las reglas de corrida: lo que se paga debe caber en fondos y tope.
  function evaluate(humanApprovedLineIds: string[] = humanApprovedIds()) {
    if (template === null) return null;
    return decideFiscalRun({ template, snapshot, settlements, run, asOf, humanApprovedLineIds });
  }

  const reset = () => {
    setResult(null);
    setResolution({});
    setNotice(null);
  };

  function connect() {
    setConnecting(true);
    // Pausa breve para que se lea como una conexión; los datos son el fixture.
    window.setTimeout(() => {
      setConnecting(false);
      setConnected(true);
      setSelected("rules");
    }, 700);
  }

  function activate() {
    const built = buildFiscalTemplate(scenario.template, rules, version);
    if (!built.ok) return setRulesError(built.error);
    setRulesError(null);
    setTemplate(built.template);
    reset();
    setSelected("clock");
  }

  function editRules() {
    setTemplate(null);
    setVersion((v) => v + 1); // cada activación es una versión nueva de la plantilla
    reset();
  }

  function confirm(fiscalType: FiscalType, periodStart: string) {
    const key = periodKey(fiscalType, periodStart);
    const parsed = parseAmountToMinor(amounts[key] ?? "", currency);
    if (!parsed.ok || parsed.amountMinor === 0) return setConfirmError(parsed.ok ? "El monto confirmado debe ser mayor que 0." : parsed.error);
    setConfirmError(null);
    const existing = settlementFor(fiscalType, periodStart);
    const confirmed: Settlement = {
      settlementId: existing?.settlementId ?? `liq_demo_${fiscalType}_${periodStart}`,
      fiscalType,
      periodStart,
      status: "confirmed",
      amountMinor: parsed.amountMinor,
      source: existing?.source ?? "human",
      confirmedBy: DEMO_USER,
      confirmedAt: `${date}T13:00:00Z`,
    };
    setSettlements((current) => [...current.filter((s) => periodKey(s.fiscalType, s.periodStart) !== key), confirmed]);
    reset();
  }

  function runEvaluation() {
    const evaluated = evaluate([]);
    if (evaluated === null) return;
    setResult({ asOf, run: evaluated });
    setResolution({});
    setNotice(null);
    setSelected("approvals");
  }

  // Aprobación humana: reevalúa contando esta aprobación; un bloqueo absoluto (fondos, periodo pagado) no se aprueba.
  function approve(lineId: string) {
    const next = evaluate(humanApprovedIds(lineId));
    const fresh = next?.lines.find((l) => l.lineId === lineId);
    if (!next || !fresh || fresh.decision === "blocked") {
      return setNotice("Al reevaluar, la línea quedó bloqueada: una aprobación humana no salta un bloqueo absoluto (por ejemplo, fondos).");
    }
    setNotice(null);
    setResolution((current) => ({ ...current, [lineId]: "approved_by_human" }));
    setResult({ asOf, run: next });
  }

  // Pago simulado: revalida con la evidencia vigente antes de registrar.
  function paySimulated() {
    const fresh = evaluate();
    if (fresh === null) return;
    const payable = fresh.lines.filter((l) => l.amountMinor !== null && (l.decision === "approved" || (l.decision === "requires_approval" && resolution[l.lineId] === "approved_by_human")));
    if (payable.length === 0) return setNotice("Nada que pagar: no hay líneas aprobadas ni aprobadas por una persona.");
    const total = payable.reduce((sum, l) => sum + (l.amountMinor as number), 0);
    setPaid((current) => [...current, ...payable.map((l) => ({ fiscalType: l.fiscalType, periodStart: l.periodStart, amountMinor: l.amountMinor as number }))]);
    setNotice(`Pago registrado: ${payable.length} ${payable.length === 1 ? "impuesto" : "impuestos"} por ${formatMinor(total, currency)}. Si vuelves a evaluar, esos periodos aparecen como ya pagados.`);
    setResult(null);
    setResolution({});
  }

  const provision = template === null ? null : fiscalProvision({ template, snapshot, run });
  const alerts = template === null ? [] : fiscalAlerts({ template, snapshot, run, asOf });
  const beforeSnapshot = Date.parse(asOf) < Date.parse(snapshot.capturedAt);
  const unresolved = result?.run.lines.filter((l) => l.decision === "requires_approval" && resolution[l.lineId] === undefined) ?? [];
  const lastRun = result?.run;

  // ---- Estado de cada nodo ----
  const allConfirmed = pendingConfirm.every((item) => settlementFor(item.fiscalType, item.periodStart)?.status === "confirmed");
  const st = (s: StepStatus) => s;
  const steps: ProcessStep[] = [
    { id: "source", title: "Contabilidad", icon: "source", summary: connected ? `${snapshot.items.length} borradores · ${snapshot.capturedAt.slice(0, 10)}` : "Sin conectar", status: st(connected ? "done" : "ready"), x: 0, y: 0 },
    { id: "rules", title: "Reglas de la empresa", icon: "rules", summary: template === null ? "Plantilla sin activar" : `Activa · versión ${template.version}`, status: st(!connected ? "idle" : template ? "done" : "ready"), x: 330, y: 0 },
    { id: "clock", title: "Reloj de demo", icon: "clock", summary: FISCAL_DATES.find((d) => d.date === date)?.label ?? date, status: st(template ? "done" : "idle"), x: 660, y: 0 },
    { id: "proposal", title: "Propuesta de Pacta", icon: "proposal", summary: template ? `${alerts.length} aviso${alerts.length === 1 ? "" : "s"} T-7/T-3` : "Sin plantilla", status: st(!template ? "idle" : alerts.some((a) => a.level === "urgent") ? "attention" : "done"), x: 990, y: 0 },
    { id: "settlements", title: "Liquidaciones", icon: "settlements", summary: template ? `${pendingConfirm.filter((i) => settlementFor(i.fiscalType, i.periodStart)?.status === "confirmed").length}/${pendingConfirm.length} confirmadas` : "Sin plantilla", status: st(!template ? "idle" : allConfirmed ? "done" : "attention"), x: 0, y: 220 },
    { id: "evaluate", title: "Evaluar pagos", icon: "evaluate", summary: result ? `${result.run.lines.filter((l) => l.decision === "approved").length} aprobadas · ${result.run.lines.filter((l) => l.decision === "blocked").length} bloqueadas` : "Sin evaluar", status: st(!template ? "idle" : result ? (result.run.held ? "blocked" : "done") : "ready"), x: 330, y: 220 },
    { id: "approvals", title: "Aprobaciones", icon: "approvals", summary: result ? (unresolved.length > 0 ? `${unresolved.length} por resolver` : "Sin pendientes") : "Sin resultado", status: st(!result ? "idle" : unresolved.length > 0 ? "attention" : "done"), x: 660, y: 220 },
    { id: "payment", title: "Pago", icon: "payment", summary: paid.length > 0 ? `${paid.length} pagos registrados` : "Nada pagado", status: st(paid.length > 0 ? "done" : result ? "ready" : "idle"), x: 990, y: 220 },
  ];

  const titles: Record<string, string> = Object.fromEntries(steps.map((s) => [s.id, s.title]));
  const stepOf = selected ?? "source";

  const panel = (
    <>
      {stepOf === "source" && (
        <Section description="Pacta lee los borradores que ya calculó el sistema contable de la empresa.">
          {!connected ? (
            <Button onClick={connect} disabled={connecting}>
              {connecting && <Loader2 className="animate-spin" />}
              {connecting ? "Conectando…" : "Conectar contabilidad"}
            </Button>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                <Check className="mr-1 inline size-4 text-emerald-600" />
                Conectado a <span className="font-medium">Contabilidad</span> · datos del {snapshot.capturedAt.slice(0, 10)}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Fact label={`Ingresos ${snapshot.income?.periodStart.slice(0, 7) ?? ""}`} value={snapshot.income === null ? "No reportados" : formatMinor(snapshot.income.amountMinor, currency)} />
                <Fact label="Fondos libres" value={formatMinor(Math.max(run.fundsAvailableMinor - run.fundsReservedMinor, 0), currency)} />
              </div>
              <ul className="divide-y rounded-lg text-sm ring-1 ring-black/5">
                {snapshot.items.map((item) => (
                  <li key={periodKey(item.fiscalType, item.periodStart)} className="flex flex-wrap items-center justify-between gap-1 px-3 py-2">
                    <span>{item.displayName}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {item.draftAmountMinor === null ? "sin borrador" : formatMinor(item.draftAmountMinor, currency)} · vence {item.dueDate}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {stepOf === "rules" && (
        <Section description="Reglas de control de la empresa, no tributarias. Una persona las activa; hasta entonces nada opera en automático.">
          {!connected ? (
            <p className="text-sm text-muted-foreground">Conecta primero la contabilidad.</p>
          ) : template !== null ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                <Check className="mr-1 inline size-4 text-emerald-600" />
                Plantilla activa (versión {template.version}) · {template.taxes.map((t) => FISCAL_TYPE[t.fiscalType]).join(", ")}
              </p>
              <Button variant="outline" size="sm" onClick={editRules}>Cambiar reglas</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <ul className="flex flex-col gap-2">
                {snapshot.items.map((item) => {
                  const tax = rules.taxes[item.fiscalType];
                  return (
                    <li key={item.fiscalType} className="flex flex-col gap-1.5 rounded-lg p-2 ring-1 ring-black/5">
                      <label className="flex items-center justify-between gap-2 text-sm font-medium">
                        {FISCAL_TYPE[item.fiscalType]}
                        <Switch checked={tax.enabled} onCheckedChange={(enabled) => setRules((r) => ({ ...r, taxes: { ...r.taxes, [item.fiscalType]: { ...tax, enabled } } }))} />
                      </label>
                      {tax.enabled && (
                        <Input aria-label={`Referencia de pago ${FISCAL_TYPE[item.fiscalType]}`} value={tax.reference} placeholder="DIAN-****4410" onChange={(e) => setRules((r) => ({ ...r, taxes: { ...r.taxes, [item.fiscalType]: { ...tax, reference: e.target.value } } }))} />
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Tolerancia (%)" value={rules.tolerancePercent} onChange={(v) => setRules((r) => ({ ...r, tolerancePercent: v }))} />
                <Field label="Reservar de ingresos (%)" value={rules.provisionPercent} placeholder="sin regla" onChange={(v) => setRules((r) => ({ ...r, provisionPercent: v }))} />
              </div>
              <Field label="Tope de la corrida" value={rules.runCap} onChange={(v) => setRules((r) => ({ ...r, runCap: v }))} />
              {rulesError !== null && <p role="alert" className="text-xs text-destructive">{rulesError}</p>}
              <Button onClick={activate}>Activar plantilla</Button>
            </div>
          )}
        </Section>
      )}

      {stepOf === "clock" && (
        <Section description="El motor no lee el reloj: la fecha de evaluación es una entrada. Mueve el reloj de demo para ver avisos y vencimientos.">
          <div className="flex flex-wrap gap-2">
            {FISCAL_DATES.map((d) => (
              <Button
                key={d.date}
                size="sm"
                variant={d.date === date ? "secondary" : "outline"}
                onClick={() => {
                  // Otra fecha es otra evaluación: el resultado y las aprobaciones anteriores ya no valen.
                  setDate(d.date);
                  reset();
                }}
              >
                {d.label}
              </Button>
            ))}
          </div>
        </Section>
      )}

      {stepOf === "proposal" &&
        (template === null || provision === null ? (
          <p className="text-sm text-muted-foreground">Activa la plantilla para ver la propuesta.</p>
        ) : (
          <Section description="Lo que viene, cuánto reservar y avisos antes del vencimiento. Informa; no decide ni paga.">
            <div className="grid grid-cols-3 gap-2">
              <Fact label="Borradores" value={provision.totalDraftMinor === null ? "Desconocido" : formatMinor(provision.totalDraftMinor, currency)} />
              <Fact label="Reserva" value={provision.reserveMinor === null ? "Sin regla" : formatMinor(provision.reserveMinor, currency)} />
              <Fact label="Faltante" value={provision.gapMinor === null ? "—" : formatMinor(provision.gapMinor, currency)} />
            </div>
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin avisos a esta fecha.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {alerts.map((a) => (
                  <li key={`${a.fiscalType}-${a.periodStart}`} className={cn("rounded-lg px-3 py-2 text-sm ring-1", a.level === "urgent" ? "bg-amber-50 ring-amber-300" : "ring-black/5")}>
                    <span className="font-medium">{a.level === "urgent" ? "Urgente · " : "Aviso · "}</span>
                    {a.message}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ))}

      {stepOf === "settlements" &&
        (template === null ? (
          <p className="text-sm text-muted-foreground">Activa la plantilla primero.</p>
        ) : (
          <Section description="Nunca se paga sobre un borrador: una persona confirma la liquidación real de cada impuesto.">
            <ul className="flex flex-col gap-2">
              {pendingConfirm.map((item) => {
                const key = periodKey(item.fiscalType, item.periodStart);
                const existing = settlementFor(item.fiscalType, item.periodStart);
                return (
                  <li key={key} className="flex flex-col gap-1.5 rounded-lg p-2 ring-1 ring-black/5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{item.displayName}</span>
                      {existing?.status === "confirmed" ? <Badge>Confirmada</Badge> : existing?.source === "inbox" ? <Badge variant="secondary">Llegó por correo</Badge> : <Badge variant="outline">Sin confirmar</Badge>}
                    </div>
                    <div className="flex gap-2">
                      <Input aria-label={`Monto ${item.displayName}`} inputMode="decimal" value={amounts[key] ?? ""} onChange={(e) => setAmounts((a) => ({ ...a, [key]: e.target.value }))} />
                      <Button size="sm" variant="outline" onClick={() => confirm(item.fiscalType, item.periodStart)}>Confirmar</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {confirmError !== null && <p role="alert" className="text-xs text-destructive">{confirmError}</p>}
          </Section>
        ))}

      {stepOf === "evaluate" && (
        <Section description="El motor determinista aplica las reglas por línea y por corrida. Aprobada significa lista para pago.">
          <Button onClick={runEvaluation} disabled={template === null || beforeSnapshot}>
            Evaluar pagos al {date}
          </Button>
          {beforeSnapshot && <p className="text-xs text-muted-foreground">La contabilidad es posterior a esa fecha: elige una fecha más tarde.</p>}
          {lastRun && <Lines lines={lastRun.lines} currency={currency} />}
        </Section>
      )}

      {stepOf === "approvals" && (
        <Section description="Una aprobación humana reevalúa antes de aceptarse y no salta bloqueos absolutos.">
          {!lastRun ? (
            <p className="text-sm text-muted-foreground">Evalúa los pagos primero.</p>
          ) : (
            <Lines lines={lastRun.lines} currency={currency} resolution={resolution} onApprove={approve} onReject={(id) => setResolution((r) => ({ ...r, [id]: "rejected" }))} />
          )}
          {notice !== null && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
        </Section>
      )}

      {stepOf === "payment" && (
        <Section description="El agente revalida con la evidencia vigente y registra el pago.">
          <Button onClick={paySimulated} disabled={!result}>Registrar pago</Button>
          {notice !== null && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
          {paid.length > 0 && (
            <ul className="divide-y rounded-lg text-sm ring-1 ring-black/5">
              {paid.map((p) => (
                <li key={periodKey(p.fiscalType, p.periodStart)} className="flex justify-between px-3 py-2">
                  <span>{FISCAL_TYPE[p.fiscalType]}</span>
                  <span className="tabular-nums text-muted-foreground">{formatMinor(p.amountMinor, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
  );

  return <ProcessCanvas title="Tributación" steps={steps} edges={EDGES} selectedId={selected} onSelect={setSelected} controls={controls} panelTitle={titles[stepOf] ?? "Paso"} panel={panel} backHref={backHref} />;
}

function Section({ description, children }: { description: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{description}</p>
      {children}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-2 ring-1 ring-black/5">
      <p className="text-[0.7rem] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input value={value} placeholder={placeholder} inputMode="decimal" onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Lines({
  lines,
  currency,
  resolution,
  onApprove,
  onReject,
}: {
  lines: FiscalRunResult["lines"];
  currency: string;
  resolution?: Record<string, Resolution>;
  onApprove?: (lineId: string) => void;
  onReject?: (lineId: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {lines.map((line) => {
        const outcome = FLOW_OUTCOME[line.decision];
        const resolved = resolution?.[line.lineId];
        return (
          <li key={line.lineId} className="flex flex-col gap-1.5 rounded-lg p-2 text-sm ring-1 ring-black/5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="font-medium">{FISCAL_TYPE[line.fiscalType]}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{line.amountMinor === null ? "—" : formatMinor(line.amountMinor, currency)}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              <Badge variant={outcome.variant}>{resolved === "approved_by_human" ? "Aprobada por una persona" : resolved === "rejected" ? "Rechazada" : outcome.label}</Badge>
              {line.decision !== "approved" && line.reasonCodes.filter((c) => c !== "HUMAN_APPROVAL_REQUIRED").map((c) => <Badge key={c} variant="outline">{FISCAL_REASON[c]}</Badge>)}
            </div>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Reglas evaluadas</summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {line.rulesEvaluated.map((r) => (
                  <li key={r.ruleId}>
                    {r.result === "pass" ? "✓" : "✗"} {FISCAL_RULE[r.ruleId] ?? r.ruleId}
                    {r.result !== "pass" && <span> — {r.explanation}</span>}
                  </li>
                ))}
              </ul>
            </details>
            {onApprove && line.decision === "requires_approval" && resolved === undefined && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onApprove(line.lineId)}>Aprobar</Button>
                <Button size="sm" variant="outline" onClick={() => onReject?.(line.lineId)}>Rechazar</Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
