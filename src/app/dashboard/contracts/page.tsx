/**
 * Purpose: register, list and terminate the organization's supplier contracts, which the
 *   invoice pipeline uses as evidence (never as payment authorization).
 * Runs in: server (React Server Component; data streamed inside <Suspense>).
 * Triggered by: GET /dashboard/contracts and refresh() after a contracts server action.
 * Receives → Returns: request → rendered HTML (forms only for admins).
 * Talks to: ensureWorkspaceFromSession, features/contracts (server, permissions, money,
 *   components/contract-forms), shadcn Card, Table, Badge.
 */
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ContractForm, TerminateContractButton } from "@/features/contracts/components/contract-forms";
import { formatMinor } from "@/features/contracts/money";
import { checkCanManageContracts } from "@/features/contracts/permissions";
import { contractActorFromWorkspace, getContractsOverview } from "@/features/contracts/server";
import { ensureWorkspaceFromSession } from "@/shared/auth/ensure-workspace";

const FREQUENCY_LABEL = {
  one_time: "pago único",
  weekly: "semanal",
  monthly: "mensual",
  quarterly: "trimestral",
  yearly: "anual",
} as const;

export default function ContractsPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contratos</h1>
        <p className="text-muted-foreground">
          Condiciones acordadas con cada proveedor. Las facturas se comparan con el contrato vigente y las
          diferencias se escalan. Un contrato no autoriza pagos: solo una autorización explícita lo hace.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando contratos…</p>}>
        <ContractsData />
      </Suspense>
    </main>
  );
}

// La sesión y la BD son datos de ejecución: con cacheComponents deben leerse dentro de <Suspense>.
async function ContractsData() {
  const workspace = await ensureWorkspaceFromSession();
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
