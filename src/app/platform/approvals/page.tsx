/**
 * Purpose: list invoices waiting for a human decision, with the reasons they escalated, and let
 *   people with approval permission approve (after re-evaluation) or reject them.
 * Runs in: server (React Server Component; data streamed inside <Suspense>).
 * Triggered by: GET /platform/approvals and refresh() after resolving a request.
 * Receives → Returns: request → rendered HTML inside the platform shell.
 * Talks to: ensureWorkspaceFromSession, PlatformSection, decisions/server#listPendingApprovals,
 *   policies (server#loadPolicyActor, permissions, money), approvals/components/resolve-approval,
 *   contracts/money#formatMinor, shadcn Card, Table, Badge.
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResolveApproval } from "@/features/approvals/components/resolve-approval";
import { formatMinor } from "@/features/contracts/money";
import { listPendingApprovals } from "@/features/decisions/server";
import { formatUsd, toUsdInput } from "@/features/policies/money";
import { checkCanManagePolicies } from "@/features/policies/permissions";
import { loadPolicyActor } from "@/features/policies/server";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";
import { REASON_LABEL } from "@/features/decisions/labels";

export const metadata: Metadata = { title: "Aprobaciones" };

export default function ApprovalsPage() {
  return (
    <PlatformSection
      title="Aprobaciones"
      description="Facturas que una persona debe resolver. Antes de confirmar, se vuelven a evaluar las reglas vigentes."
    >
      <div className="flex flex-col gap-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando solicitudes…</p>}>
          <ApprovalsData />
        </Suspense>
      </div>
    </PlatformSection>
  );
}

// La sesión y la BD son datos de ejecución: con cacheComponents deben leerse dentro de <Suspense>.
async function ApprovalsData() {
  let workspace;
  try {
    workspace = await ensureWorkspaceFromSession();
  } catch (error) {
    if (!(error instanceof OrganizationRequiredError)) throw error;
    return (
      <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        Las aprobaciones pertenecen a una organización. Elige o crea una con el selector de arriba.
      </p>
    );
  }
  const pending = await listPendingApprovals(workspace.organization.id);
  const actor = await loadPolicyActor(workspace);
  const permission = actor.permission;
  const canApprove = permission?.canApprove === true && permission.approvalLimitMinor !== null;
  const canAuthorize = canApprove && checkCanManagePolicies(actor) === null;
  const today = new Date().toISOString().slice(0, 10);
  const nextYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pendientes</CardTitle>
        <CardDescription>
          {canApprove && permission?.approvalLimitMinor != null
            ? `Puedes aprobar hasta ${formatUsd(permission.approvalLimitMinor)}. Al aprobar, se vuelven a evaluar las reglas con los datos de hoy: un duplicado o la falta de presupuesto la bloquean igual.`
            : "No tienes permiso de aprobación: solo puedes ver qué escaló y por qué. Un administrador puede otorgártelo en Políticas."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay nada esperando aprobación.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Factura</TableHead>
                <TableHead>Monto</TableHead>
                <TableHead>Motivos</TableHead>
                <TableHead>Solicitada (UTC)</TableHead>
                {canApprove && <TableHead className="w-72">Resolver</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((p) => (
                <TableRow key={p.approvalRequestId} className="align-top">
                  <TableCell className="max-w-80 whitespace-normal">
                    <div className="font-medium">{p.supplierName ?? "Proveedor sin confirmar"}</div>
                    <div className="text-xs text-muted-foreground">{p.invoiceNumber ?? "sin número"}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{p.explanation}</p>
                  </TableCell>
                  <TableCell>
                    {p.amountMinor === null || p.currency === null ? "—" : formatMinor(p.amountMinor, p.currency)}
                  </TableCell>
                  <TableCell className="max-w-56 whitespace-normal">
                    <div className="flex flex-wrap gap-1">
                      {p.reasonCodes.map((code) => (
                        <Badge key={code} variant="outline" className="text-[11px]">
                          {REASON_LABEL[code]}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.requestedAt.slice(0, 16).replace("T", " ")}</TableCell>
                  {canApprove && (
                    <TableCell className="whitespace-normal">
                      {!p.hasInvoiceContext && (
                        <p className="mb-1 text-xs text-muted-foreground">
                          Solicitud antigua sin datos guardados: solo se puede rechazar; vuelve a evaluar la factura para aprobarla.
                        </p>
                      )}
                      <ResolveApproval
                        approvalRequestId={p.approvalRequestId}
                        canAuthorize={canAuthorize && p.hasInvoiceContext}
                        canApproveThis={p.hasInvoiceContext}
                        defaults={{
                          account: p.beneficiaryAccountReference ?? "",
                          maxAmount: p.amountMinor !== null && p.currency === "USD" ? toUsdInput(p.amountMinor) : "",
                          // Debe estar vigente hoy (y en la fecha de la factura): nunca empieza en el futuro.
                          validFrom: p.invoiceDate !== null && p.invoiceDate < today ? p.invoiceDate : today,
                          validUntil: nextYear,
                        }}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
