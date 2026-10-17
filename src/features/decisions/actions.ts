"use server";
/**
 * Purpose: server actions behind the decision simulator: build a fictitious invoice (a fixed
 *   scenario or one typed by a person) and run it through evaluateInvoice(), the same
 *   function A's pipeline will call.
 * Runs in: server (Next.js server actions).
 * Triggered by: the simulator buttons and the "Factura de prueba" form on /platform/audit.
 * Receives → Returns: (previous state, FormData) → { ok, message } | null.
 * Talks to: ensureWorkspaceFromSession, ./fixtures/demo-invoices.ts, ./fixtures/custom-invoice.ts,
 *   ./server.ts; next/cache refresh().
 */
import { refresh } from "next/cache";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";
import type { FormActionState } from "@/shared/forms/use-form-action";
import { buildCustomInvoice, CustomInvoiceInputSchema } from "./fixtures/custom-invoice";
import { buildDemoInvoice } from "./fixtures/demo-invoices";
import { DEMO_SCENARIOS, isDemoScenario } from "./fixtures/scenarios";
import { evaluateInvoice } from "./server";

const OUTCOME_LABEL = { approved: "✅ aprobada", blocked: "🔴 bloqueada", requires_approval: "🟡 requiere aprobación" } as const;

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

export async function evaluateCustomInvoiceAction(_previous: FormActionState, formData: FormData): Promise<FormActionState> {
  const parsed = CustomInvoiceInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((issue) => issue.message).join(" · ") };
  }
  try {
    const workspace = await ensureWorkspaceFromSession();
    // Escribe decisiones en la organización: solo administradores, verificado en servidor.
    if (workspace.membership.role !== "admin") {
      return { ok: false, message: "Solo un administrador puede usar el simulador." };
    }
    const built = await buildCustomInvoice(parsed.data, workspace.organization.id, new Date());
    if (!built.ok) {
      return { ok: false, message: built.error };
    }
    const decision = await evaluateInvoice(built.invoice);
    refresh();
    const reasons = decision.reasonCodes.filter((code) => code !== "HUMAN_APPROVAL_REQUIRED").join(", ");
    return { ok: true, message: `Decisión: ${OUTCOME_LABEL[decision.decision]} · Motivos: ${reasons}` };
  } catch (error) {
    if (error instanceof OrganizationRequiredError) {
      return { ok: false, message: error.message };
    }
    // Fail-closed: un error nunca produce una aprobación. Sin datos de la factura en el log.
    console.error("[decisions/custom-invoice] falló la evaluación", { error });
    return { ok: false, message: "No se pudo evaluar la factura. Intenta de nuevo." };
  }
}
