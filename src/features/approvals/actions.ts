"use server";
/**
 * Purpose: server action behind Approve / Reject on /platform/approvals; resolves the session,
 *   validates input with Zod and delegates to server.ts, which re-evaluates and enforces permissions.
 * Runs in: server (Next.js server action).
 * Triggered by: the resolve form on each pending request (via useFormAction).
 * Receives → Returns: (previous state, FormData) → { ok, message } | null.
 * Talks to: ensureWorkspaceFromSession, policies/server#loadPolicyActor, ./schemas.ts, ./server.ts;
 *   next/cache refresh().
 */
import { refresh } from "next/cache";
import { loadPolicyActor } from "@/features/policies/server";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";
import type { FormActionState } from "@/shared/forms/use-form-action";
import { ResolveApprovalInputSchema } from "./schemas";
import { resolveApprovalRequest } from "./server";

export async function resolveApprovalAction(_previous: FormActionState, formData: FormData): Promise<FormActionState> {
  const parsed = ResolveApprovalInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((issue) => issue.message).join(" · ") };
  }
  try {
    // La sesión y los permisos se verifican en servidor: ocultar el botón no es una barrera.
    const actor = await loadPolicyActor(await ensureWorkspaceFromSession());
    const result = await resolveApprovalRequest(actor, parsed.data);
    // Incluso si la revalidación bloqueó la factura, la solicitud cambió: se refresca la vista.
    refresh();
    return result.ok ? { ok: true, message: result.message } : { ok: false, message: result.error };
  } catch (error) {
    if (error instanceof OrganizationRequiredError) {
      return { ok: false, message: error.message };
    }
    // Fail-closed: un error nunca produce una aprobación.
    console.error("[approvals/resolve] falló la resolución", { approvalRequestId: parsed.data.approvalRequestId, error });
    return { ok: false, message: "No se pudo resolver la solicitud. Intenta de nuevo." };
  }
}
