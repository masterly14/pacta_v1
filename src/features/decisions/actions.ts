"use server";
/**
 * Purpose: server action behind the decision simulator: builds a fictitious invoice for a
 *   scenario and runs it through evaluateInvoice(), the same function A's pipeline will call.
 * Runs in: server (Next.js server action).
 * Triggered by: the simulator buttons on /platform/audit (via useFormAction).
 * Receives → Returns: (previous state, FormData { scenario }) → { ok, message } | null.
 * Talks to: ensureWorkspaceFromSession, ./fixtures/demo-invoices.ts, ./server.ts; next/cache refresh().
 */
import { refresh } from "next/cache";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";
import type { FormActionState } from "@/shared/forms/use-form-action";
import { buildDemoInvoice } from "./fixtures/demo-invoices";
import { DEMO_SCENARIOS, isDemoScenario } from "./fixtures/scenarios";
import { evaluateInvoice } from "./server";

const OUTCOME_LABEL = { approved: "aprobada", blocked: "bloqueada", requires_approval: "requiere aprobación" } as const;

export async function simulateInvoiceAction(_previous: FormActionState, formData: FormData): Promise<FormActionState> {
  const scenario = String(formData.get("scenario") ?? "");
  if (!isDemoScenario(scenario)) {
    return { ok: false, message: "Escenario desconocido." };
  }
  try {
    const workspace = await ensureWorkspaceFromSession();
    // Escribe decisiones en la organización: solo administradores, verificado en servidor.
    if (workspace.membership.role !== "admin") {
      return { ok: false, message: "Solo un administrador puede usar el simulador." };
    }
    const built = await buildDemoInvoice(scenario, workspace.organization.id, new Date());
    if (!built.ok) {
      return { ok: false, message: built.error };
    }
    const decision = await evaluateInvoice(built.invoice);
    refresh();
    const label = DEMO_SCENARIOS.find((s) => s.id === scenario)?.label ?? scenario;
    return { ok: true, message: `${label}: ${OUTCOME_LABEL[decision.decision]}.` };
  } catch (error) {
    if (error instanceof OrganizationRequiredError) {
      return { ok: false, message: error.message };
    }
    // Fail-closed: un error nunca produce una aprobación. Sin datos de la factura en el log.
    console.error("[decisions/simulate] falló la evaluación", { scenario, error });
    return { ok: false, message: "No se pudo evaluar la factura. Intenta de nuevo." };
  }
}
