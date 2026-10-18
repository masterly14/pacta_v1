/**
 * Purpose: detail of payments already made outside Pacta: every emailed receipt with its supplier,
 *   amount, paid date, masked payment method, status against Pacta and signals, filterable by status.
 * Runs in: server (React Server Component; data streamed inside <Suspense>).
 * Triggered by: GET /platform/outside-payments[?status=unapproved|covered_by_authorization|approved_in_pacta],
 *   linked from the dashboard.
 * Receives → Returns: request → rendered HTML inside the platform shell (a prompt to pick an
 *   organization when the session has none).
 * Talks to: ensureWorkspaceFromSession, PlatformSection, features/dashboard/server#listOutsidePayments,
 *   dashboard/components/labels, contracts/money#formatMinor, shadcn Card, Table, Badge.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMinor } from "@/features/contracts/money";
import { formatAmounts, RECEIPT_SIGNAL, RECEIPT_STATUS } from "@/features/dashboard/components/labels";
import type { ReceiptStatus } from "@/features/dashboard/metrics";
import { listOutsidePayments, OUTSIDE_PAYMENTS_PAGE } from "@/features/dashboard/server";
import { cn } from "@/lib/utils";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";

export const metadata: Metadata = { title: "Pagos fuera de Pacta" };

const STATUSES: readonly ReceiptStatus[] = ["unapproved", "covered_by_authorization", "approved_in_pacta"];

type SearchParams = Promise<{ status?: string | string[] }>;

export default function OutsidePaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PlatformSection
      title="Pagos realizados fuera de Pacta"
      description="Recibos llegados por correo de pagos que ya ocurrieron, a menudo cargos automáticos a tarjeta. Se registran como hechos: no se evalúan para pago, así que nunca se pagan dos veces. Verifique con su banco."
    >
      <div className="flex flex-col gap-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando pagos…</p>}>
          <OutsidePaymentsData searchParams={searchParams} />
        </Suspense>
      </div>
    </PlatformSection>
  );
}

// La sesión, la BD y los parámetros de la URL son datos de ejecución: se leen dentro de <Suspense>.
async function OutsidePaymentsData({ searchParams }: { searchParams: SearchParams }) {
  let workspace;
  try {
    workspace = await ensureWorkspaceFromSession();
  } catch (error) {
    if (!(error instanceof OrganizationRequiredError)) throw error;
    return (
      <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        Los pagos pertenecen a una organización. Elige o crea una con el selector de arriba.
      </p>
    );
  }
  const raw = (await searchParams).status;
  // Un valor desconocido en la URL muestra todos los recibos, no un error.
  const status = STATUSES.find((s) => s === raw) ?? null;
  const { summary, receipts, matchingCount, truncated } = await listOutsidePayments(workspace.organization.id, { status });

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        {STATUSES.map((s) => (
          <Card key={s} size="sm">
            <CardHeader>
              <CardDescription>{RECEIPT_STATUS[s].label}</CardDescription>
              <CardTitle className={s === "unapproved" && summary.byStatus[s].count > 0 ? "text-destructive" : undefined}>
                {summary.byStatus[s].count} · {formatAmounts(summary.byStatus[s].amountByCurrency)}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recibos</CardTitle>
          <CardDescription>
            {matchingCount} {status === null ? "en total" : RECEIPT_STATUS[status].label}, del más reciente al más antiguo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <nav className="flex flex-wrap gap-2" aria-label="Filtrar por estado">
            <FilterLink href="/platform/outside-payments" active={status === null} label={`Todos (${summary.count})`} />
            {STATUSES.map((s) => (
              <FilterLink key={s} href={`/platform/outside-payments?status=${s}`} active={status === s} label={`${RECEIPT_STATUS[s].label} (${summary.byStatus[s].count})`} />
            ))}
          </nav>
          {receipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay recibos{status === null ? "" : " con este estado"}.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Proveedor</TableHead>
                    <TableHead>Número</TableHead>
                    <TableHead>Monto</TableHead>
                    <TableHead>Pagado</TableHead>
                    <TableHead>Medio</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipts.map((r) => (
                    <TableRow key={r.invoiceId} className={r.status === "unapproved" ? "bg-destructive/5" : undefined}>
                      <TableCell>
                        <Link href={`/platform/invoices/${r.invoiceId}`} className="font-medium underline-offset-4 hover:underline">
                          {r.supplierName ?? r.extractedName ?? "—"}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{r.invoiceNumber ?? "—"}</TableCell>
                      <TableCell>{r.amountMinor === null || r.currency === null ? "—" : formatMinor(r.amountMinor, r.currency)}</TableCell>
                      <TableCell className="text-sm">{r.paidOn ?? <span className="text-muted-foreground">recibido {r.receivedOn}</span>}</TableCell>
                      <TableCell className="text-sm">{r.paymentMethod ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Badge variant={RECEIPT_STATUS[r.status].variant}>{RECEIPT_STATUS[r.status].label}</Badge>
                          {r.signals.map((signal) => (
                            <Badge key={signal} variant="outline">{RECEIPT_SIGNAL[signal]}</Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {truncated && <p className="text-xs text-muted-foreground">Se muestran los {OUTSIDE_PAYMENTS_PAGE} recibos más recientes.</p>}
        </CardContent>
      </Card>
    </>
  );
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn("rounded-full border px-3 py-1 text-sm", active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/70")}
    >
      {label}
    </Link>
  );
}
