/**
 * Purpose: list invoices waiting for a human decision, with the reasons they escalated.
 *   Read-only for now; approving or rejecting arrives with feature/b-approvals.
 * Runs in: server (React Server Component; data streamed inside <Suspense>).
 * Triggered by: GET /platform/approvals.
 * Receives → Returns: request → rendered HTML inside the platform shell.
 * Talks to: ensureWorkspaceFromSession, PlatformSection, features/decisions/server#listPendingApprovals,
 *   contracts/money#formatMinor, shadcn Card, Table, Badge.
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMinor } from "@/features/contracts/money";
import { listPendingApprovals } from "@/features/decisions/server";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pendientes</CardTitle>
        <CardDescription>
          Aprobar o rechazar estará disponible en el siguiente paso; aquí ya ves qué escaló y por qué.
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
                        <Badge key={code} variant="outline" className="font-mono text-[10px]">
                          {code}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.requestedAt.slice(0, 16).replace("T", " ")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
