/**
 * Purpose: platform dashboard: KPIs with trends (invoices received, autonomy, budget, pending
 *   approvals), decisions per day and this month's mix, payments already made outside Pacta
 *   (emailed receipts, often automatic card charges), risks stopped by the rules and recurring
 *   charges without authorization. Animated SVG charts; numbers are facts, nothing authorizes.
 * Runs in: server (React Server Component; data streamed inside <Suspense>; charts are client).
 * Triggered by: GET /platform.
 * Receives → Returns: request → rendered HTML inside the platform shell (a prompt to pick an
 *   organization when the session has none).
 * Talks to: ensureWorkspaceFromSession, PlatformSection, features/dashboard (server#getDashboard,
 *   components/charts, components/labels), contracts/money#formatMinor, shadcn Card, Table, Badge.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowUpRight } from "lucide-react";
import { PlatformSection } from "@/components/platform/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMinor } from "@/features/contracts/money";
import { AnimatedNumber, BarList, Donut, RadialGauge, Sparkline, StackedBars } from "@/features/dashboard/components/charts";
import { formatAmounts } from "@/features/dashboard/components/labels";
import { getDashboard, type Dashboard } from "@/features/dashboard/server";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";
import type { ReasonCode } from "@/shared/schemas/payment-decision";

export const metadata: Metadata = { title: "Resumen" };

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
  EMPLOYEE_TERMINATED: "Empleado desvinculado",
  EMPLOYEE_NOT_FOUND: "Empleado no encontrado",
  PAYROLL_OMISSION: "Nómina incompleta",
  VARIANCE_EXCEEDED: "Variación sobre la tolerancia",
  BENEFIT_MISMATCH: "Beneficio no coincide",
  DUPLICATE_LINE: "Línea duplicada",
  FUNDS_INSUFFICIENT: "Fondos insuficientes",
  OBLIGATION_NOT_AUTHORIZED: "Obligación sin autorizar",
  SETTLEMENT_UNCONFIRMED: "Liquidación sin confirmar",
  SETTLEMENT_AMOUNT_MISMATCH: "Monto distinto de la liquidación",
  DEADLINE_PASSED: "Plazo vencido",
  DEADLINE_AT_RISK: "Plazo en riesgo",
  STALE_EVIDENCE: "Evidencia desactualizada",
  SIGNAL_PENDING_REVIEW: "Señal pendiente de revisión",
};
const CADENCE = { weekly: "semanal", monthly: "mensual", quarterly: "trimestral", yearly: "anual" } as const;
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// Colores semánticos de los gráficos (relleno para barras, trazo para donas).
const TONE = {
  approved: { fill: "fill-emerald-500", stroke: "stroke-emerald-500" },
  escalated: { fill: "fill-amber-500", stroke: "stroke-amber-500" },
  blocked: { fill: "fill-rose-500", stroke: "stroke-rose-500" },
  neutral: { fill: "fill-sky-500", stroke: "stroke-sky-500" },
} as const;

const formatDay = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

export default function DashboardPage() {
  return (
    <PlatformSection
      title="Resumen"
      description="Qué decidió Pacta, qué riesgos detuvo y qué pagos ocurrieron sin pasar por una aprobación. Las decisiones son de pago simulado: no se mueve dinero."
    >
      <div className="flex flex-col gap-6">
        <Suspense fallback={<DashboardSkeleton />}>
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
      <KpiRow dashboard={dashboard} />
      <div className="stagger grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <DecisionsTrendCard dashboard={dashboard} />
        </div>
        <div>
          <DecisionMixCard dashboard={dashboard} />
        </div>
      </div>
      <div>
        <OutsidePaymentsCard dashboard={dashboard} />
      </div>
      <div className="stagger grid gap-6 lg:grid-cols-3">
        <div>
          <SafetyCard dashboard={dashboard} />
        </div>
        <div className="lg:col-span-2">
          <SubscriptionsCard dashboard={dashboard} />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

function KpiRow({ dashboard }: { dashboard: Dashboard }) {
  const { trends, decisions, budget, pending } = dashboard;
  const receivedTotal = trends.receivedByDay.reduce((sum, d) => sum + d.count, 0);
  const budgetPercent = budget === null || budget.monthlyBudgetMinor === 0 ? null : (budget.usedMinor / budget.monthlyBudgetMinor) * 100;
  return (
    <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div>
        <KpiCard label={`Facturas recibidas · ${trends.days} días`}>
          <AnimatedNumber value={receivedTotal} className="text-3xl font-semibold tracking-tight" />
          <Sparkline values={trends.receivedByDay.map((d) => d.count)} className="mt-3 text-sky-500" />
        </KpiCard>
      </div>
      <div>
        <KpiCard label={`Autonomía · ${dashboard.month}`}>
          {decisions.autonomyRate === null ? (
            <span className="text-3xl font-semibold tracking-tight">—</span>
          ) : (
            <AnimatedNumber value={Math.round(decisions.autonomyRate * 100)} suffix="%" className="text-3xl font-semibold tracking-tight" />
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {decisions.total === 0 ? "Sin facturas decididas este mes." : `${decisions.autoApproved} de ${decisions.total} aprobadas sin intervención humana.`}
          </p>
        </KpiCard>
      </div>
      <div>
        <KpiCard label="Presupuesto del mes">
          {budget === null || budgetPercent === null ? (
            <p className="text-sm text-muted-foreground">
              Sin política vigente: nada se aprueba automáticamente.{" "}
              <Link href="/platform/policies" className="underline underline-offset-4">
                Configurar
              </Link>
            </p>
          ) : (
            <div className="flex items-center gap-4">
              <RadialGauge percent={budgetPercent} />
              <div className="flex flex-col">
                <span className="text-lg font-semibold tabular-nums">{formatMinor(budget.usedMinor, budget.currency)}</span>
                <span className="text-xs text-muted-foreground">de {formatMinor(budget.monthlyBudgetMinor, budget.currency)} aprobados</span>
              </div>
            </div>
          )}
        </KpiCard>
      </div>
      <div>
        <Link href="/platform/approvals" className="group block h-full">
          <KpiCard label="Aprobaciones pendientes" interactive>
            <AnimatedNumber
              value={pending.count}
              className={pending.count > 0 ? "text-3xl font-semibold tracking-tight text-amber-600 dark:text-amber-400" : "text-3xl font-semibold tracking-tight"}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              {pending.count === 0 || pending.oldestRequestedAt === null
                ? "Nada esperando una decisión humana."
                : `${formatAmounts(pending.amountByCurrency)} · la más antigua del ${formatDay(pending.oldestRequestedAt.slice(0, 10))}`}
            </p>
          </KpiCard>
        </Link>
      </div>
    </div>
  );
}

function KpiCard({ label, children, interactive = false }: { label: string; children: React.ReactNode; interactive?: boolean }) {
  return (
    <Card className={interactive ? "h-full transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md" : "h-full"}>
      <CardHeader>
        <CardDescription className="flex items-center justify-between">
          {label}
          {interactive && <ArrowUpRight className="size-4 opacity-0 transition-opacity group-hover:opacity-100" />}
        </CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Decisiones
// ---------------------------------------------------------------------------

function DecisionsTrendCard({ dashboard }: { dashboard: Dashboard }) {
  const { decisionsByDay, days } = dashboard.trends;
  const total = decisionsByDay.reduce((sum, d) => sum + d.approved + d.requiresApproval + d.blocked, 0);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Decisiones por día</CardTitle>
        <CardDescription>
          Últimos {days} días · {total} {total === 1 ? "factura decidida" : "facturas decididas"} (última decisión de cada una).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <StackedBars
          data={decisionsByDay.map((d) => ({ ...d, label: formatDay(d.day) }))}
          series={[
            { key: "approved", label: "Aprobadas", className: TONE.approved.fill },
            { key: "requiresApproval", label: "Escaladas", className: TONE.escalated.fill },
            { key: "blocked", label: "Bloqueadas", className: TONE.blocked.fill },
          ]}
        />
      </CardContent>
    </Card>
  );
}

function DecisionMixCard({ dashboard }: { dashboard: Dashboard }) {
  const { decisions } = dashboard;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Mezcla del mes</CardTitle>
        <CardDescription>Cómo terminó cada factura evaluada en {dashboard.month}.</CardDescription>
      </CardHeader>
      <CardContent>
        <Donut
          center={String(decisions.total)}
          caption="facturas este mes"
          segments={[
            { label: "Aprobadas", value: decisions.approved, className: TONE.approved.stroke },
            { label: "Escaladas", value: decisions.requiresApproval, className: TONE.escalated.stroke },
            { label: "Bloqueadas", value: decisions.blocked, className: TONE.blocked.stroke },
          ]}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Pagos fuera de Pacta
// ---------------------------------------------------------------------------

function OutsidePaymentsCard({ dashboard }: { dashboard: Dashboard }) {
  const { month, truncated, allTimeCount } = dashboard.outsidePayments;
  const unapproved = month.byStatus.unapproved;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Pagos realizados fuera de Pacta</CardTitle>
            <CardDescription className="max-w-2xl">
              Recibos de pagos que ya ocurrieron en {dashboard.month}, a menudo cargos automáticos a tarjeta. No se evalúan para pago, así que
              nunca se pagan dos veces. Verifique con su banco.
            </CardDescription>
          </div>
          <Link href="/platform/outside-payments" className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline">
            Ver los {allTimeCount} recibos <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="grid gap-8 lg:grid-cols-3">
        <Donut
          center={String(month.count)}
          caption="recibos este mes"
          segments={[
            { label: "Sin aprobación", value: unapproved.count, className: TONE.blocked.stroke, detail: formatAmounts(unapproved.amountByCurrency) },
            {
              label: "Cubiertos por autorización",
              value: month.byStatus.covered_by_authorization.count,
              className: TONE.neutral.stroke,
              detail: formatAmounts(month.byStatus.covered_by_authorization.amountByCurrency),
            },
            {
              label: "Aprobados en Pacta",
              value: month.byStatus.approved_in_pacta.count,
              className: TONE.approved.stroke,
              detail: formatAmounts(month.byStatus.approved_in_pacta.amountByCurrency),
            },
          ]}
        />
        <div className="flex flex-col gap-3">
          <span className="text-xs font-medium text-muted-foreground">Proveedores con más pagos sin aprobación</span>
          {month.topUnapprovedSuppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguno este mes.</p>
          ) : (
            <BarList
              barClassName="bg-rose-500"
              items={month.topUnapprovedSuppliers.map((s) => ({ label: s.name, value: s.count, detail: formatAmounts(s.amountByCurrency) }))}
            />
          )}
        </div>
        <div className="grid grid-cols-2 content-start gap-4">
          <MiniStat label="Monto sin aprobación" value={formatAmounts(unapproved.amountByCurrency)} alert={unapproved.count > 0} />
          <MiniStat label="Sin aprobación" value={<AnimatedNumber value={unapproved.count} />} alert={unapproved.count > 0} />
          <MiniStat label="Probables recurrentes" value={<AnimatedNumber value={month.likelyRecurring} />} />
          <MiniStat label="Confirmados en banco" value={<AnimatedNumber value={month.bankConfirmed} />} />
          {truncated && <p className="col-span-2 text-xs text-muted-foreground">Hay demasiados recibos este mes: los totales cubren los más recientes.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, alert = false }: { label: string; value: React.ReactNode; alert?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-muted/30 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={alert ? "text-lg font-semibold text-rose-600 dark:text-rose-400" : "text-lg font-semibold"}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Riesgos y suscripciones
// ---------------------------------------------------------------------------

function SafetyCard({ dashboard }: { dashboard: Dashboard }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Riesgos detenidos</CardTitle>
        <CardDescription>Motivos de las facturas bloqueadas o escaladas este mes.</CardDescription>
      </CardHeader>
      <CardContent>
        {dashboard.safetyCatches.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ninguna factura bloqueada o escalada este mes.</p>
        ) : (
          <BarList barClassName="bg-amber-500" items={dashboard.safetyCatches.map(({ code, count }) => ({ label: REASON[code], value: count }))} />
        )}
      </CardContent>
    </Card>
  );
}

function SubscriptionsCard({ dashboard }: { dashboard: Dashboard }) {
  const { subscriptions } = dashboard;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Suscripciones sin autorizar</CardTitle>
        <CardDescription>
          Cargos recurrentes que el historial bancario sugiere, sin una autorización recurrente vigente. Es una sugerencia: el historial no
          autoriza pagos.{" "}
          <Link href="/platform/policies" className="underline underline-offset-4">
            Autorizar en Políticas
          </Link>
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
                    <TableCell>
                      <Badge variant="outline">{CADENCE[s.cadence]}</Badge>
                    </TableCell>
                    <TableCell>{formatMinor(s.typicalAmountMinor, s.currency)}</TableCell>
                    <TableCell className="tabular-nums">{s.occurrences}</TableCell>
                    <TableCell className="text-sm">{formatDay(s.lastPostedOn)}</TableCell>
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

// ---------------------------------------------------------------------------
// Esqueleto mientras carga
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-label="Cargando resumen">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-36 animate-pulse rounded-xl border bg-muted/40" />
        ))}
      </div>
      <div className="stagger grid gap-6 lg:grid-cols-3">
        <div className="h-80 animate-pulse rounded-xl border bg-muted/40 lg:col-span-2" />
        <div className="h-80 animate-pulse rounded-xl border bg-muted/40" />
      </div>
    </div>
  );
}
