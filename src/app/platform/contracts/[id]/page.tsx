/**
 * Purpose: detalle de un contrato: flujo activo en solo lectura, borrador pendiente e historial
 *   de versiones; permite abrir el editor o terminar el contrato (solo administradores).
 * Runs in: server (React Server Component; datos dentro de <Suspense>).
 * Triggered by: GET /platform/contracts/[id].
 * Receives → Returns: request → HTML con el visor de React Flow cargado solo en el navegador.
 * Talks to: ensureWorkspaceFromSession, features/contracts (flow/server, permissions, components).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { TerminateContractButton } from "@/features/contracts/components/contract-forms";
import { FlowViewerLoader } from "@/features/contracts/components/flow/flow-loaders";
import { getContractFlow } from "@/features/contracts/flow/server";
import { checkCanManageContracts } from "@/features/contracts/permissions";
import { contractActorFromWorkspace } from "@/features/contracts/server";
import { cn } from "@/lib/utils";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";

export const metadata: Metadata = { title: "Contrato" };

export default function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <PlatformSection
      title="Contrato"
      description="Flujo de pago vigente de este contrato. Las versiones activadas no se editan: se crea una nueva y la anterior queda en el historial."
    >
      <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando contrato…</p>}>
        <Detail params={params} />
      </Suspense>
    </PlatformSection>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let workspace;
  try {
    workspace = await ensureWorkspaceFromSession();
  } catch (error) {
    if (!(error instanceof OrganizationRequiredError)) throw error;
    return <p className="text-sm text-muted-foreground">Elige una organización para ver sus contratos.</p>;
  }
  const flow = await getContractFlow(workspace.organization.id, id);
  if (flow === null) notFound();
  const canManage = checkCanManageContracts(contractActorFromWorkspace(workspace)) === null;
  const isActive = flow.status === "active";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{flow.supplierName}</h2>
        <Badge variant={isActive ? "default" : "secondary"}>{isActive ? "activo" : "terminado"}</Badge>
        {flow.active !== null && <Badge variant="outline">versión {flow.active.version}</Badge>}
        {flow.draft !== null && <Badge variant="outline">borrador pendiente</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <Link href="/platform/contracts" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Volver
          </Link>
          {canManage && isActive && (
            <>
              <Link href={`/contracts/${id}/flow`} className={cn(buttonVariants({ size: "sm" }))}>
                {flow.draft !== null ? "Continuar borrador" : "Editar flujo"}
              </Link>
              <TerminateContractButton contractId={id} />
            </>
          )}
        </div>
      </div>

      {flow.active === null ? (
        <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">Este contrato no tiene una versión activa.</p>
      ) : flow.active.graph === null ? (
        <p role="alert" className="rounded-lg border border-destructive/50 px-3 py-2 text-sm text-destructive">
          El flujo guardado no pasó la validación y no se usa para comparar facturas. Las facturas de este proveedor se escalan.
        </p>
      ) : (
        <FlowViewerLoader graph={flow.active.graph} />
      )}

      <section aria-labelledby="history" className="flex flex-col gap-2">
        <h3 id="history" className="text-sm font-medium text-muted-foreground">Historial de versiones</h3>
        {flow.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin versiones anteriores.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border text-sm">
            {flow.history.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-medium">Versión {v.version}</span>{" "}
                  <span className="text-muted-foreground">
                    · {v.status === "active" ? "activa" : "reemplazada"} · {(v.activatedAt ?? v.createdAt).slice(0, 10)} · {v.activatedBy ?? v.createdBy}
                  </span>
                </span>
                <code className="text-xs text-muted-foreground" title="Huella sha256 del flujo">{v.graphSha256.slice(0, 12)}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
