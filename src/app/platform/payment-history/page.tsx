/**
 * Purpose: upload a fictional bank CSV and review the movements used to suggest recurrences.
 * Runs in: server (React Server Component; data streamed inside <Suspense>).
 * Triggered by: GET /platform/payment-history and refresh() after an import.
 * Receives → Returns: request → the Historial page. The upload form is only for organization admins.
 * Talks to: ensureWorkspaceFromSession, payment-history import-csv, ImportCsvForm, shadcn Card and Table.
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ImportCsvForm } from "@/features/payment-history/components/import-form";
import { listImportedMovements, listRecurrenceSuggestions } from "@/features/payment-history/import-csv";
import { formatUsd } from "@/features/policies/money";
import { checkCanGrantPermissions } from "@/features/policies/permissions";
import { loadPolicyActor } from "@/features/policies/server";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";

export const metadata: Metadata = { title: "Historial" };

const CADENCE_LABEL = { weekly: "semanal", monthly: "mensual", quarterly: "trimestral", yearly: "anual" } as const;

export default function PaymentHistoryPage() {
  return (
    <PlatformSection
      title="Historial de pagos"
      description="Movimientos importados desde un CSV. Sirven para detectar recurrencias y no conceden permiso de pago."
    >
      <div className="flex flex-col gap-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando historial…</p>}>
          <HistoryData />
        </Suspense>
      </div>
    </PlatformSection>
  );
}

async function HistoryData() {
  let workspace;
  try {
    workspace = await ensureWorkspaceFromSession();
  } catch (error) {
    if (!(error instanceof OrganizationRequiredError)) throw error;
    return (
      <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        El historial pertenece a una organización. Elige o crea una con el selector de arriba.
      </p>
    );
  }

  const actor = await loadPolicyActor(workspace);
  const canImport = checkCanGrantPermissions(actor) === null;
  const organizationId = workspace.organization.id;
  const [movements, suggestions] = await Promise.all([
    listImportedMovements(organizationId),
    listRecurrenceSuggestions(organizationId),
  ]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Importar extracto</CardTitle>
          <CardDescription>
            Columnas: date, description, amount, currency y reference (opcional). amount usa punto decimal y el signo
            indica el sentido: -20.00 es una salida. Un movimiento se vincula solo si la descripción coincide con un
            proveedor del catálogo. El historial nunca autoriza un pago.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <a className="text-sm text-primary underline-offset-4 hover:underline" href="/samples/demo-bank-history.csv" download>
            Descargar CSV de ejemplo
          </a>
          {canImport ? (
            <ImportCsvForm />
          ) : (
            <p className="text-sm text-muted-foreground">Solo un administrador de la organización puede importar un extracto.</p>
          )}
        </CardContent>
      </Card>

      {suggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recurrencias sugeridas</CardTitle>
            <CardDescription>Son una pista para una persona. No crean una autorización ni aprueban facturas.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-1 text-sm">
              {suggestions.map((suggestion) => (
                <li key={`${suggestion.counterpartyNormalized}-${suggestion.cadence}-${suggestion.currency}`}>
                  {suggestion.counterpartyNormalized} · {CADENCE_LABEL[suggestion.cadence]} · {suggestion.occurrences} pagos ·{" "}
                  {suggestion.supplierId === null ? "sin proveedor vinculado" : "proveedor vinculado"}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Movimientos</CardTitle>
          <CardDescription>
            {movements.length === 0 ? "Todavía no hay un extracto importado." : "Los 50 más recientes."}
          </CardDescription>
        </CardHeader>
        {movements.length > 0 && (
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead>Monto</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Referencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell>{movement.postedOn.toISOString().slice(0, 10)}</TableCell>
                    <TableCell>{movement.description}</TableCell>
                    <TableCell>
                      {movement.currency === "USD" ? formatUsd(movement.amountMinor) : `${movement.amountMinor} ${movement.currency}`}
                    </TableCell>
                    <TableCell>{movement.supplier?.name ?? "Sin vincular"}</TableCell>
                    <TableCell>{movement.externalRef ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>
    </>
  );
}
