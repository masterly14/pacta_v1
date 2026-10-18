/**
 * Purpose: listar los contratos de la organización como flujos de pago (tarjetas con resumen,
 *   versión activa y acceso al editor) y registrar uno nuevo. Un contrato es evidencia para
 *   comparar facturas; nunca autoriza un pago.
 * Runs in: server (React Server Component; datos dentro de <Suspense>).
 * Triggered by: GET /platform/contracts y refresh() tras una acción de contratos.
 * Receives → Returns: request → HTML dentro del shell de la plataforma (formularios solo para
 *   administradores; aviso si la sesión no tiene organización).
 * Talks to: ensureWorkspaceFromSession, PlatformSection, features/contracts (server, permissions,
 *   money, components/contract-forms), shadcn Card, Badge, Button.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NewContractDialog } from "@/features/contracts/components/new-contract-dialog";
import { FREQUENCY_LABEL } from "@/features/contracts/components/flow/flow-model";
import { formatMinor } from "@/features/contracts/money";
import { checkCanManageContracts } from "@/features/contracts/permissions";
import { contractActorFromWorkspace, getContractsOverview } from "@/features/contracts/server";
import { loadProactiveData, latestObligations } from "@/features/obligations/flow/data";
import { OBLIGATION_STATUS_LABEL } from "@/features/obligations/labels";
import { SCHEDULE_RULE_LABELS } from "@/features/obligations/schedule/calendar";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Contratos" };

export default function ContractsPage() {
  return (
    <PlatformSection
      title="Contratos"
      description="Cada contrato es un flujo que define cómo se paga: vigencia, monto, cuenta, hitos y plazos. Las facturas se comparan con el flujo activo y las diferencias se escalan. Un contrato no autoriza pagos: solo una autorización explícita lo hace."
    >
      <div className="flex flex-col gap-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando contratos…</p>}>
          <ContractsData />
        </Suspense>
      </div>
    </PlatformSection>
  );
}

// La sesión y la BD son datos de ejecución: con cacheComponents deben leerse dentro de <Suspense>.
async function ContractsData() {
  let workspace;
  try {
    workspace = await ensureWorkspaceFromSession();
  } catch (error) {
    if (!(error instanceof OrganizationRequiredError)) throw error;
    return (
      <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        Los contratos pertenecen a una organización. Elige o crea una con el selector de arriba.
      </p>
    );
  }
  const actor = contractActorFromWorkspace(workspace);
  const overview = await getContractsOverview(workspace.organization.id);
  const canManage = checkCanManageContracts(actor) === null;
  const today = new Date().toISOString().slice(0, 10);
  const proactive = await loadProactiveData(workspace);
  const proactiveContracts = proactive.available ? latestObligations(proactive.overview) : [];
  const active = overview.contracts.filter((c) => c.status === "active");
  const terminated = overview.contracts.filter((c) => c.status === "terminated");

  return (
    <>
      {canManage && (
        <div className="flex justify-end">
          <NewContractDialog suppliers={overview.suppliers} today={today} />
        </div>
      )}

      {proactive.available && proactiveContracts.length > 0 && (
        <section aria-labelledby="proactive-contracts" className="flex flex-col gap-3">
          <h2 id="proactive-contracts" className="text-sm font-medium text-muted-foreground">
            Contratos proactivos ({proactiveContracts.length})
          </h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {proactiveContracts.map((o) => {
              const runs = proactive.overview.runs.filter((r) => r.occurrence.obligationId === o.obligationId);
              const last = runs[0] ?? null;
              const pending = runs.reduce((sum, r) => sum + r.requests.filter((q) => q.status === "pending").length, 0);
              return (
                <Card key={o.obligationId}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2">
                      {o.kind === "payroll" ? "Nómina" : "Impuestos"}
                      <Badge variant={o.status === "active" ? "default" : "secondary"}>{OBLIGATION_STATUS_LABEL[o.status]}</Badge>
                    </CardTitle>
                    <CardDescription>Recursos humanos · versión {o.version}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3 text-sm">
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                      <dt className="text-muted-foreground">Calendario</dt>
                      <dd>{SCHEDULE_RULE_LABELS[o.settings.schedule.rule]}</dd>
                      <dt className="text-muted-foreground">Tope</dt>
                      <dd>{formatMinor(o.template.runCapMinor, o.template.currency)}</dd>
                      <dt className="text-muted-foreground">Última corrida</dt>
                      <dd>{last === null ? "—" : last.occurrence.periodStart.slice(0, 7)}</dd>
                      <dt className="text-muted-foreground">Por resolver</dt>
                      <dd>{pending}</dd>
                    </dl>
                    <div>
                      <Link href="/obligations/payroll" className={cn(buttonVariants({ size: "sm" }))}>
                        Abrir flujo
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <section aria-labelledby="active-contracts" className="flex flex-col gap-3">
        <h2 id="active-contracts" className="text-sm font-medium text-muted-foreground">
          Contratos reactivos ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin contratos reactivos activos.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {active.map((contract) => (
              <Card key={contract.contractId}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    {contract.supplierName}
                    <Badge>activo</Badge>
                  </CardTitle>
                  {contract.description !== null && <CardDescription>{contract.description}</CardDescription>}
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">Monto</dt>
                    <dd>{formatMinor(contract.agreedAmountMinor, contract.currency)}</dd>
                    <dt className="text-muted-foreground">Frecuencia</dt>
                    <dd>{FREQUENCY_LABEL[contract.frequency]}</dd>
                    <dt className="text-muted-foreground">Vigencia</dt>
                    <dd>{contract.validFrom} → {contract.validTo ?? "sin fin"}</dd>
                    <dt className="text-muted-foreground">Cuenta</dt>
                    <dd>{contract.beneficiaryAccountRef ?? "—"}</dd>
                    <dt className="text-muted-foreground">Flujo</dt>
                    <dd>
                      {contract.activeFlowVersion === null ? "sin versión activa" : `versión ${contract.activeFlowVersion}`}
                      {contract.hasDraft && <span className="text-muted-foreground"> · borrador pendiente</span>}
                    </dd>
                  </dl>
                  <div className="flex gap-2">
                    <Link href={`/platform/contracts/${contract.contractId}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                      Ver flujo
                    </Link>
                    {canManage && (
                      <Link href={`/contracts/${contract.contractId}/flow`} className={cn(buttonVariants({ size: "sm" }))}>
                        Editar flujo
                      </Link>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {terminated.length > 0 && (
        <section aria-labelledby="terminated-contracts" className="flex flex-col gap-3">
          <h2 id="terminated-contracts" className="text-sm font-medium text-muted-foreground">
            Terminados ({terminated.length})
          </h2>
          <ul className="flex flex-col divide-y rounded-lg border text-sm">
            {terminated.map((contract) => (
              <li key={contract.contractId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-medium">{contract.supplierName}</span>{" "}
                  <span className="text-muted-foreground">
                    · {formatMinor(contract.agreedAmountMinor, contract.currency)} · terminado el {contract.terminatedAt?.slice(0, 10)}
                  </span>
                </span>
                <Link href={`/platform/contracts/${contract.contractId}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                  Ver historial
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
