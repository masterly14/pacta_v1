"use client";
/**
 * Purpose: plantilla de flujo "Nómina" (recursos humanos) en React Flow: Buk simulado → reglas
 *   de la plantilla → reloj → líneas de la corrida → evaluación → aprobaciones → pago simulado.
 *   El motor es decidePayrollRun; se ejecuta en el servidor sobre los 12 escenarios de Buk.
 *   Sin persistencia y sin mover dinero (`approved` = aprobado para pago simulado).
 * Runs in: browser (las lecturas y la evaluación son server actions).
 * Triggered by: /obligations/payroll (vía process-loader).
 * Receives → Returns: lista de escenarios → el lienzo con el estado del proceso y el panel del paso elegido.
 * Talks to: ../payroll-actions, ../../fiscal/labels (resultados), decisions/labels (motivos), ./process-canvas,
 *   contracts/money#formatMinor, shadcn Button, Input, Label, Switch, Badge.
 */
import { Check, Loader2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatMinor } from "@/features/contracts/money";
import { REASON_LABEL } from "@/features/decisions/labels";
import { FISCAL_OUTCOME } from "../../fiscal/labels";
import { evaluatePayrollAction, type PayrollEvaluation, type PayrollScenarioInfo } from "../payroll-actions";
import { ProcessCanvas, type ProcessStep, type StepStatus } from "./process-canvas";

const LINE_TYPE: Record<string, string> = { salary: "Salario", bonus: "Prima", severance: "Cesantías", final_settlement: "Liquidación final" };

const RULE_LABEL: Record<string, string> = {
  datos_completos: "Datos completos",
  linea_esperada: "Empleado en la nómina",
  empleado_activo: "Empleado activo",
  empleado_sin_licencia: "Sin licencia",
  cuenta_estable: "Cuenta confirmada",
  variacion_aceptable: "Variación del salario",
  beneficios_esperados: "Beneficios esperados",
  sin_linea_duplicada: "Sin línea duplicada",
  sin_senales_pendientes: "Sin novedades pendientes",
};

const RUN_RULE_LABEL: Record<string, string> = {
  obligacion_autorizada: "Plantilla activa y dentro del tope",
  evidencia_vigente: "Datos de Buk vigentes",
  corrida_completa: "Corrida completa",
  fondos_suficientes: "Fondos para la corrida",
};

const EDGES = [
  ["source", "rules"],
  ["rules", "clock"],
  ["clock", "lines"],
  ["lines", "evaluate"],
  ["evaluate", "approvals"],
  ["approvals", "payment"],
].map(([source, target]) => ({ id: `${source}-${target}`, source, target }));

type Resolution = "approved_by_human" | "rejected";
type Rules = { active: boolean; tolerancePercent: number; evidenceMaxAgeDays: number };

export function PayrollFlow({ scenarios, backHref }: { scenarios: PayrollScenarioInfo[]; backHref: string }) {
  const [scenario, setScenario] = useState(scenarios.find((s) => s.name === "nomina-anomalias")?.name ?? scenarios[0]?.name ?? "");
  const controls = (
    <>
      <label htmlFor="payroll-scenario" className="pl-1 text-xs text-muted-foreground">Escenario de Buk</label>
      <select
        id="payroll-scenario"
        value={scenario}
        onChange={(e) => setScenario(e.target.value)}
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {scenarios.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
    </>
  );
  // Cambiar de escenario reinicia todo el recorrido.
  return <Inner key={scenario} info={scenarios.find((s) => s.name === scenario)} controls={controls} backHref={backHref} />;
}

function Inner({ info, controls, backHref }: { info: PayrollScenarioInfo | undefined; controls: React.ReactNode; backHref: string }) {
  const [selected, setSelected] = useState<string | null>("source");
  const [connected, setConnected] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [rules, setRules] = useState<Rules | null>(null);
  const [evaluation, setEvaluation] = useState<PayrollEvaluation | null>(null);
  const [evaluated, setEvaluated] = useState(false);
  const [resolution, setResolution] = useState<Record<string, Resolution>>({});
  const [paidLineIds, setPaidLineIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Descarta respuestas de una petición vieja si el usuario ya cambió reglas o fecha.
  const requestId = useRef(0);

  // Pide al servidor las líneas y la decisión para (escenario, fecha, reglas). Los resultados solo se
  // muestran tras "Evaluar": hasta entonces el flujo enseña los datos de Buk, no las decisiones.
  function load(next: { stageIndex: number; rules: Rules | null }, after?: (evaluation: PayrollEvaluation) => void) {
    if (info === undefined) return;
    const id = ++requestId.current;
    setError(null);
    startTransition(async () => {
      const state = await evaluatePayrollAction({ scenario: info.name, stageIndex: next.stageIndex, rules: next.rules });
      if (id !== requestId.current) return;
      if (!state.ok) return setError(state.error);
      setEvaluation(state.evaluation);
      after?.(state.evaluation);
    });
  }

  const invalidate = () => {
    setEvaluated(false);
    setResolution({});
    setNotice(null);
  };

  const effectiveRules: Rules | null = rules ?? evaluation?.defaults ?? null;
  const result = evaluated ? evaluation?.result : undefined;
  const currency = evaluation?.template.currency ?? "COP";
  const unresolved = result?.lines.filter((l) => l.decision === "requires_approval" && resolution[l.lineId] === undefined) ?? [];

  function changeRules(patch: Partial<Rules>) {
    if (effectiveRules === null) return;
    const next = { ...effectiveRules, ...patch };
    setRules(next);
    invalidate();
    load({ stageIndex, rules: next });
  }

  function changeStage(index: number) {
    setStageIndex(index);
    invalidate();
    load({ stageIndex: index, rules });
  }

  function approve(lineId: string) {
    const line = result?.lines.find((l) => l.lineId === lineId);
    if (!line || line.decision !== "requires_approval") return setNotice("Solo una línea que requiere aprobación puede aprobarse a mano; un bloqueo no se salta.");
    setNotice(null);
    setResolution((r) => ({ ...r, [lineId]: "approved_by_human" }));
  }

  // Pago simulado: revalida con los datos vigentes antes de registrar; una corrida retenida no paga nada.
  function paySimulated() {
    if (info === undefined) return;
    const id = ++requestId.current;
    startTransition(async () => {
      const state = await evaluatePayrollAction({ scenario: info.name, stageIndex, rules });
      if (id !== requestId.current) return;
      if (!state.ok) return setError(state.error);
      setEvaluation(state.evaluation);
      const fresh = state.evaluation.result;
      if (fresh.held) return setNotice("La corrida quedó retenida (fondos insuficientes): no se paga nada.");
      const payable = fresh.lines.filter(
        (l) => l.amountMinor !== null && !paidLineIds.includes(l.lineId) && (l.decision === "approved" || (l.decision === "requires_approval" && resolution[l.lineId] === "approved_by_human")),
      );
      if (payable.length === 0) return setNotice("Nada que pagar: no hay líneas aprobadas ni aprobadas por una persona.");
      const total = payable.reduce((sum, l) => sum + (l.amountMinor as number), 0);
      setPaidLineIds((current) => [...current, ...payable.map((l) => l.lineId)]);
      setNotice(`Pago simulado registrado: ${payable.length} líneas por ${formatMinor(total, currency)}. No se movió dinero.`);
    });
  }

  const paidTotal = evaluation?.result.lines.filter((l) => paidLineIds.includes(l.lineId)).reduce((sum, l) => sum + (l.amountMinor ?? 0), 0) ?? 0;
  const st = (s: StepStatus) => s;
  const steps: ProcessStep[] = [
    { id: "source", title: "Buk (simulado)", icon: "source", summary: connected ? `${info?.name ?? ""} · ${info?.period ?? ""}` : "Sin conectar", status: st(connected ? (error !== null ? "blocked" : "done") : "ready"), x: 0, y: 0 },
    { id: "rules", title: "Plantilla de nómina", icon: "rules", summary: evaluation === null ? "Sin leer" : effectiveRules?.active ? `Activa · v${evaluation.template.version}` : "En borrador", status: st(evaluation === null ? "idle" : effectiveRules?.active ? "done" : "attention"), x: 330, y: 0 },
    { id: "clock", title: "Reloj de demo", icon: "clock", summary: evaluation === null ? "—" : (evaluation.stages[stageIndex]?.stage ?? "—"), status: st(evaluation === null ? "idle" : "done"), x: 660, y: 0 },
    { id: "lines", title: "Líneas de la corrida", icon: "lines", summary: evaluation === null ? "—" : `${evaluation.lines.length} líneas · ${evaluation.evidence.expectedCount} esperados`, status: st(evaluation === null ? "idle" : "done"), x: 990, y: 0 },
    { id: "evaluate", title: "Evaluar nómina", icon: "evaluate", summary: result ? `${result.counts.approved} aprobadas · ${result.counts.requires_approval} a revisar · ${result.counts.blocked} bloqueadas` : "Sin evaluar", status: st(evaluation === null ? "idle" : result ? (result.held ? "blocked" : "done") : "ready"), x: 0, y: 220 },
    { id: "approvals", title: "Aprobaciones", icon: "approvals", summary: result ? (unresolved.length > 0 ? `${unresolved.length} por resolver` : "Sin pendientes") : "Sin resultado", status: st(!result ? "idle" : unresolved.length > 0 ? "attention" : "done"), x: 330, y: 220 },
    { id: "payment", title: "Pago simulado", icon: "payment", summary: paidLineIds.length > 0 ? `${paidLineIds.length} líneas pagadas (sim.)` : "Nada pagado", status: st(paidLineIds.length > 0 ? "done" : result ? "ready" : "idle"), x: 660, y: 220 },
  ];
  const stepOf = selected ?? "source";
  const titles: Record<string, string> = Object.fromEntries(steps.map((s) => [s.id, s.title]));

  const panel = (
    <>
      {error !== null && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {pending && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Consultando…</p>}

      {stepOf === "source" && (
        <Section description="Pacta lee del simulador de Buk (recursos humanos): empleados, nómina del mes, licencias y retiros. Todo es ficticio.">
          <p className="text-xs">{info?.description}</p>
          {!connected ? (
            <Button onClick={() => { setConnected(true); setSelected("rules"); load({ stageIndex, rules }); }}>Conectar Buk (simulado)</Button>
          ) : evaluation !== null ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                <Check className="mr-1 inline size-4 text-emerald-600" />
                Conectado · {evaluation.scenario.organization} · periodo {evaluation.scenario.period}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Fact label="Datos de Buk del" value={evaluation.evidence.capturedAt?.slice(0, 10) ?? "—"} />
                <Fact label="Fondos libres" value={evaluation.evidence.fundsAvailableMinor === null || evaluation.evidence.fundsReservedMinor === null ? "Desconocidos" : formatMinor(Math.max(evaluation.evidence.fundsAvailableMinor - evaluation.evidence.fundsReservedMinor, 0), currency)} />
              </div>
            </div>
          ) : null}
        </Section>
      )}

      {stepOf === "rules" && (
        <Section description="Reglas de control de la empresa. Una persona activa la plantilla; sin activar, nada opera en automático.">
          {effectiveRules === null || evaluation === null ? (
            <p className="text-sm text-muted-foreground">Conecta Buk primero.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex items-center justify-between gap-2 text-sm font-medium">
                Plantilla activada por una persona
                <Switch checked={effectiveRules.active} onCheckedChange={(active) => changeRules({ active })} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <NumField label="Tolerancia de salario (%)" value={effectiveRules.tolerancePercent} min={0} max={100} step={0.5} onChange={(tolerancePercent) => changeRules({ tolerancePercent })} />
                <NumField label="Vigencia de datos (días)" value={effectiveRules.evidenceMaxAgeDays} min={0} max={30} step={1} onChange={(evidenceMaxAgeDays) => changeRules({ evidenceMaxAgeDays: Math.trunc(evidenceMaxAgeDays) })} />
              </div>
              <Fact label="Tope de la corrida" value={formatMinor(evaluation.template.runCapMinor, currency)} />
              <p className="text-[0.7rem] text-muted-foreground">Un cambio de cuenta o de referencia de pago nunca se aprueba solo, sin importar estas reglas.</p>
            </div>
          )}
        </Section>
      )}

      {stepOf === "clock" && (
        <Section description="El motor no lee el reloj: la fecha de evaluación es una entrada. Cada fecha trae lo que Buk sabía entonces (por ejemplo, un retiro que llega por webhook).">
          {evaluation === null ? (
            <p className="text-sm text-muted-foreground">Conecta Buk primero.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {evaluation.stages.map((stage, index) => (
                <li key={stage.asOf}>
                  <Button variant={index === stageIndex ? "secondary" : "outline"} size="sm" className="h-auto w-full flex-col items-start py-1.5 whitespace-normal" onClick={() => changeStage(index)}>
                    <span className="font-medium">{stage.stage} · {stage.asOf.slice(0, 10)}</span>
                    <span className="text-xs font-normal text-muted-foreground">{stage.description}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {stepOf === "lines" && (
        <Section description="Lo que Buk dice que se debe pagar este mes, línea por línea. Todavía nada está decidido.">
          {evaluation === null ? (
            <p className="text-sm text-muted-foreground">Conecta Buk primero.</p>
          ) : (
            <ul className="divide-y rounded-lg text-sm ring-1 ring-black/5">
              {evaluation.lines.map((line) => (
                <li key={line.lineId} className="flex flex-col gap-0.5 px-3 py-2">
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{line.displayName}</span>
                    <span className="tabular-nums text-muted-foreground">{line.amountMinor === null ? "sin monto" : formatMinor(line.amountMinor, currency)}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {LINE_TYPE[line.lineType] ?? line.lineType} · cuenta {line.beneficiaryAccountReference ?? "—"}
                    {line.pendingSignals > 0 && " · novedad pendiente"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {stepOf === "evaluate" && (
        <Section description="El motor determinista aplica las reglas por línea y por corrida. Aprobada significa aprobada para pago simulado.">
          <Button onClick={() => { setEvaluated(true); setResolution({}); setNotice(null); setSelected("approvals"); }} disabled={evaluation === null || pending}>
            Evaluar la nómina
          </Button>
          {result && <RunSummary result={result} />}
        </Section>
      )}

      {stepOf === "approvals" && (
        <Section description="Una persona resuelve lo que el motor no puede aprobar solo. Un bloqueo absoluto (retirado, duplicado, sin fondos) no se aprueba.">
          {!result ? (
            <p className="text-sm text-muted-foreground">Evalúa la nómina primero.</p>
          ) : (
            <>
              <RunSummary result={result} />
              <LineList lines={result.lines} currency={currency} resolution={resolution} onApprove={approve} onReject={(id) => setResolution((r) => ({ ...r, [id]: "rejected" }))} />
            </>
          )}
          {notice !== null && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
        </Section>
      )}

      {stepOf === "payment" && (
        <Section description="El agente «paga» en simulación: revalida con los datos vigentes y registra el pago. No se mueve dinero.">
          <Button onClick={paySimulated} disabled={!result || pending}>Registrar pago simulado</Button>
          {notice !== null && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
          {paidLineIds.length > 0 && <Fact label="Pagado en simulación" value={formatMinor(paidTotal, currency)} />}
        </Section>
      )}
    </>
  );

  return <ProcessCanvas title="Nómina" steps={steps} edges={EDGES} selectedId={selected} onSelect={setSelected} controls={controls} panelTitle={titles[stepOf] ?? "Paso"} panel={panel} backHref={backHref} />;
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

function NumField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value || 0))))} />
    </div>
  );
}

function RunSummary({ result }: { result: PayrollEvaluation["result"] }) {
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <div className="flex flex-wrap gap-1.5">
        <Badge>{result.counts.approved} aprobadas</Badge>
        <Badge variant="secondary">{result.counts.requires_approval} a revisar</Badge>
        <Badge variant="destructive">{result.counts.blocked} bloqueadas</Badge>
        {result.held && <Badge variant="destructive">Corrida retenida</Badge>}
      </div>
      {result.runFindings.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-muted-foreground">
          {result.runFindings.map((f, i) => (
            <li key={`${f.ruleId}-${i}`}>
              <span className="font-medium text-foreground">{RUN_RULE_LABEL[f.ruleId] ?? f.ruleId}:</span> {f.explanation}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LineList({
  lines,
  currency,
  resolution,
  onApprove,
  onReject,
}: {
  lines: PayrollEvaluation["result"]["lines"];
  currency: string;
  resolution: Record<string, Resolution>;
  onApprove: (lineId: string) => void;
  onReject: (lineId: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {lines.map((line) => {
        const outcome = FISCAL_OUTCOME[line.decision];
        const resolved = resolution[line.lineId];
        return (
          <li key={line.lineId} className="flex flex-col gap-1.5 rounded-lg p-2 text-sm ring-1 ring-black/5">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="font-medium">{line.displayName}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{line.amountMinor === null ? "—" : formatMinor(line.amountMinor, currency)}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              <Badge variant={outcome.variant}>{resolved === "approved_by_human" ? "Aprobada por una persona" : resolved === "rejected" ? "Rechazada" : outcome.label}</Badge>
              <Badge variant="outline">{LINE_TYPE[line.lineType] ?? line.lineType}</Badge>
              {line.reasonCodes.map((c) => <Badge key={c} variant="outline">{REASON_LABEL[c]}</Badge>)}
            </div>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Reglas evaluadas</summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {line.rulesEvaluated.map((r, i) => (
                  <li key={`${r.ruleId}-${i}`}>
                    {r.result === "pass" ? "✓" : "✗"} {RULE_LABEL[r.ruleId] ?? r.ruleId}
                    {r.result !== "pass" && <span> — {r.explanation}</span>}
                  </li>
                ))}
              </ul>
            </details>
            {line.decision === "requires_approval" && resolved === undefined && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onApprove(line.lineId)}>Aprobar</Button>
                <Button size="sm" variant="outline" onClick={() => onReject(line.lineId)}>Rechazar</Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
