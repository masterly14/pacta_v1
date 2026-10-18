/**
 * Purpose: tablero de contratos de la organización: reactivos (comparan cada factura con su flujo)
 *   y proactivos (Pacta valida pagos recurrentes como la nómina), con resumen, filtros y acceso al
 *   flujo de cada uno. Un contrato es evidencia; nunca autoriza un pago.
 * Runs in: server (React Server Component; datos dentro de <Suspense>).
 * Triggered by: GET /platform/contracts y refresh() tras una acción de contratos.
 * Receives → Returns: request → HTML dentro del shell de la plataforma (crear solo para
 *   administradores; aviso si la sesión no tiene organización).
 * Talks to: ensureWorkspaceFromSession, PlatformSection, features/contracts (server, permissions,
 *   money, components), features/obligations/flow/data.
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { PlatformSection } from "@/components/platform/section";
import { ContractsBoard, type BoardItem, type BoardSummary } from "@/features/contracts/components/contracts-board";
import { FREQUENCY_LABEL } from "@/features/contracts/components/flow/flow-model";
import { NewContractDialog } from "@/features/contracts/components/new-contract-dialog";
import { formatMinor } from "@/features/contracts/money";
import { checkCanManageContracts } from "@/features/contracts/permissions";
import { contractActorFromWorkspace, getContractsOverview } from "@/features/contracts/server";
import { latestObligations, loadProactiveData } from "@/features/obligations/flow/data";
import { OBLIGATION_STATUS_LABEL } from "@/features/obligations/labels";
import { SCHEDULE_RULE_LABELS } from "@/features/obligations/schedule/calendar";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";

export const metadata: Metadata = { title: "Contratos" };

export default function ContractsPage() {
  return (
    <PlatformSection
      title="Contratos"
      description="Cada contrato es un flujo que define cómo se paga. Los reactivos comparan cada factura que llega; los proactivos reúnen la evidencia y validan los pagos recurrentes antes de soltarlos. Un contrato no autoriza pagos: solo una autorización explícita lo hace."
    >
      <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando contratos…</p>}>
        <ContractsData />
      </Suspense>
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
  const proactive = await loadProactiveData(workspace);
  const obligations = proactive.available ? latestObligations(proactive.overview) : [];

  const proactiveItems: BoardItem[] = obligations.map((o) => {
    const runs = proactive.available ? proactive.overview.runs.filter((r) => r.occurrence.obligationId === o.obligationId) : [];
    const pending = runs.reduce((sum, r) => sum + r.requests.filter((q) => q.status === "pending").length, 0);
    return {
      id: o.obligationId,
      kind: "proactive",
      typeLabel: `Proactivo · ${o.kind === "payroll" ? "Nómina" : "Impuestos"}`,
      title: o.kind === "payroll" ? "Nómina" : "Impuestos",
      subtitle: `Recursos humanos · versión ${o.version}`,
      status: { label: OBLIGATION_STATUS_LABEL[o.status], tone: o.status === "active" ? "active" : "attention" },
      stats: [
        { label: "Calendario", value: SCHEDULE_RULE_LABELS[o.settings.schedule.rule] },
        { label: "Tope de la corrida", value: formatMinor(o.template.runCapMinor, o.template.currency) },
        { label: "Última corrida", value: runs[0] ? runs[0].occurrence.periodStart.slice(0, 7) : "—" },
        { label: "Por resolver", value: String(pending) },
      ],
      actions: [{ href: "/obligations/payroll", label: "Abrir flujo", primary: true }],
      terminated: false,
    };
  });

  const reactiveItems: BoardItem[] = overview.contracts.map((c) => ({
    id: c.contractId,
    kind: "reactive",
    typeLabel: "Reactivo",
    title: c.supplierName,
    subtitle: c.description,
    status: c.status === "active" ? { label: "Activo", tone: "active" } : { label: "Terminado", tone: "muted" },
    stats: [
      { label: "Monto", value: formatMinor(c.agreedAmountMinor, c.currency) },
      { label: "Frecuencia", value: FREQUENCY_LABEL[c.frequency] },
      { label: "Vigencia", value: `${c.validFrom} → ${c.validTo ?? "sin fin"}` },
      { label: "Cuenta", value: c.beneficiaryAccountRef ?? "—" },
      { label: "Flujo", value: c.activeFlowVersion === null ? "sin versión activa" : `versión ${c.activeFlowVersion}${c.hasDraft ? " · borrador" : ""}` },
    ],
    actions:
      c.status === "active"
        ? [
            { href: `/platform/contracts/${c.contractId}`, label: "Ver flujo" },
            ...(canManage ? [{ href: `/contracts/${c.contractId}/flow`, label: "Editar flujo", primary: true }] : []),
          ]
        : [{ href: `/platform/contracts/${c.contractId}`, label: "Ver historial" }],
    terminated: c.status === "terminated",
  }));

  const items = [...proactiveItems, ...reactiveItems];
  const live = items.filter((i) => !i.terminated);
  const pendingTotal = proactive.available ? proactive.overview.runs.reduce((sum, r) => sum + r.requests.filter((q) => q.status === "pending").length, 0) : 0;
  const summary: BoardSummary = [
    { label: "Contratos activos", value: String(live.length) },
    { label: "Proactivos", value: String(proactiveItems.length), hint: "Pacta valida los pagos recurrentes" },
    { label: "Reactivos", value: String(reactiveItems.filter((i) => !i.terminated).length), hint: "Comparan cada factura que llega" },
    { label: "Por resolver", value: String(pendingTotal), hint: pendingTotal > 0 ? "Esperan a una persona" : "Nada pendiente" },
  ];

  return <ContractsBoard items={items} summary={summary} action={canManage ? <NewContractDialog suppliers={overview.suppliers} today={today} /> : null} />;
}
