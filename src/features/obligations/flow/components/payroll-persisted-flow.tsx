"use client";
/**
 * Purpose: contrato proactivo de nómina como flujo de React Flow, sobre la plantilla GUARDADA: fuente
 *   de RR. HH. → plantilla (versiones, activar, pausar) → calendario → reloj → corridas → por resolver
 *   → pagos. Cada nodo abre su panel con los mismos formularios y datos que ya existían en
 *   Obligaciones y Corridas, ahora dentro de Contratos.
 * Runs in: browser (cargado sin SSR desde process-loader.tsx); los datos llegan del servidor.
 * Triggered by: /obligations/payroll.
 * Receives → Returns: ProactiveData (disponible) → el lienzo y el panel del paso elegido.
 * Talks to: ../data (tipos), ../labels, ../../components/obligation-forms (formularios con server actions),
 *   ../../labels, ../../schedule/calendar, decisions/labels, contracts/money, ./process-canvas, shadcn Badge.
 */
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatMinor } from "@/features/contracts/money";
import { REASON_LABEL } from "@/features/decisions/labels";
import type { ReasonCode } from "@/shared/schemas/payment-decision";
import { ActivateButton, AdvanceClockForm, DraftForm, PauseButton, ResolveLineForm, SeedHistoryForm } from "../../components/obligation-forms";
import { LINE_TYPE_LABEL, OBLIGATION_STATUS_LABEL } from "../../labels";
import { SCHEDULE_RULE_LABELS } from "../../schedule/calendar";
import type { ProactiveData } from "../data";
import { FLOW_OUTCOME, RUN_PHASE_LABEL, RUN_STATUS_LABEL } from "../labels";
import { ProcessCanvas, type ProcessStep, type StepStatus } from "./process-canvas";

type Ready = Extract<ProactiveData, { available: true }>;

const EDGES = [
  ["source", "rules"],
  ["rules", "schedule"],
  ["schedule", "clock"],
  ["clock", "runs"],
  ["runs", "approvals"],
  ["approvals", "payments"],
].map(([source, target]) => ({ id: `${source}-${target}`, source, target }));

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
  const pending = overview.runs.flatMap((run) => run.requests.filter((r) => r.status === "pending").map((request) => ({ run, request })));
  const payments = overview.runs.flatMap((run) => run.payments.map((payment) => ({ run, payment })));
  const attentionRuns = overview.runs.filter((r) => ["held", "failed"].includes(r.occurrence.status)).length;

  const st = (s: StepStatus) => s;
  const steps: ProcessStep[] = [
    { id: "source", title: "Fuente de RR. HH.", icon: "source", summary: latest ? `Buk · ${latest.settings.source.scenario}` : "Sin configurar", status: st(latest ? "done" : "ready"), x: 0, y: 0 },
    { id: "rules", title: "Plantilla de nómina", icon: "rules", summary: latest ? `v${latest.version} · ${OBLIGATION_STATUS_LABEL[latest.status]}` : "Crear la primera", status: st(!latest ? "ready" : latest.status === "active" ? "done" : "attention"), x: 330, y: 0 },
    { id: "schedule", title: "Calendario", icon: "clock", summary: latest ? `${SCHEDULE_RULE_LABELS[latest.settings.schedule.rule]} · preparar ${latest.settings.schedule.leadDays} d antes` : "Sin plantilla", status: st(latest ? "done" : "idle"), x: 660, y: 0 },
    { id: "clock", title: "Hoy", icon: "proposal", summary: data.today, status: st("done"), x: 990, y: 0 },
    { id: "runs", title: "Corridas", icon: "evaluate", summary: overview.runs.length === 0 ? "Todavía no hay" : `${overview.runs.length} reciente${overview.runs.length === 1 ? "" : "s"}`, status: st(overview.runs.length === 0 ? "idle" : attentionRuns > 0 ? "attention" : "done"), x: 0, y: 220 },
    { id: "approvals", title: "Por resolver", icon: "approvals", summary: pending.length === 0 ? "Sin pendientes" : `${pending.length} pendiente${pending.length === 1 ? "" : "s"}`, status: st(pending.length > 0 ? "attention" : overview.runs.length > 0 ? "done" : "idle"), x: 330, y: 220 },
    { id: "payments", title: "Pagos", icon: "payment", summary: payments.length === 0 ? "Nada pagado" : `${payments.length} pago${payments.length === 1 ? "" : "s"} registrado${payments.length === 1 ? "" : "s"}`, status: st(payments.length > 0 ? "done" : "idle"), x: 660, y: 220 },
  ];
  const stepOf = selected ?? "rules";
  const titles = Object.fromEntries(steps.map((s) => [s.id, s.title])) as Record<string, string>;

  const panel = (
    <>
      {stepOf === "source" && (
        <Section description="Pacta lee de Buk (recursos humanos): empleados, nómina del mes, licencias y retiros. La fuente se elige al guardar una versión de la plantilla.">
          {latest ? <Fact label="Fuente" value={latest.settings.source.scenario} /> : <p className="text-sm text-muted-foreground">Aún no hay plantilla. Créala en «Plantilla de nómina».</p>}
        </Section>
      )}

      {stepOf === "rules" && (
        <Section description="Cada cambio crea una versión nueva; las corridas ya preparadas conservan la suya. Una plantilla no opera hasta que una persona autorizada la activa.">
          {versions.length > 0 && (
            <ul className="flex flex-col gap-2">
              {versions.map((o) => (
                <li key={o.id} className="flex flex-col gap-2 rounded-lg p-2 text-sm ring-1 ring-black/5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">Versión {o.version}</span>
                    <Badge variant={o.status === "active" ? "default" : o.status === "paused" ? "outline" : "secondary"}>{OBLIGATION_STATUS_LABEL[o.status]}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tolerancia {(o.template.varianceToleranceBps / 100).toFixed(1)} % · tope {formatMinor(o.template.runCapMinor, o.template.currency)}
                    {o.activatedAt ? ` · activada ${o.activatedAt.slice(0, 10)} por ${o.activatedBy}` : ""}
                  </p>
                  {data.canManage && (
                    <div>
                      {(o.status === "draft" || o.status === "paused") && data.canApprove && <ActivateButton obligationId={o.obligationId} version={o.version} />}
                      {o.status === "active" && <PauseButton obligationId={o.obligationId} version={o.version} />}
                      {(o.status === "draft" || o.status === "paused") && !data.canApprove && <span className="text-xs text-muted-foreground">Falta permiso de aprobación</span>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {data.canManage ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{latest ? "Nueva versión" : "Crear plantilla de nómina"}</p>
              <DraftForm scenarios={data.scenarios} today={data.today} defaultScenario={data.defaultScenario} defaultSchedule={latest?.settings.schedule} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Necesitas el permiso de gestionar políticas para crear o activar plantillas.</p>
          )}
        </Section>
      )}

      {stepOf === "schedule" && (
        <Section description="El calendario define cuándo vence cada pago. Pacta prepara la corrida con anticipación, avisa y paga el día del vencimiento tras volver a validar.">
          {latest ? (
            <div className="grid grid-cols-2 gap-2">
              <Fact label="Regla" value={SCHEDULE_RULE_LABELS[latest.settings.schedule.rule]} />
              <Fact label="Preparar" value={`${latest.settings.schedule.leadDays} días antes`} />
              {latest.settings.schedule.rule === "day_of_month" && <Fact label="Día del mes" value={String(latest.settings.schedule.day)} />}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Crea una plantilla para definir el calendario.</p>
          )}
          <p className="text-xs text-muted-foreground">Para cambiarlo, guarda una versión nueva en «Plantilla de nómina».</p>
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

  return <ProcessCanvas title="Nómina" steps={steps} edges={EDGES} selectedId={selected} onSelect={setSelected} panelTitle={titles[stepOf] ?? "Paso"} panel={panel} backHref={backHref} wide={stepOf === "rules"} />;
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
