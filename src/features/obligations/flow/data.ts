/**
 * Purpose: reunir en un solo objeto serializable lo que necesitan Contratos y el flujo de nómina:
 *   plantillas guardadas (todas las versiones), corridas recientes, reloj y qué puede hacer la
 *   persona (gestionar, aprobar, administrar). Si la base no responde, devuelve `available: false`
 *   en lugar de romper la página.
 * Runs in: servidor (Node).
 * Triggered by: /platform/contracts (resumen) y /obligations/payroll (el flujo completo).
 * Receives → Returns: Workspace → ProactiveData.
 * Talks to: ../server (getObligationsOverview, availableScenarios, defaultRuntime), ../tick#bogotaDay,
 *   policies (permisos), shared/config/dev-tools.
 */
import { checkCanManagePolicies } from "@/features/policies/permissions";
import { loadPolicyActor } from "@/features/policies/server";
import type { Workspace } from "@/shared/auth/ensure-workspace";
import { devToolsEnabled } from "@/shared/config/dev-tools";
import { availableScenarios, DEMO_SCENARIO, defaultRuntime, getObligationsOverview, type ObligationsOverview } from "../server";
import { bogotaDay } from "../tick";

export type ProactiveData =
  | { available: false }
  | {
      available: true;
      canManage: boolean; // puede crear versiones
      canApprove: boolean; // puede activar y resolver excepciones
      isAdmin: boolean;
      demoTools: boolean; // reloj de demo e historia de prueba
      today: string; // fecha de calendario de hoy en Bogotá, según el reloj vigente
      clockMode: "demo" | "system";
      scenarios: string[];
      defaultScenario: string;
      overview: ObligationsOverview;
    };

export async function loadProactiveData(workspace: Workspace): Promise<ProactiveData> {
  try {
    const actor = await loadPolicyActor(workspace);
    const demoTools = devToolsEnabled();
    const overview = await getObligationsOverview(defaultRuntime(), workspace.organization.id, { demoEnabled: demoTools });
    const canManage = checkCanManagePolicies(actor) === null;
    return {
      available: true,
      canManage,
      canApprove: actor.permission?.canApprove === true,
      isAdmin: actor.role === "admin",
      demoTools,
      today: bogotaDay(overview.clock.now),
      clockMode: overview.clock.mode,
      scenarios: availableScenarios(),
      defaultScenario: overview.obligations[0]?.settings.source.scenario ?? DEMO_SCENARIO,
      overview,
    };
  } catch (error) {
    // Sin datos del usuario en el log: solo lo necesario para depurar.
    console.error("[obligations] no se pudieron cargar las obligaciones", error);
    return { available: false };
  }
}

// Última versión de cada plantilla: la que se muestra como "el contrato proactivo".
export function latestObligations(overview: ObligationsOverview) {
  const byId = new Map<string, ObligationsOverview["obligations"][number]>();
  for (const o of overview.obligations) {
    const current = byId.get(o.obligationId);
    if (current === undefined || o.version > current.version) byId.set(o.obligationId, o);
  }
  return [...byId.values()];
}
