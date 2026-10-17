/**
 * Purpose: register, list and terminate the organization's supplier contracts, which the
 *   invoice pipeline uses as evidence (never as payment authorization).
 * Runs in: server (React Server Component; data streamed inside <Suspense>).
 * Triggered by: GET /platform/contracts and refresh() after a contracts server action.
 * Receives → Returns: request → rendered HTML inside the platform shell (forms only for admins;
 *   a prompt to pick an organization when the session has none).
 * Talks to: ensureWorkspaceFromSession, PlatformSection, features/contracts (server, permissions,
 *   money, components/contract-forms), shadcn Card, Table, Badge.
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ContractForm, TerminateContractButton } from "@/features/contracts/components/contract-forms";
import { formatMinor } from "@/features/contracts/money";
import { checkCanManageContracts } from "@/features/contracts/permissions";
import { contractActorFromWorkspace, getContractsOverview } from "@/features/contracts/server";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";

export const metadata: Metadata = { title: "Contratos" };

const FREQUENCY_LABEL = {
  one_time: "pago único",
  weekly: "semanal",
  monthly: "mensual",
  quarterly: "trimestral",
  yearly: "anual",
} as const;

export default function ContractsPage() {
  return (
    <PlatformSection
      title="Contratos"
      description="Condiciones acordadas con cada proveedor. Las facturas se comparan con el contrato vigente y las diferencias se escalan. Un contrato no autoriza pagos: solo una autorización explícita lo hace."
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

  return (
    <>
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Registrar contrato</CardTitle>
            <CardDescription>
              El monto acordado se compara exacto con cada factura: cualquier diferencia escala la factura.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ContractForm suppliers={overview.suppliers} today={today} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Contratos registrados</CardTitle>
          <CardDescription>
            {canManage
              ? "Un contrato no se edita: se termina y se registra uno nuevo."
              : "Solo un administrador puede registrar o terminar contratos."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overview.contracts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin contratos.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Monto acordado</TableHead>
                  <TableHead>Frecuencia</TableHead>
                  <TableHead>Vigencia</TableHead>
                  <TableHead>Cuenta</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Registrado</TableHead>
                  {canManage && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.contracts.map((contract) => (
                  <TableRow key={contract.contractId}>
                    <TableCell>
                      <div className="font-medium">{contract.supplierName}</div>
                      {contract.description !== null && (
                        <div className="text-xs text-muted-foreground">{contract.description}</div>
                      )}
                    </TableCell>
                    <TableCell>{formatMinor(contract.agreedAmountMinor, contract.currency)}</TableCell>
                    <TableCell>{FREQUENCY_LABEL[contract.frequency]}</TableCell>
                    <TableCell>
                      {contract.validFrom} → {contract.validTo ?? "sin fin"}
                    </TableCell>
                    <TableCell>{contract.beneficiaryAccountRef ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={contract.status === "active" ? "default" : "secondary"}>
                        {contract.status === "active" ? "activo" : "terminado"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{contract.createdAt.slice(0, 10)}</TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {contract.status === "active" && <TerminateContractButton contractId={contract.contractId} />}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
