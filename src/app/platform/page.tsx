/**
 * Purpose: platform dashboard: payments already made outside Pacta (emailed receipts, often
 *   automatic card charges), this month's decisions and autonomy against the budget, risks
 *   stopped by the rules, pending approvals and recurring charges without authorization.
 * Runs in: server (React Server Component; data streamed inside <Suspense>).
 * Triggered by: GET /platform.
 * Receives → Returns: request → rendered HTML inside the platform shell (a prompt to pick an
 *   organization when the session has none).
 * Talks to: ensureWorkspaceFromSession, PlatformSection, features/dashboard/server#getDashboard,
 *   contracts/money#formatMinor, shadcn Card, Table, Badge, Progress.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMinor } from "@/features/contracts/money";
import type { ReceiptSignal, ReceiptStatus } from "@/features/dashboard/metrics";
import { getDashboard, type Dashboard } from "@/features/dashboard/server";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";
import type { ReasonCode } from "@/shared/schemas/payment-decision";

export const metadata: Metadata = { title: "Resumen" };

const RECEIPT_STATUS: Record<ReceiptStatus, { label: string; variant: "destructive" | "secondary" | "default" }> = {
  unapproved: { label: "sin aprobación", variant: "destructive" },
  covered_by_authorization: { label: "cubierto por autorización", variant: "secondary" },
  approved_in_pacta: { label: "aprobado en Pacta", variant: "default" },
};
const SIGNAL: Record<ReceiptSignal, string> = {
  likely_recurring: "probable cargo recurrente",
  bank_confirmed: "confirmado en banco",
  supplier_unknown: "proveedor no reconocido",
};
const REASON: Record<ReasonCode, string> = {
  SUPPLIER_NOT_AUTHORIZED: "Proveedor sin autorización",
  DUPLICATE_INVOICE: "Factura duplicada",
  AMOUNT_LIMIT_EXCEEDED: "Monto sobre el límite",
  BUDGET_INSUFFICIENT: "Presupuesto insuficiente",
  CONTRACT_NOT_FOUND: "Sin contrato",
  CONTRACT_MISMATCH: "No coincide con el contrato",
  INSUFFICIENT_DATA: "Datos incompletos",
  HUMAN_APPROVAL_REQUIRED: "Requiere aprobación humana",
  RECURRENCE_NOT_AUTHORIZED: "Recurrencia sin autorizar",
  AUTO_APPROVAL_RULES_PASSED: "Reglas cumplidas",
  BENEFICIARY_CHANGED: "Cambio de cuenta beneficiaria",
  CURRENCY_NOT_SUPPORTED: "Moneda no soportada",
};
const CADENCE = { weekly: "semanal", monthly: "mensual", quarterly: "trimestral", yearly: "anual" } as const;

export default function DashboardPage() {
  return (
    <PlatformSection
      title="Resumen"
      description="Qué decidió Pacta este mes, qué riesgos detuvo y qué pagos ocurrieron sin pasar por una aprobación. Las decisiones son de pago simulado: no se mueve dinero."
    >
      <div className="flex flex-col gap-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando resumen…</p>}>
          <DashboardData />
        </Suspense>
      </div>
    </PlatformSection>
  );
}

// La sesión y la BD son datos de ejecución: con cacheComponents deben leerse dentro de <Suspense>.
async function DashboardData() {
  let workspace;
  try {
    workspace = await ensureWorkspaceFromSession();
  } catch (error) {
    if (!(error instanceof OrganizationRequiredError)) throw error;
    return (
      <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        El resumen pertenece a una organización. Elige o crea una con el selector de arriba.
      </p>
    );
  }
  const dashboard = await getDashboard(workspace.organization.id);
  return (
    <>
      <OutsidePayments dashboard={dashboard} />
      <div className="grid gap-6 lg:grid-cols-3">
        <DecisionsCard dashboard={dashboard} />
        <SafetyCard dashboard={dashboard} />
        <PendingCard dashboard={dashboard} />
      </div>
      <SubscriptionsCard dashboard={dashboard} />
    </>
  );
}

const formatAmounts = (byCurrency: Record<string, number>) => {
  const entries = Object.entries(byCurrency);
  return entries.length === 0 ? "—" : entries.map(([currency, minor]) => formatMinor(minor, currency)).join(" · ");
};

function OutsidePayments({ dashboard }: { dashboard: Dashboard }) {
  const { receipts, unapprovedThisMonth } = dashboard;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pagos realizados fuera de Pacta</CardTitle>
        <CardDescription>
          Recibos llegados por correo de pagos que ya ocurrieron, a menudo cargos automáticos a tarjeta. No se evalúan
          para pago, así que nunca se pagan dos veces. Detectado desde recibos por correo; verifique con su banco.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-6">
          <Stat label={`Sin aprobación (${dashboard.month})`} value={String(unapprovedThisMonth.count)} tone={unapprovedThisMonth.count > 0 ? "alert" : "normal"} />
          <Stat label="Monto sin aprobación" value={formatAmounts(unapprovedThisMonth.amountByCurrency)} tone={unapprovedThisMonth.count > 0 ? "alert" : "normal"} />
          <Stat label="Recibos registrados" value={String(receipts.length)} />
        </div>
        {receipts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no llegan recibos de pagos realizados.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proveedor</TableHead>
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
                      {r.invoiceNumber && <div className="text-xs text-muted-foreground">{r.invoiceNumber}</div>}
                    </TableCell>
                    <TableCell>{r.amountMinor === null || r.currency === null ? "—" : formatMinor(r.amountMinor, r.currency)}</TableCell>
                    <TableCell className="text-sm">{r.paidOn ?? <span className="text-muted-foreground">recibido {r.receivedOn}</span>}</TableCell>
                    <TableCell className="text-sm">{r.paymentMethod ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={RECEIPT_STATUS[r.status].variant}>{RECEIPT_STATUS[r.status].label}</Badge>
                        {r.signals.map((signal) => (
                          <Badge key={signal} variant="outline">{SIGNAL[signal]}</Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DecisionsCard({ dashboard }: { dashboard: Dashboard }) {
  const { decisions, budget } = dashboard;
  const percent = budget === null || budget.monthlyBudgetMinor === 0 ? null : Math.min(100, Math.round((budget.usedMinor / budget.monthlyBudgetMinor) * 100));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Decisiones del mes</CardTitle>
        <CardDescription>Última decisión de cada factura evaluada en {dashboard.month}.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Aprobadas" value={String(decisions.approved)} />
          <Stat label="Escaladas" value={String(decisions.requiresApproval)} />
          <Stat label="Bloqueadas" value={String(decisions.blocked)} />
        </div>
        <Stat
          label="Autonomía (aprobadas sin intervención)"
          value={decisions.autonomyRate === null ? "—" : `${Math.round(decisions.autonomyRate * 100)}% · ${decisions.autoApproved} de ${decisions.total}`}
        />
        {budget === null ? (
          <p className="text-sm text-muted-foreground">
            Sin política vigente: nada se aprueba automáticamente. <Link href="/platform/policies" className="underline">Configurar</Link>
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Presupuesto aprobado</span>
              <span>
                {formatMinor(budget.usedMinor, budget.currency)} / {formatMinor(budget.monthlyBudgetMinor, budget.currency)}
              </span>
            </div>
            <Progress value={percent} aria-label="Presupuesto mensual usado" />
            <p className="text-xs text-muted-foreground">Solo pagos aprobados en Pacta (política v{budget.policyVersion}).</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SafetyCard({ dashboard }: { dashboard: Dashboard }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Riesgos detenidos</CardTitle>
        <CardDescription>Motivos de las facturas bloqueadas o escaladas este mes.</CardDescription>
      </CardHeader>
      <CardContent>
        {dashboard.safetyCatches.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ninguna factura bloqueada o escalada este mes.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {dashboard.safetyCatches.map(({ code, count }) => (
              <li key={code} className="flex items-center justify-between gap-3 text-sm">
                <span>{REASON[code]}</span>
                <Badge variant="secondary">{count}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PendingCard({ dashboard }: { dashboard: Dashboard }) {
  const { pending } = dashboard;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Aprobaciones pendientes</CardTitle>
        <CardDescription>Facturas que esperan una decisión humana.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Pendientes" value={String(pending.count)} tone={pending.count > 0 ? "alert" : "normal"} />
          <Stat label="Monto" value={formatAmounts(pending.amountByCurrency)} />
        </div>
        {pending.oldestRequestedAt !== null && (
          <p className="text-sm text-muted-foreground">Más antigua: {pending.oldestRequestedAt.slice(0, 16).replace("T", " ")} UTC</p>
        )}
        <Link href="/platform/approvals" className="text-sm font-medium underline-offset-4 hover:underline">
          Ir a aprobaciones →
        </Link>
      </CardContent>
    </Card>
  );
}

function SubscriptionsCard({ dashboard }: { dashboard: Dashboard }) {
  const { subscriptions } = dashboard;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Suscripciones sin autorizar</CardTitle>
        <CardDescription>
          Cargos recurrentes que el historial bancario sugiere, sin una autorización recurrente vigente. Es una sugerencia:
          el historial no autoriza pagos. <Link href="/platform/policies" className="underline">Autorizar en Políticas</Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!subscriptions.available ? (
          <p className="text-sm text-muted-foreground">Demasiados movimientos para calcular recurrencias con seguridad.</p>
        ) : subscriptions.unauthorized.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ninguna recurrencia sin autorizar. Importa un CSV en Historial para detectarlas.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contraparte</TableHead>
                  <TableHead>Cadencia</TableHead>
                  <TableHead>Monto típico</TableHead>
                  <TableHead>Cargos</TableHead>
                  <TableHead>Último</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.unauthorized.map((s) => (
                  <TableRow key={`${s.supplierId ?? s.name}-${s.currency}`}>
                    <TableCell className="font-medium">
                      {s.name}
                      {s.supplierId === null && <div className="text-xs text-muted-foreground">sin proveedor vinculado</div>}
                    </TableCell>
                    <TableCell>{CADENCE[s.cadence]}</TableCell>
                    <TableCell>{formatMinor(s.typicalAmountMinor, s.currency)}</TableCell>
                    <TableCell>{s.occurrences}</TableCell>
                    <TableCell className="text-sm">{s.lastPostedOn}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "alert" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={tone === "alert" ? "text-lg font-semibold text-destructive" : "text-lg font-semibold"}>{value}</span>
    </div>
  );
}
