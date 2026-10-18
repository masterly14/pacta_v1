"use client";
/**
 * Purpose: contrato proactivo de nómina como flujo de React Flow, sobre la plantilla GUARDADA. Cada
 *   nodo arma una parte de la plantilla y se edita en su propio panel (fuente, reglas de control,
 *   calendario) sin volver a otro nodo; el botón «Guardar nueva versión» está en cada uno. Los demás
 *   nodos muestran la operación: hoy, corridas, por resolver y pagos.
 * Runs in: browser (cargado sin SSR desde process-loader.tsx); los datos llegan del servidor.
 * Triggered by: /obligations/payroll.
 * Receives → Returns: ProactiveData → el lienzo y el panel del paso elegido.
 * Talks to: ../data (tipos), ../labels, ../../actions#saveDraftAction, ../../components/obligation-forms
 *   (activar, pausar, reloj, resolver), ../../schedule (calendario y editor), decisions/labels,
 *   contracts/money, ./process-canvas, shadcn Badge, Button, Input, Label.
 */
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMinor } from "@/features/contracts/money";
import { REASON_LABEL } from "@/features/decisions/labels";
import { useFormAction } from "@/shared/forms/use-form-action";
import type { ReasonCode } from "@/shared/schemas/payment-decision";
import { saveDraftAction } from "../../actions";
import { ActivateButton, AdvanceClockForm, PauseButton, ResolveLineForm, SeedHistoryForm } from "../../components/obligation-forms";
import { LINE_TYPE_LABEL, OBLIGATION_STATUS_LABEL } from "../../labels";
import { DEFAULT_SCHEDULE, SCHEDULE_RULE_LABELS, type Schedule } from "../../schedule/calendar";
import { ScheduleEditor } from "../../schedule/components/schedule-editor";
import type { ProactiveData } from "../data";
import { FLOW_OUTCOME, RUN_PHASE_LABEL, RUN_STATUS_LABEL } from "../labels";
import { ProcessCanvas, type ProcessStep, type StepStatus } from "./process-canvas";

type Ready = Extract<ProactiveData, { available: true }>;

// Lo que arman los nodos de plantilla; se guarda junto como una versión nueva en borrador.
type Draft = { scenario: string; schedule: Schedule; tolerancePercent: string; runCapPesos: string };

const DEFAULT_TOLERANCE = "10";
const DEFAULT_CAP_PESOS = "120000000";

const EDGES = [
  ["source", "rules"],
  ["rules", "schedule"],
  ["schedule", "clock"],
  ["clock", "runs"],
  ["runs", "approvals"],
  ["approvals", "payments"],
].map(([source, target]) => ({ id: `${source}-${target}`, source, target }));

const TEMPLATE_STEPS = new Set(["source", "rules", "schedule"]);

// JSON con claves ordenadas: el calendario que vuelve de la base puede traer las claves en otro orden.
const stable = (value: unknown): string => JSON.stringify(value, (_key, v) => (v !== null && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v));

export function PayrollPersistedFlow({ data, backHref }: { data: ProactiveData; backHref: string }) {
  if (!data.available) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="max-w-md text-sm text-muted-foreground">No se pudieron cargar las obligaciones en este momento. Intenta de nuevo en unos minutos.</p>
        <a href={backHref} className="text-sm underline">Volver a Contratos</a>
      </div>
    );
  }
  return <Flow data={data} backHref={backHref} />;
}

function Flow({ data, backHref }: { data: Ready; backHref: string }) {
  const { overview } = data;
  const [selected, setSelected] = useState<string | null>("rules");

  // La plantilla vigente es la última versión; las anteriores quedan en el historial.
  const versions = useMemo(() => [...overview.obligations].sort((a, b) => b.version - a.version), [overview.obligations]);
  const latest = versions[0] ?? null;

  // Punto de partida del borrador: la última versión guardada (o los valores por omisión).
  const base = useMemo<Draft>(
    () => ({
      scenario: latest?.settings.source.scenario ?? data.defaultScenario,
      schedule: latest?.settings.schedule ?? DEFAULT_SCHEDULE,
      tolerancePercent: latest ? String(latest.template.varianceToleranceBps / 100) : DEFAULT_TOLERANCE,
      runCapPesos: latest ? String(Math.round(latest.template.runCapMinor / 100)) : DEFAULT_CAP_PESOS,
    }),
    [latest, data.defaultScenario],
  );
  const [draft, setDraft] = useState<Draft>(base);
  const dirty = latest === null || stable(draft) !== stable(base);
  const patch = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }));

  const pending = overview.runs.flatMap((run) => run.requests.filter((r) => r.status === "pending").map((request) => ({ run, request })));
  const payments = overview.runs.flatMap((run) => run.payments.map((payment) => ({ run, payment })));
  const attentionRuns = overview.runs.filter((r) => ["held", "failed"].includes(r.occurrence.status)).length;
  const editedHint = latest !== null && dirty ? "Cambios sin guardar" : null;

  const st = (s: StepStatus) => s;
  const steps: ProcessStep[] = [
    { id: "source", title: "Fuente de RR. HH.", icon: "source", summary: editedHint ?? `Buk · ${draft.scenario}`, status: st(editedHint ? "attention" : latest ? "done" : "ready"), x: 0, y: 0 },
    { id: "rules", title: "Plantilla de nómina", icon: "rules", summary: editedHint ?? (latest ? `v${latest.version} · ${OBLIGATION_STATUS_LABEL[latest.status]}` : "Crear la primera"), status: st(editedHint ? "attention" : !latest ? "ready" : latest.status === "active" ? "done" : "attention"), x: 330, y: 0 },
    { id: "schedule", title: "Calendario", icon: "clock", summary: editedHint ?? `${SCHEDULE_RULE_LABELS[draft.schedule.rule]} · preparar ${draft.schedule.leadDays} d antes`, status: st(editedHint ? "attention" : latest ? "done" : "ready"), x: 660, y: 0 },
    { id: "clock", title: "Hoy", icon: "proposal", summary: data.today, status: st("done"), x: 990, y: 0 },
    { id: "runs", title: "Corridas", icon: "evaluate", summary: overview.runs.length === 0 ? "Todavía no hay" : `${overview.runs.length} reciente${overview.runs.length === 1 ? "" : "s"}`, status: st(overview.runs.length === 0 ? "idle" : attentionRuns > 0 ? "attention" : "done"), x: 0, y: 220 },
    { id: "approvals", title: "Por resolver", icon: "approvals", summary: pending.length === 0 ? "Sin pendientes" : `${pending.length} pendiente${pending.length === 1 ? "" : "s"}`, status: st(pending.length > 0 ? "attention" : overview.runs.length > 0 ? "done" : "idle"), x: 330, y: 220 },
    { id: "payments", title: "Pagos", icon: "payment", summary: payments.length === 0 ? "Nada pagado" : `${payments.length} pago${payments.length === 1 ? "" : "s"} registrado${payments.length === 1 ? "" : "s"}`, status: st(payments.length > 0 ? "done" : "idle"), x: 660, y: 220 },
  ];
  const stepOf = selected ?? "rules";
  const titles = Object.fromEntries(steps.map((s) => [s.id, s.title])) as Record<string, string>;

  const body = (
    <>
      {stepOf === "source" && (
        <Section description="De dónde lee Pacta los datos de recursos humanos: empleados, nómina del mes, licencias y retiros.">
          <Field label="Fuente de RR. HH." hint="Buk (Colombia). El escenario define qué datos trae.">
            {data.canManage ? (
              <select className={selectClass} value={draft.scenario} onChange={(e) => patch({ scenario: e.target.value })}>
                {data.scenarios.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            ) : (
              <p className="text-sm font-medium">{draft.scenario}</p>
            )}
          </Field>
        </Section>
      )}

      {stepOf === "rules" && (
        <div className="flex flex-col gap-5">
          <Section title="Estado" description="Una plantilla no opera hasta que una persona autorizada la activa. Cada cambio crea una versión nueva y las corridas ya preparadas conservan la suya.">
            {latest === null ? (
              <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">Todavía no hay plantilla. Define la fuente, las reglas y el calendario en sus nodos y guarda la primera versión.</p>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-black/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">Versión {latest.version}</span>
                  <Badge variant={latest.status === "active" ? "default" : latest.status === "paused" ? "outline" : "secondary"}>{OBLIGATION_STATUS_LABEL[latest.status]}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {latest.status === "active" ? `Activa desde ${latest.activatedAt?.slice(0, 10)} por ${latest.activatedBy}.` : latest.status === "draft" ? "Está en borrador: actívala para que Pacta empiece a preparar corridas." : "Está pausada: no se preparan corridas nuevas."}
                </p>
                {data.canManage && (
                  <div className="flex items-center gap-2">
                    {(latest.status === "draft" || latest.status === "paused") && data.canApprove && <ActivateButton obligationId={latest.obligationId} version={latest.version} />}
                    {latest.status === "active" && <PauseButton obligationId={latest.obligationId} version={latest.version} />}
                    {(latest.status === "draft" || latest.status === "paused") && !data.canApprove && <span className="text-xs text-muted-foreground">Falta permiso de aprobación para activarla</span>}
                  </div>
                )}
              </div>
            )}
          </Section>

          <Section title="Reglas de control" description="Dentro de estos límites Pacta puede aprobar sola; fuera de ellos escala a una persona.">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tolerancia del salario (%)" hint="Variación aceptada frente al último salario confirmado.">
                <Input type="number" min={0} max={100} step={0.5} disabled={!data.canManage} value={draft.tolerancePercent} onChange={(e) => patch({ tolerancePercent: e.target.value })} />
              </Field>
              <Field label="Tope de la corrida (COP)" hint="Si el total lo supera, la corrida pide aprobación.">
                <Input type="number" min={1} step={1000000} disabled={!data.canManage} value={draft.runCapPesos} onChange={(e) => patch({ runCapPesos: e.target.value })} />
              </Field>
            </div>
            <p className="text-[0.7rem] text-muted-foreground">Un cambio de cuenta o de referencia de pago nunca se aprueba solo, sin importar estas reglas.</p>
          </Section>

          {versions.length > 1 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Historial de versiones ({versions.length})</summary>
              <ul className="mt-2 flex flex-col gap-1.5">
                {versions.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs ring-1 ring-black/5">
                    <span>
                      <span className="font-medium">v{o.version}</span> · {SCHEDULE_RULE_LABELS[o.settings.schedule.rule]} · tolerancia {(o.template.varianceToleranceBps / 100).toFixed(1)} % · tope {formatMinor(o.template.runCapMinor, o.template.currency)}
                    </span>
                    <Badge variant={o.status === "active" ? "default" : "outline"}>{OBLIGATION_STATUS_LABEL[o.status]}</Badge>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {stepOf === "schedule" && (
        <Section description="Cuándo vence cada pago. Pacta prepara la corrida con anticipación, avisa y paga el día del vencimiento tras volver a validar.">
          {data.canManage ? (
            <ScheduleEditor today={data.today} defaultValue={draft.schedule} onChange={(schedule) => patch({ schedule })} />
          ) : (
            <p className="text-sm font-medium">{SCHEDULE_RULE_LABELS[draft.schedule.rule]} · preparar {draft.schedule.leadDays} días antes</p>
          )}
        </Section>
      )}

      {stepOf === "clock" && (
        <Section description={data.clockMode === "demo" ? "El reloj de demo mueve la fecha para recorrer los avisos y los pagos." : "Los avisos y pagos siguen el calendario real."}>
          <Fact label="Hoy" value={data.today} />
          {data.demoTools && data.isAdmin && (
            <div className="flex flex-col gap-3">
              <AdvanceClockForm currentDate={data.today} />
              {overview.runs.length === 0 && <SeedHistoryForm />}
            </div>
          )}
        </Section>
      )}

      {stepOf === "runs" && (
        <Section description="Cada corrida se prepara antes del vencimiento, se vuelve a evaluar justo antes de pagar y solo paga lo que sigue siendo correcto. Lo dudoso espera a una persona.">
          {overview.runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay corridas. Activa una plantilla; la primera se prepara cuando llegue su fecha.</p>
          ) : (
            overview.runs.map((run) => {
              const paid = new Set(run.payments.map((p) => p.lineId));
              const claims = overview.claims.filter((c) => c.periodStart === run.occurrence.periodStart && c.obligationId === run.occurrence.obligationId);
              return (
                <div key={run.occurrence.id} className="flex flex-col gap-2 rounded-lg p-2 ring-1 ring-black/5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium">Nómina {run.occurrence.periodStart.slice(0, 7)}</span>
                    <Badge variant="outline">{RUN_STATUS_LABEL[run.occurrence.status] ?? run.occurrence.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">Vence {run.occurrence.dueDate} · {run.payments.length} pago(s) · {run.requests.filter((r) => r.status === "pending").length} por resolver</p>
                  {claims.length > 0 && (
                    <ol className="flex flex-wrap gap-x-3 gap-y-0.5 text-[0.7rem] text-muted-foreground">
                      {claims.map((c) => (
                        <li key={c.phase}>
                          <span className="font-medium text-foreground">{RUN_PHASE_LABEL[c.phase] ?? c.phase}</span> · {c.asOf.slice(0, 10)}
                        </li>
                      ))}
                    </ol>
                  )}
                  <ul className="divide-y rounded-lg text-xs ring-1 ring-black/5">
                    {run.lines.map((line) => {
                      const outcome = FLOW_OUTCOME[line.decision];
                      return (
                        <li key={line.lineId} className="flex flex-col gap-1 px-2 py-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <span className="font-medium">{line.displayName}</span>
                            <span className="tabular-nums text-muted-foreground">{line.amountMinor === null || line.currency === null ? "—" : formatMinor(line.amountMinor, line.currency)}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            <Badge variant={outcome.variant}>{outcome.label}</Badge>
                            <Badge variant="outline">{LINE_TYPE_LABEL[line.lineType] ?? line.lineType}</Badge>
                            {line.reasonCodes.map((code) => (
                              <Badge key={code} variant="outline">{REASON_LABEL[code as ReasonCode] ?? code}</Badge>
                            ))}
                            {paid.has(line.lineId) && <Badge>Pagada</Badge>}
                          </div>
                          {line.decisionSource === "human" && <span className="text-muted-foreground">Resuelta por una persona{line.comment ? `: ${line.comment}` : ""}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
        </Section>
      )}

      {stepOf === "approvals" && (
        <Section description="Las excepciones que el motor no puede aprobar solo esperan a una persona con permiso. Un bloqueo absoluto no se aprueba.">
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay nada por resolver.</p>
          ) : (
            pending.map(({ run, request }) => (
              <div key={request.id} className="flex flex-col gap-2 rounded-lg p-2 ring-1 ring-black/5">
                <div className="text-sm">
                  <span className="font-medium">{request.decision?.displayName ?? request.lineId}</span>
                  <span className="text-xs text-muted-foreground"> · Nómina {run.occurrence.periodStart.slice(0, 7)}</span>
                </div>
                <ul className="list-disc pl-5 text-xs text-muted-foreground">
                  {(request.decision?.rules ?? []).filter((rule) => rule.result !== "pass").map((rule) => (
                    <li key={`${rule.ruleId}-${rule.explanation}`}>{rule.explanation}</li>
                  ))}
                </ul>
                {data.canApprove ? <ResolveLineForm requestId={request.id} /> : <p className="text-xs text-muted-foreground">No tienes permiso de aprobación: solo puedes ver qué escaló y por qué.</p>}
              </div>
            ))
          )}
        </Section>
      )}

      {stepOf === "payments" && (
        <Section description="Pagos registrados por el agente tras volver a validar cada línea.">
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no se ha pagado ninguna línea.</p>
          ) : (
            <ul className="divide-y rounded-lg text-sm ring-1 ring-black/5">
              {payments.map(({ run, payment }) => (
                <li key={payment.id} className="flex flex-wrap justify-between gap-1 px-3 py-2">
                  <span>
                    {run.lines.find((l) => l.lineId === payment.lineId)?.displayName ?? payment.lineId}
                    <span className="text-xs text-muted-foreground"> · {payment.executedAt.slice(0, 10)}</span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">{formatMinor(payment.amountMinor, payment.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
  );

  // La barra de guardado acompaña a los tres nodos que arman la plantilla: se edita y se guarda desde cualquiera.
  const panel = (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-col gap-4">{body}</div>
      {TEMPLATE_STEPS.has(stepOf) && data.canManage && <SaveBar draft={draft} dirty={dirty} first={latest === null} onReset={() => setDraft(base)} />}
    </div>
  );

  return <ProcessCanvas title="Nómina" steps={steps} edges={EDGES} selectedId={selected} onSelect={setSelected} panelTitle={titles[stepOf] ?? "Paso"} panel={panel} backHref={backHref} wide={stepOf === "schedule" || stepOf === "rules"} />;
}

const selectClass = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function SaveBar({ draft, dirty, first, onReset }: { draft: Draft; dirty: boolean; first: boolean; onReset: () => void }) {
  const { state, pending, onSubmit } = useFormAction(saveDraftAction);
  return (
    <form onSubmit={onSubmit} className="sticky bottom-0 -mx-3 -mb-3 mt-auto flex flex-col gap-2 rounded-b-xl border-t bg-background p-3">
      <input type="hidden" name="scenario" value={draft.scenario} />
      <input type="hidden" name="schedule" value={JSON.stringify(draft.schedule)} />
      <input type="hidden" name="tolerancePercent" value={draft.tolerancePercent} />
      <input type="hidden" name="runCapPesos" value={draft.runCapPesos} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{dirty ? (first ? "Todavía no se ha guardado la primera versión." : "Hay cambios sin guardar.") : "Todo guardado."}</p>
        <div className="flex gap-2">
          {dirty && !first && (
            <Button type="button" size="sm" variant="ghost" onClick={onReset}>
              Descartar
            </Button>
          )}
          <Button type="submit" size="sm" disabled={pending || !dirty}>
            {pending ? "Guardando…" : first ? "Guardar primera versión" : "Guardar nueva versión"}
          </Button>
        </div>
      </div>
      {state !== null && (
        <p role="status" className={state.ok ? "text-xs text-emerald-600" : "text-xs text-destructive"}>
          {state.message}
        </p>
      )}
    </form>
  );
}

function Section({ title, description, children }: { title?: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        {title !== undefined && <h3 className="text-sm font-semibold">{title}</h3>}
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint !== undefined && <p className="text-[0.7rem] text-muted-foreground">{hint}</p>}
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
