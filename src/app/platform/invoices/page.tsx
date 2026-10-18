/**
 * Purpose: invoice inbox (A-08): every invoice received by email or uploaded manually, with its
 *   extraction status, resolved supplier and the payment decision; plus the manual upload (A-05).
 * Runs in: server (React Server Component; data streamed inside <Suspense>).
 * Triggered by: GET /platform/invoices and refresh() after an upload or retry.
 * Receives → Returns: request → rendered HTML inside the platform shell.
 * Talks to: ensureWorkspaceFromSession, PlatformSection, features/invoices (queries, components),
 *   contracts/money#formatMinor, shadcn Card, Table, Badge.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMinor } from "@/features/contracts/money";
import { RetryInvoiceButton, UploadInvoiceForm } from "@/features/invoices/components/invoice-forms";
import { listInvoices } from "@/features/invoices/queries";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";

export const metadata: Metadata = { title: "Facturas" };
// La carga manual llama a la IA desde una server action: margen para el modelo.
export const maxDuration = 60;

const DECISION = {
  aprobada: { label: "aprobada", variant: "default" },
  bloqueada: { label: "bloqueada", variant: "destructive" },
  requiere_aprobacion: { label: "requiere aprobación", variant: "secondary" },
} as const;
const EXTRACTION = {
  pending: { label: "pendiente", variant: "outline" },
  processing: { label: "procesando", variant: "outline" },
  extracted: { label: "extraída", variant: "secondary" },
  failed: { label: "fallida", variant: "destructive" },
} as const;
const MATCH = { matched: "confirmado", ambiguous: "ambiguo", not_found: "no reconocido" } as const;

export default function InvoicesPage() {
  return (
    <PlatformSection
      title="Facturas"
      description="Documentos recibidos por correo o carga manual. La IA solo lee la factura; la decisión de pago la toma el motor de reglas."
    >
      <div className="flex flex-col gap-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando facturas…</p>}>
          <InvoicesData />
        </Suspense>
      </div>
    </PlatformSection>
  );
}

// La sesión y la BD son datos de ejecución: con cacheComponents deben leerse dentro de <Suspense>.
async function InvoicesData() {
  let workspace;
  try {
    workspace = await ensureWorkspaceFromSession();
  } catch (error) {
    if (!(error instanceof OrganizationRequiredError)) throw error;
    return (
      <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        Las facturas pertenecen a una organización. Elige o crea una con el selector de arriba.
      </p>
    );
  }
  const invoices = await listInvoices(workspace.organization.id);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Cargar factura</CardTitle>
          <CardDescription>
            Respaldo del correo: pasa por el mismo proceso (lectura con IA, proveedor, contrato y reglas). Usa solo datos
            ficticios.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadInvoiceForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recibidas</CardTitle>
          <CardDescription>Las 50 más recientes. Abre una para ver lo extraído, la evidencia y la decisión.</CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no llega ninguna factura.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Número</TableHead>
                  <TableHead>Monto</TableHead>
                  <TableHead>Lectura</TableHead>
                  <TableHead>Decisión</TableHead>
                  <TableHead>Recibida (UTC)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id} className="align-top">
                    <TableCell className="max-w-64 whitespace-normal">
                      <Link href={`/platform/invoices/${inv.id}`} className="font-medium underline-offset-4 hover:underline">
                        {inv.supplierName ?? inv.extractedName ?? "Sin nombre"}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {inv.source === "email" ? "correo" : "carga manual"}
                        {inv.supplierMatchStatus !== null && ` · proveedor ${MATCH[inv.supplierMatchStatus]}`}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{inv.invoiceNumber ?? "—"}</TableCell>
                    <TableCell>{inv.amountMinor === null || inv.currency === null ? "—" : formatMinor(inv.amountMinor, inv.currency)}</TableCell>
                    <TableCell>
                      <Badge variant={EXTRACTION[inv.extractionStatus].variant}>{EXTRACTION[inv.extractionStatus].label}</Badge>
                      {inv.extractionStatus === "failed" && inv.source === "email" && (
                        <div className="mt-1">
                          <RetryInvoiceButton invoiceId={inv.id} />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {inv.decision === null ? (
                        <span className="text-xs text-muted-foreground">sin decisión</span>
                      ) : (
                        <Badge variant={DECISION[inv.decision.decision].variant}>
                          {DECISION[inv.decision.decision].label}
                          {inv.decision.decisionSource === "humana" ? " · persona" : ""}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{inv.receivedAt.slice(0, 16).replace("T", " ")}</TableCell>
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
