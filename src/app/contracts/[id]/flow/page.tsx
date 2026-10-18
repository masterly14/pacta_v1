/**
 * Purpose: editor visual del flujo de un contrato a pantalla completa, fuera del shell de la
 *   plataforma (sin sidebar). Solo administradores; parte del borrador guardado o, si no hay,
 *   de la versión activa.
 * Runs in: server (React Server Component; datos dentro de <Suspense>).
 * Triggered by: GET /contracts/[id]/flow (el proxy exige sesión; aquí se vuelve a comprobar rol y organización).
 * Receives → Returns: request → el editor de React Flow (cargado solo en el navegador) con el grafo inicial.
 * Talks to: ensureWorkspaceFromSession, features/contracts (flow/server, permissions, components/flow).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { FlowEditorLoader } from "@/features/contracts/components/flow/flow-loaders";
import { getContractFlow } from "@/features/contracts/flow/server";
import { checkCanManageContracts } from "@/features/contracts/permissions";
import { contractActorFromWorkspace } from "@/features/contracts/server";
import { cn } from "@/lib/utils";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";

export const metadata: Metadata = { title: "Editar flujo de contrato" };

export default function ContractFlowPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="h-dvh w-full bg-white text-foreground">
      <Suspense fallback={<div aria-busy="true" aria-label="Cargando editor" className="h-dvh animate-pulse bg-muted/30" />}>
        <FlowData params={params} />
      </Suspense>
    </main>
  );
}

function Notice({ message, backHref, alert = false }: { message: string; backHref: string; alert?: boolean }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <p role={alert ? "alert" : undefined} className={cn("max-w-md text-sm", alert ? "text-destructive" : "text-muted-foreground")}>
        {message}
      </p>
      <Link href={backHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
        Volver
      </Link>
    </div>
  );
}

async function FlowData({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const back = `/platform/contracts/${id}`;
  let workspace;
  try {
    workspace = await ensureWorkspaceFromSession();
  } catch (error) {
    if (!(error instanceof OrganizationRequiredError)) throw error;
    return <Notice message="Elige una organización para editar contratos." backHref="/platform/contracts" />;
  }

  const denial = checkCanManageContracts(contractActorFromWorkspace(workspace));
  if (denial !== null) return <Notice message={denial} backHref={back} />;

  const flow = await getContractFlow(workspace.organization.id, id);
  if (flow === null) notFound();
  if (flow.status !== "active") return <Notice message="Un contrato terminado no se puede editar." backHref={back} />;

  const initialGraph = flow.draft?.graph ?? flow.active?.graph ?? null;
  if (initialGraph === null) {
    return <Notice alert message="No hay un flujo válido del que partir. Contacta a quien mantiene el sistema." backHref={back} />;
  }

  return (
    <FlowEditorLoader
      contractId={id}
      supplierName={flow.supplierName}
      initialGraph={initialGraph}
      baseSha256={flow.draft?.graphSha256 ?? null}
      activeVersion={flow.active?.version ?? null}
      today={new Date().toISOString().slice(0, 10)}
    />
  );
}
