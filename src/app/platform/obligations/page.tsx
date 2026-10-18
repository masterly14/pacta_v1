/**
 * Purpose: plantillas de pago recurrente (nómina): ver versiones, guardar una nueva en borrador con su calendario y fuente de
 *   RR. HH., y activarla o pausarla. Activar es la autorización explícita de una persona; sin ella nada opera en automático.
 * Runs in: servidor (RSC; datos dentro de <Suspense>) + formularios cliente.
 * Triggered by: GET /platform/obligations y refresh() tras guardar, activar o pausar.
 * Receives → Returns: petición → HTML dentro de la plataforma.
 * Talks to: ensureWorkspaceFromSession, policies/server#loadPolicyActor, obligations/server, obligation-forms, shadcn Card, Table, Badge.
 */
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMinor } from "@/features/contracts/money";
import { ActivateButton, DraftForm, PauseButton } from "@/features/obligations/components/obligation-forms";
import { OBLIGATION_STATUS_LABEL } from "@/features/obligations/labels";
import { SCHEDULE_RULE_LABELS } from "@/features/obligations/schedule/calendar";
import { availableScenarios, DEMO_SCENARIO, defaultRuntime, getObligationsOverview } from "@/features/obligations/server";
import { bogotaDay } from "@/features/obligations/tick";
import { checkCanManagePolicies } from "@/features/policies/permissions";
import { loadPolicyActor } from "@/features/policies/server";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";
import { devToolsEnabled } from "@/shared/config/dev-tools";

export const metadata: Metadata = { title: "Obligaciones" };

export default function ObligationsPage() {
  return (
    <PlatformSection
      title="Obligaciones"
      description="Pagos recurrentes que Pacta prepara y valida solo, como la nómina. Una plantilla no opera hasta que una persona autorizada la activa; aprobada significa aprobada para pago simulado."
    >
      <div className="flex flex-col gap-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando obligaciones…</p>}>
          <ObligationsData />
        </Suspense>
      </div>
    </PlatformSection>
  );
}

async function ObligationsData() {
  await connection();
  let workspace;
  try {
    workspace = await ensureWorkspaceFromSession();
  } catch (error) {
    if (!(error instanceof OrganizationRequiredError)) throw error;
    return <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">Las obligaciones pertenecen a una organización. Elige o crea una con el selector de arriba.</p>;
  }
  const organizationId = workspace.organization.id;
  const actor = await loadPolicyActor(workspace);
  const overview = await getObligationsOverview(defaultRuntime(), organizationId, { demoEnabled: devToolsEnabled() });
  const canManage = checkCanManagePolicies(actor) === null;
  const canActivate = canManage && actor.permission?.canApprove === true;
  const latest = overview.obligations[0] ?? null;
  const today = bogotaDay(overview.clock.now);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Plantillas de pago</CardTitle>
          <CardDescription>
            Cada cambio crea una versión nueva; las corridas ya preparadas conservan la suya. Datos de RR. HH.: fixture (simulado).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overview.obligations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay plantillas. Crea la primera abajo; quedará como borrador.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Versión</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Calendario</TableHead>
                  <TableHead>Fuente</TableHead>
                  <TableHead>Tolerancia</TableHead>
                  <TableHead>Tope de la corrida</TableHead>
                  <TableHead>Activada</TableHead>
                  {canManage && <TableHead className="w-48">Acción</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.obligations.map((o) => (
                  <TableRow key={o.id} className="align-top">
                    <TableCell className="font-medium">v{o.version}</TableCell>
                    <TableCell>
                      <Badge variant={o.status === "active" ? "default" : o.status === "paused" ? "outline" : "secondary"}>{OBLIGATION_STATUS_LABEL[o.status]}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-normal text-sm">
                      {SCHEDULE_RULE_LABELS[o.settings.schedule.rule]}
                      {o.settings.schedule.rule === "day_of_month" && ` (día ${o.settings.schedule.day})`}
                      <div className="text-xs text-muted-foreground">Preparar {o.settings.schedule.leadDays} días antes</div>
                    </TableCell>
                    <TableCell className="text-sm">{o.settings.source.scenario}</TableCell>
                    <TableCell>{(o.template.varianceToleranceBps / 100).toFixed(1)} %</TableCell>
                    <TableCell>{formatMinor(o.template.runCapMinor, o.template.currency)}</TableCell>
                    <TableCell className="whitespace-normal text-xs text-muted-foreground">
                      {o.activatedAt ? `${o.activatedAt.slice(0, 10)} · ${o.activatedBy}` : "—"}
                    </TableCell>
                    {canManage && (
                      <TableCell className="whitespace-normal">
                        {(o.status === "draft" || o.status === "paused") && canActivate && <ActivateButton obligationId={o.obligationId} version={o.version} />}
                        {o.status === "active" && <PauseButton obligationId={o.obligationId} version={o.version} />}
                        {(o.status === "draft" || o.status === "paused") && !canActivate && <span className="text-xs text-muted-foreground">Falta permiso de aprobación</span>}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>{latest ? "Nueva versión" : "Crear plantilla de nómina"}</CardTitle>
            <CardDescription>El calendario define cuándo Pacta prepara, avisa y ejecuta (en simulación). Se guarda como borrador hasta que lo actives.</CardDescription>
          </CardHeader>
          <CardContent>
            <DraftForm
              scenarios={availableScenarios()}
              today={today}
              defaultScenario={latest?.settings.source.scenario ?? DEMO_SCENARIO}
              defaultSchedule={latest?.settings.schedule}
            />
          </CardContent>
        </Card>
      ) : (
        <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">Necesitas el permiso de gestionar políticas para crear o activar plantillas.</p>
      )}
    </>
  );
}
