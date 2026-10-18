/**
 * Purpose: corridas de pago (nómina): línea de tiempo del calendario, qué se aprobó solo, qué escaló y por qué, y la
 *   bandeja donde una persona con permiso resuelve las excepciones. Con las herramientas de prueba activas, también el
 *   reloj de demo y la carga de la historia fixture.
 * Runs in: servidor (RSC; datos dentro de <Suspense>) + formularios cliente.
 * Triggered by: GET /platform/runs y refresh() tras resolver, avanzar el reloj o sembrar.
 * Receives → Returns: petición → HTML dentro de la plataforma.
 * Talks to: ensureWorkspaceFromSession, policies/server#loadPolicyActor, obligations/server, obligation-forms, decisions/labels.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMinor } from "@/features/contracts/money";
import { REASON_LABEL } from "@/features/decisions/labels";
import { AdvanceClockForm, ResolveLineForm, SeedHistoryForm } from "@/features/obligations/components/obligation-forms";
import { LINE_TYPE_LABEL, OCCURRENCE_STATUS_LABEL, OUTCOME_LABEL, PHASE_LABEL } from "@/features/obligations/labels";
import { defaultRuntime, getObligationsOverview } from "@/features/obligations/server";
import type { Phase } from "@/features/obligations/store";
import { bogotaDay } from "@/features/obligations/tick";
import { loadPolicyActor } from "@/features/policies/server";
import type { ReasonCode } from "@/shared/schemas/payment-decision";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";
import { devToolsEnabled } from "@/shared/config/dev-tools";

export const metadata: Metadata = { title: "Corridas" };

export default function RunsPage() {
  return (
    <PlatformSection
      title="Corridas"
      description="Cada corrida se prepara antes del vencimiento, se vuelve a evaluar justo antes de pagar y solo paga (en simulación) lo que sigue siendo correcto. Lo dudoso espera a una persona."
    >
      <div className="flex flex-col gap-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando corridas…</p>}>
          <RunsData />
        </Suspense>
      </div>
    </PlatformSection>
  );
}

const OUTCOME_VARIANT = { approved: "default", blocked: "destructive", requires_approval: "secondary" } as const;

async function RunsData() {
  await connection();
  let workspace;
  try {
    workspace = await ensureWorkspaceFromSession();
  } catch (error) {
    if (!(error instanceof OrganizationRequiredError)) throw error;
    return <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">Las corridas pertenecen a una organización. Elige o crea una con el selector de arriba.</p>;
  }
  const actor = await loadPolicyActor(workspace);
  const demo = devToolsEnabled();
  const overview = await getObligationsOverview(defaultRuntime(), workspace.organization.id, { demoEnabled: demo });
  const canApprove = actor.permission?.canApprove === true;
  const isAdmin = actor.role === "admin";
  const today = bogotaDay(overview.clock.now);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Reloj {overview.clock.mode === "demo" ? "de demo" : "del sistema"}</CardTitle>
          <CardDescription>
            Hoy es {today}. {overview.clock.mode === "demo" ? "El reloj de demo solo existe con las herramientas de prueba activas." : "Los avisos y pagos siguen el calendario real."}
          </CardDescription>
        </CardHeader>
        {demo && isAdmin && (
          <CardContent className="flex flex-col gap-4">
            <AdvanceClockForm currentDate={today} />
            {overview.runs.length === 0 && <SeedHistoryForm />}
          </CardContent>
        )}
      </Card>

      {overview.runs.length === 0 && <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">Todavía no hay corridas. Activa una plantilla en Obligaciones; la primera se prepara cuando llegue su fecha.</p>}

      {overview.runs.map((run) => {
        const paid = new Set(run.payments.map((p) => p.lineId));
        const pending = run.requests.filter((r) => r.status === "pending");
        const claims = overview.claims.filter((c) => c.periodStart === run.occurrence.periodStart && c.obligationId === run.occurrence.obligationId);
        return (
          <Card key={run.occurrence.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                Nómina {run.occurrence.periodStart.slice(0, 7)}
                <Badge variant="outline">{OCCURRENCE_STATUS_LABEL[run.occurrence.status]}</Badge>
              </CardTitle>
              <CardDescription>
                Vence {run.occurrence.dueDate} · {run.payments.length} pago(s) simulado(s) · {pending.length} por resolver · datos de RR. HH.: fixture
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {claims.length > 0 && (
                <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {claims.map((c) => (
                    <li key={c.phase}>
                      <span className="font-medium text-foreground">{PHASE_LABEL[c.phase as Phase]}</span> · {c.asOf.slice(0, 10)}
                    </li>
                  ))}
                </ol>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Persona</TableHead>
                    <TableHead>Clase</TableHead>
                    <TableHead>Monto</TableHead>
                    <TableHead>Decisión</TableHead>
                    <TableHead>Motivos</TableHead>
                    <TableHead>Pago</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.lines.map((line) => (
                    <TableRow key={line.lineId} className="align-top">
                      <TableCell className="whitespace-normal">
                        <div className="font-medium">{line.displayName}</div>
                        {line.decisionSource === "human" && (
                          <div className="text-xs text-muted-foreground">
                            Resuelta por una persona{line.comment ? `: ${line.comment}` : ""}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{LINE_TYPE_LABEL[line.lineType] ?? line.lineType}</TableCell>
                      <TableCell>{line.amountMinor === null || line.currency === null ? "—" : formatMinor(line.amountMinor, line.currency)}</TableCell>
                      <TableCell>
                        <Badge variant={OUTCOME_VARIANT[line.decision]}>{OUTCOME_LABEL[line.decision]}</Badge>
                      </TableCell>
                      <TableCell className="max-w-64 whitespace-normal">
                        <div className="flex flex-wrap gap-1">
                          {line.reasonCodes.map((code) => (
                            <Badge key={code} variant="outline" className="text-[11px]">
                              {REASON_LABEL[code as ReasonCode] ?? code}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">{paid.has(line.lineId) ? "Simulado" : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {pending.length > 0 && (
                <div className="flex flex-col gap-3">
                  <h3 className="text-sm font-medium">Por resolver</h3>
                  {pending.map((request) => (
                    <div key={request.id} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_320px]">
                      <div className="text-sm">
                        <div className="font-medium">{request.decision?.displayName ?? request.lineId}</div>
                        <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                          {(request.decision?.rules ?? [])
                            .filter((rule) => rule.result !== "pass")
                            .map((rule) => (
                              <li key={`${rule.ruleId}-${rule.explanation}`}>{rule.explanation}</li>
                            ))}
                        </ul>
                      </div>
                      {canApprove ? <ResolveLineForm requestId={request.id} /> : <p className="text-xs text-muted-foreground">No tienes permiso de aprobación: solo puedes ver qué escaló y por qué.</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}
