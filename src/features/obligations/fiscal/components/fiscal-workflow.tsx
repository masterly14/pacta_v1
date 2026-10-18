/**
 * Purpose: guided demo of the fiscal obligation in six steps: connect the simulated accounting
 *   system, set the organization's control rules and activate them, see what Pacta proposes
 *   (calendar, provision, alerts), confirm settlements, evaluate the payments at a demo date, and
 *   resolve the result (human approval re-evaluates; simulated payment revalidates first).
 *   Browser-only simulation: state lives in the page, nothing is stored, no money moves.
 * Runs in: client (React state; the engine is pure TypeScript and runs in the browser).
 * Triggered by: /platform/obligations/fiscal.
 * Receives → Returns: nothing → the interactive flow.
 * Talks to: ../fixture-source, ../schemas, ../labels, decisions/engine/obligations/fiscal,
 *   contracts/money (parseAmountToMinor, formatMinor), shadcn Card, Button, Input, Label, Switch, Badge.
 */
"use client";

import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatMinor, parseAmountToMinor } from "@/features/contracts/money";
import { decideFiscalRun, fiscalAlerts, fiscalProvision, type FiscalRunResult } from "@/features/decisions/engine/obligations/fiscal";
import { cn } from "@/lib/utils";
import { FISCAL_SCENARIO_NAMES, loadFiscalScenario, type FiscalScenarioName } from "../fixture-source";
import { FISCAL_OUTCOME, FISCAL_REASON, FISCAL_RULE, FISCAL_TYPE } from "../labels";
import {
  FiscalTemplateSchema,
  periodKey,
  type FiscalRunContext,
  type FiscalScenario,
  type FiscalTemplate,
  type FiscalType,
  type Settlement,
} from "../schemas";

const DEMO_USER = "usuario_demo";
const ACTIVATED_AT = "2026-11-01T15:00:00Z"; // antes de cualquier fecha del reloj de demo

// Reloj de demo: aviso temprano, aviso urgente y vencido. 14:00 UTC = mañana en Bogotá.
const DATES = [
  { date: "2026-11-03", label: "3 nov · T-7" },
  { date: "2026-11-07", label: "7 nov · T-3" },
  { date: "2026-11-11", label: "11 nov · vencido" },
] as const;

const SCENARIO_LABEL: Record<FiscalScenarioName, string> = {
  "fiscal-limpio": "Empresa en orden",
  "fiscal-anomalias": "Empresa con anomalías",
};

const asOfFor = (date: string) => `${date}T14:00:00Z`;

// Unidades menores → texto decimal para un campo editable. Sin floats.
function toDecimal(amountMinor: number): string {
  return `${Math.trunc(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

// "30" o "12.5" → puntos básicos (3000, 1250), con la misma aritmética de texto que los montos.
function percentToBps(value: string): number | null {
  const parsed = parseAmountToMinor(value, "USD");
  return parsed.ok ? parsed.amountMinor : null;
}

type RulesDraft = {
  taxes: Record<string, { enabled: boolean; reference: string }>;
  provisionPercent: string; // vacío = sin regla de provisión
  tolerancePercent: string;
  runCap: string;
};

function rulesFrom(scenario: FiscalScenario): RulesDraft {
  const taxes: RulesDraft["taxes"] = {};
  for (const item of scenario.snapshot.items) {
    const authorized = scenario.template.taxes.find((tax) => tax.fiscalType === item.fiscalType);
    taxes[item.fiscalType] = { enabled: authorized !== undefined, reference: authorized?.authorizedPaymentReference ?? "" };
  }
  return {
    taxes,
    provisionPercent: scenario.template.provisionBps === null ? "" : String(scenario.template.provisionBps / 100),
    tolerancePercent: String(scenario.template.varianceToleranceBps / 100),
    runCap: toDecimal(scenario.template.runCapMinor),
  };
}

function buildTemplate(base: FiscalTemplate, rules: RulesDraft, version: number): { ok: true; template: FiscalTemplate } | { ok: false; error: string } {
  const tolerance = percentToBps(rules.tolerancePercent);
  if (tolerance === null) return { ok: false, error: "La tolerancia debe ser un porcentaje, por ejemplo 10." };
  const provision = rules.provisionPercent.trim() === "" ? null : percentToBps(rules.provisionPercent);
  if (rules.provisionPercent.trim() !== "" && (provision === null || provision === 0)) {
    return { ok: false, error: "La provisión debe ser un porcentaje mayor que 0, o quedar vacía." };
  }
  const cap = parseAmountToMinor(rules.runCap, base.currency);
  if (!cap.ok) return { ok: false, error: `Tope de la corrida: ${cap.error}` };
  const taxes = Object.entries(rules.taxes)
    .filter(([, tax]) => tax.enabled)
    .map(([fiscalType, tax]) => ({ fiscalType, authorizedPaymentReference: tax.reference.trim() }));
  const parsed = FiscalTemplateSchema.safeParse({
    ...base,
    version,
    status: "active",
    activatedBy: DEMO_USER,
    activatedAt: ACTIVATED_AT,
    taxes,
    varianceToleranceBps: tolerance,
    provisionBps: provision,
    runCapMinor: cap.amountMinor,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue.path[0] === "taxes" && issue.path.length === 1) return { ok: false, error: "Elige al menos un impuesto para vigilar." };
    if (issue.path.includes("authorizedPaymentReference")) return { ok: false, error: "Cada referencia de pago debe ir enmascarada, por ejemplo DIAN-****4410." };
    return { ok: false, error: issue.message };
  }
  return { ok: true, template: parsed.data };
}

export function FiscalWorkflow() {
  const [scenarioName, setScenarioName] = useState<FiscalScenarioName>("fiscal-limpio");
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Simulación · datos ficticios</Badge>
        <span className="text-sm text-muted-foreground">Escenario de demo:</span>
        {FISCAL_SCENARIO_NAMES.map((name) => (
          <Pill key={name} active={name === scenarioName} onClick={() => setScenarioName(name)}>
            {SCENARIO_LABEL[name]}
          </Pill>
        ))}
      </div>
      {/* Cambiar de escenario reinicia el recorrido completo. */}
      <Workflow key={scenarioName} scenario={loadFiscalScenario(scenarioName)} />
    </div>
  );
}

function Workflow({ scenario }: { scenario: FiscalScenario }) {
  const { snapshot } = scenario;
  const currency = snapshot.currency;

  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [rules, setRules] = useState<RulesDraft>(() => rulesFrom(scenario));
  const [template, setTemplate] = useState<FiscalTemplate | null>(null);
  const [version, setVersion] = useState(1);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [date, setDate] = useState<string>(DATES[0].date);
  // Solo llegan las liquidaciones propuestas por correo; confirmar es acción de una persona.
  const [settlements, setSettlements] = useState<Settlement[]>(() => scenario.settlements.filter((s) => s.status === "proposed"));
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      snapshot.items.map((item) => {
        const key = periodKey(item.fiscalType, item.periodStart);
        const fromScenario = scenario.settlements.find((s) => periodKey(s.fiscalType, s.periodStart) === key)?.amountMinor;
        const value = fromScenario ?? item.draftAmountMinor;
        return [key, value === null ? "" : toDecimal(value)];
      }),
    ),
  );
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [result, setResult] = useState<{ asOf: string; run: FiscalRunResult } | null>(null);
  const [resolution, setResolution] = useState<Record<string, "approved_by_human" | "rejected">>({});
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
  function evaluate(currentRun = run, humanApprovedLineIds: string[] = humanApprovedIds()) {
    if (template === null) return null;
    return decideFiscalRun({ template, snapshot, settlements, run: currentRun, asOf, humanApprovedLineIds });
  }

  function connect() {
    setConnecting(true);
    // Pausa breve para que la demo se lea como una conexión; los datos son el fixture.
    window.setTimeout(() => {
      setConnecting(false);
      setConnected(true);
    }, 700);
  }

  function activate() {
    const built = buildTemplate(scenario.template, rules, version);
    if (!built.ok) {
      setRulesError(built.error);
      return;
    }
    setRulesError(null);
    setTemplate(built.template);
    setResult(null);
  }

  function editRules() {
    setTemplate(null);
    setVersion((v) => v + 1); // cada activación es una versión nueva de la plantilla
    setResult(null);
  }

  function confirm(fiscalType: FiscalType, periodStart: string) {
    const key = periodKey(fiscalType, periodStart);
    const parsed = parseAmountToMinor(amounts[key] ?? "", currency);
    if (!parsed.ok || parsed.amountMinor === 0) {
      setConfirmError(parsed.ok ? "El monto confirmado debe ser mayor que 0." : parsed.error);
      return;
    }
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
    setResult(null);
  }

  function runEvaluation() {
    const evaluated = evaluate();
    if (evaluated === null) return;
    setResult({ asOf, run: evaluated });
    setResolution({});
    setNotice(null);
  }

  // Aprobación humana: reevalúa primero; un bloqueo absoluto no se puede aprobar (CLAUDE.md §6.5).
  function approve(lineId: string) {
    // Se reevalúa contando esta aprobación: si ya no caben los fondos o el tope, la línea queda bloqueada.
    const next = evaluate(run, humanApprovedIds(lineId));
    const fresh = next?.lines.find((l) => l.lineId === lineId);
    if (!next || !fresh || fresh.decision === "blocked") {
      setNotice("Al reevaluar, la línea quedó bloqueada: una aprobación humana no salta un bloqueo absoluto (por ejemplo, fondos).");
      return;
    }
    setNotice(null);
    setResolution((current) => ({ ...current, [lineId]: "approved_by_human" }));
    setResult({ asOf, run: next });
  }

  // Pago simulado: revalida con la evidencia vigente antes de registrar (platform-core principio 7).
  function paySimulated() {
    const fresh = evaluate();
    if (fresh === null) return;
    const payable = fresh.lines.filter(
      (l) => l.amountMinor !== null && (l.decision === "approved" || (l.decision === "requires_approval" && resolution[l.lineId] === "approved_by_human")),
    );
    if (payable.length === 0) {
      setNotice("Nada que pagar: no hay líneas aprobadas ni aprobadas por una persona.");
      return;
    }
    const total = payable.reduce((sum, l) => sum + (l.amountMinor as number), 0);
    setPaid((current) => [...current, ...payable.map((l) => ({ fiscalType: l.fiscalType, periodStart: l.periodStart, amountMinor: l.amountMinor as number }))]);
    setNotice(`Pago simulado registrado: ${payable.length} ${payable.length === 1 ? "impuesto" : "impuestos"} por ${formatMinor(total, currency)}. No se movió dinero. Si vuelves a evaluar, esos periodos aparecen como ya pagados.`);
    setResult(null);
  }

  const provision = template === null ? null : fiscalProvision({ template, snapshot, run });
  const alerts = template === null ? [] : fiscalAlerts({ template, snapshot, run, asOf });
  const beforeSnapshot = Date.parse(asOf) < Date.parse(snapshot.capturedAt);

  return (
    <ol className="flex flex-col gap-4">
      {/* 1. Conectar */}
      <Step n={1} title="Conectar la contabilidad" done={connected} open description="Pacta lee los borradores que ya calculó el sistema contable de la empresa. Aquí es una contabilidad simulada.">
        {!connected ? (
          <Button onClick={connect} disabled={connecting}>
            {connecting && <Loader2 className="animate-spin" />}
            {connecting ? "Conectando…" : "Conectar contabilidad (simulada)"}
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              <Check className="mr-1 inline size-4 text-emerald-600" />
              Conectado a <span className="font-medium">{snapshot.sourceLabel}</span> · datos del {snapshot.capturedAt.slice(0, 10)}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Fact label={`Ingresos ${snapshot.income?.periodStart.slice(0, 7) ?? ""}`} value={snapshot.income === null ? "No reportados" : formatMinor(snapshot.income.amountMinor, currency)} />
              <Fact label="Borradores de impuestos" value={String(snapshot.items.length)} />
              <Fact label="Fondos libres" value={formatMinor(Math.max(run.fundsAvailableMinor - run.fundsReservedMinor, 0), currency)} />
            </div>
            <ul className="divide-y rounded-lg border text-sm">
              {snapshot.items.map((item) => (
                <li key={periodKey(item.fiscalType, item.periodStart)} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>{item.displayName}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {item.draftAmountMinor === null ? "sin borrador" : formatMinor(item.draftAmountMinor, currency)} · vence {item.dueDate}
                    {!item.accountingPeriodClosed && " · mes contable abierto"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Step>

      {/* 2. Reglas */}
      <Step
        n={2}
        title="Reglas de la empresa"
        done={template !== null}
        open={connected}
        description="La empresa decide qué vigilar, a dónde se paga y cuánto reservar. Son reglas de control: Pacta no aplica tarifas de impuestos."
      >
        {template === null ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Impuestos que Pacta vigila y referencia de pago autorizada</span>
              {snapshot.items.map((item) => {
                const tax = rules.taxes[item.fiscalType];
                return (
                  <div key={item.fiscalType} className="flex flex-wrap items-center gap-3">
                    <Switch
                      checked={tax.enabled}
                      onCheckedChange={(enabled) => setRules((r) => ({ ...r, taxes: { ...r.taxes, [item.fiscalType]: { ...tax, enabled } } }))}
                      aria-label={`Vigilar ${FISCAL_TYPE[item.fiscalType]}`}
                    />
                    <span className="w-44 text-sm">{FISCAL_TYPE[item.fiscalType]}</span>
                    <Input
                      className="w-48"
                      value={tax.reference}
                      disabled={!tax.enabled}
                      placeholder="DIAN-****4410"
                      onChange={(e) => setRules((r) => ({ ...r, taxes: { ...r.taxes, [item.fiscalType]: { ...tax, reference: e.target.value } } }))}
                      aria-label={`Referencia de pago de ${FISCAL_TYPE[item.fiscalType]}`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="provision" label="Provisión (% de los ingresos)" hint="Cuánto reservar para impuestos. Vacío = sin provisión." value={rules.provisionPercent} onChange={(v) => setRules((r) => ({ ...r, provisionPercent: v }))} />
              <Field id="tolerance" label="Tolerancia vs. periodo anterior (%)" hint="Un salto mayor pide una persona." value={rules.tolerancePercent} onChange={(v) => setRules((r) => ({ ...r, tolerancePercent: v }))} />
              <Field id="cap" label={`Tope por corrida (${currency})`} hint="Más que esto nunca se aprueba solo." value={rules.runCap} onChange={(v) => setRules((r) => ({ ...r, runCap: v }))} />
            </div>
            <p className="text-xs text-muted-foreground">
              Avisos {scenario.template.earlyAlertDays} y {scenario.template.urgentAlertDays} días antes del vencimiento. Un cambio de referencia de pago nunca se aprueba solo.
            </p>
            {rulesError && <p className="text-sm text-destructive">{rulesError}</p>}
            <div>
              <Button onClick={activate}>Activar plantilla «Impuestos»</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge>Activa · v{template.version}</Badge>
            <span className="text-muted-foreground">
              {template.taxes.length} impuestos · provisión {template.provisionBps === null ? "no definida" : `${template.provisionBps / 100} %`} · tolerancia {template.varianceToleranceBps / 100} % · tope{" "}
              {formatMinor(template.runCapMinor, currency)} · activada por {template.activatedBy}
            </span>
            <Button variant="outline" size="sm" onClick={editRules}>
              Cambiar reglas
            </Button>
          </div>
        )}
      </Step>

      {/* 3. Pacta propone */}
      <Step n={3} title="Lo que Pacta propone" done={template !== null} open={template !== null} description="Calendario de lo que viene, cuánto reservar y avisos antes del vencimiento. Mueve el reloj de demo para ver los avisos.">
        {template !== null && provision !== null && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Reloj de demo:</span>
              {DATES.map((d) => (
                <Pill
                  key={d.date}
                  active={d.date === date}
                  onClick={() => {
                    // Otra fecha es otra evaluación: el resultado y las aprobaciones anteriores ya no valen.
                    setDate(d.date);
                    setResult(null);
                    setResolution({});
                    setNotice(null);
                  }}
                >
                  {d.label}
                </Pill>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Fact label="Total de borradores por pagar" value={provision.totalDraftMinor === null ? "Desconocido" : formatMinor(provision.totalDraftMinor, currency)} />
              <Fact
                label={provision.provisionBps === null ? "Provisión" : `Provisión ${provision.provisionBps / 100} % de ingresos`}
                value={provision.reserveMinor === null ? "Sin provisión" : formatMinor(provision.reserveMinor, currency)}
              />
              <Fact
                label="¿Alcanza la provisión?"
                value={provision.gapMinor === null ? "—" : provision.gapMinor === 0 ? "Sí" : `Faltan ${formatMinor(provision.gapMinor, currency)}`}
                alert={provision.gapMinor !== null && provision.gapMinor > 0}
              />
            </div>
            <div className="flex flex-col gap-2">
              {alerts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin avisos al {date}: nada vence en los próximos {template.earlyAlertDays} días.</p>
              ) : (
                alerts.map((a) => (
                  <div key={periodKey(a.fiscalType, a.periodStart)} className={cn("rounded-lg border px-3 py-2 text-sm", a.reasonCodes.length > 0 && "border-destructive/40 bg-destructive/5")}>
                    <Badge variant={a.level === "urgent" ? "destructive" : "secondary"}>{a.level === "urgent" ? `Urgente · T-${a.daysUntilDue}` : `Aviso · T-${a.daysUntilDue}`}</Badge>
                    <p className="mt-1">{a.message}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </Step>

      {/* 4. Confirmar */}
      <Step
        n={4}
        title="Confirmar las liquidaciones"
        done={template !== null && pendingConfirm.length > 0 && pendingConfirm.every((i) => settlementFor(i.fiscalType, i.periodStart)?.status === "confirmed")}
        open={template !== null}
        description="Nunca se paga sobre un borrador. Una persona confirma cada monto, o llega la liquidación por correo y la verifica."
      >
        <div className="flex flex-col gap-2">
          {pendingConfirm.length === 0 && <p className="text-sm text-muted-foreground">No hay impuestos pendientes por confirmar.</p>}
          {pendingConfirm.map((item) => {
            const key = periodKey(item.fiscalType, item.periodStart);
            const settlement = settlementFor(item.fiscalType, item.periodStart);
            return (
              <div key={key} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                <span className="w-56">
                  <span className="font-medium">{item.displayName}</span>
                  <span className="block text-xs text-muted-foreground">
                    Borrador {item.draftAmountMinor === null ? "—" : formatMinor(item.draftAmountMinor, currency)}
                  </span>
                </span>
                {settlement?.status === "confirmed" ? (
                  <Badge>
                    <Check /> Confirmada · {formatMinor(settlement.amountMinor, currency)}
                  </Badge>
                ) : (
                  <>
                    {settlement?.status === "proposed" && <Badge variant="secondary">Llegó por correo · propuesta</Badge>}
                    <Input className="w-40" value={amounts[key] ?? ""} onChange={(e) => setAmounts((a) => ({ ...a, [key]: e.target.value }))} aria-label={`Monto a confirmar de ${item.displayName}`} />
                    <Button size="sm" onClick={() => confirm(item.fiscalType, item.periodStart)}>
                      Confirmar
                    </Button>
                  </>
                )}
              </div>
            );
          })}
          {confirmError && <p className="text-sm text-destructive">{confirmError}</p>}
          <p className="text-xs text-muted-foreground">Puedes dejar alguna sin confirmar para ver cómo Pacta la frena.</p>
        </div>
      </Step>

      {/* 5. Evaluar */}
      <Step n={5} title="Preparar los pagos" done={result !== null} open={template !== null} description="El día de pago Pacta vuelve a revisar todo con la evidencia vigente: mismas reglas, mismo orden.">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={runEvaluation} disabled={beforeSnapshot}>
            Evaluar pagos al {date}
          </Button>
          {beforeSnapshot && (
            <span className="text-sm text-muted-foreground">La contabilidad es del {snapshot.capturedAt.slice(0, 10)}: mueve el reloj de demo a una fecha posterior.</span>
          )}
        </div>
      </Step>

      {/* 6. Resultado */}
      <Step n={6} title="Resultado" done={paid.length > 0} open={result !== null || notice !== null} description="Lo limpio se aprueba para pago simulado; lo dudoso pide una persona; lo prohibido se bloquea. Cada línea dice por qué.">
        <div className="flex flex-col gap-3">
          {notice && <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">{notice}</p>}
          {result?.run.held && <p className="text-sm text-destructive">La corrida quedó retenida: el total aprobable supera los fondos libres.</p>}
          {result?.run.lines.map((line) => {
            const human = resolution[line.lineId];
            return (
              <div key={line.lineId} className={cn("rounded-lg border px-3 py-2", line.decision === "blocked" && "border-destructive/40 bg-destructive/5")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{FISCAL_TYPE[line.fiscalType]}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{line.amountMinor === null ? "—" : formatMinor(line.amountMinor, currency)}</span>
                  <Badge variant={FISCAL_OUTCOME[line.decision].variant}>{FISCAL_OUTCOME[line.decision].label}</Badge>
                  {line.decision !== "approved" &&
                    line.reasonCodes
                      .filter((code) => code !== "HUMAN_APPROVAL_REQUIRED")
                      .map((code) => (
                        <Badge key={code} variant="outline">
                          {FISCAL_REASON[code]}
                        </Badge>
                      ))}
                  {human === "approved_by_human" && <Badge>Aprobada por una persona</Badge>}
                  {human === "rejected" && <Badge variant="destructive">Rechazada</Badge>}
                  {line.decision === "requires_approval" && human === undefined && (
                    <span className="ml-auto flex gap-2">
                      <Button size="sm" onClick={() => approve(line.lineId)}>
                        Aprobar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setResolution((r) => ({ ...r, [line.lineId]: "rejected" }))}>
                        Rechazar
                      </Button>
                    </span>
                  )}
                </div>
                <details className="mt-1 text-sm">
                  <summary className="cursor-pointer text-muted-foreground">{line.explanation}</summary>
                  <ul className="mt-2 flex flex-col gap-1 border-t pt-2 text-xs">
                    {line.rulesEvaluated.map((rule) => (
                      <li key={rule.ruleId} className="flex gap-2">
                        <span aria-hidden>{rule.result === "pass" ? "✓" : rule.result === "fail" ? "✗" : "?"}</span>
                        <span>
                          <span className="font-medium">{FISCAL_RULE[rule.ruleId] ?? rule.ruleId}</span>
                          <span className="text-muted-foreground"> · {rule.explanation}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            );
          })}
          {result !== null && (
            <div>
              <Button onClick={paySimulated}>Registrar pago simulado</Button>
              <span className="ml-3 text-xs text-muted-foreground">Revalida antes de registrar. No se mueve dinero.</span>
            </div>
          )}
        </div>
      </Step>
    </ol>
  );
}

function Step({ n, title, description, done, open, children }: { n: number; title: string; description: string; done: boolean; open: boolean; children: React.ReactNode }) {
  return (
    <li>
      <Card className={cn(!open && "opacity-50")}>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full border text-sm", done && "border-transparent bg-primary text-primary-foreground")}>
              {done ? <Check className="size-4" /> : n}
            </span>
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {open && <CardContent>{children}</CardContent>}
      </Card>
    </li>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn("rounded-full border px-3 py-1 text-sm", active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/70")}
    >
      {children}
    </button>
  );
}

function Fact({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-muted/30 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-base font-semibold tabular-nums", alert && "text-destructive")}>{value}</span>
    </div>
  );
}

function Field({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} inputMode="decimal" onChange={(e) => onChange(e.target.value)} />
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}
