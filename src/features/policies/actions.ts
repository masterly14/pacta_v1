"use server";
/**
 * Purpose: server actions behind the policies forms; resolve the session, validate input
 *   with Zod and delegate to server.ts, which enforces permissions.
 * Runs in: server (Next.js server actions).
 * Triggered by: form submissions on /platform/policies (via useActionState).
 * Receives → Returns: (previous ActionState, FormData) → ActionState { ok, message } | null.
 * Talks to: ensureWorkspaceFromSession, ./schemas.ts, ./server.ts; next/cache refresh().
 */
import { refresh } from "next/cache";
import { z } from "zod";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";
import { devToolsEnabled } from "@/shared/config/dev-tools";
import type { PolicyActor } from "./permissions";
import {
  AuthorizationInputSchema,
  PermissionInputSchema,
  PolicyInputSchema,
  RevokeInputSchema,
  SupplierInputSchema,
} from "./schemas";
import {
  createAuthorization,
  createPolicyVersion,
  createSupplier,
  loadDemoData,
  loadPolicyActor,
  revokeAuthorization,
  setApprovalPermission,
  type PolicyResult,
} from "./server";

export type ActionState = { ok: boolean; message: string } | null;

// La sesión se verifica en cada acción: ocultar un formulario no es una barrera de seguridad.
async function run<T extends z.ZodType>(
  name: string,
  schema: T,
  formData: FormData,
  mutate: (actor: PolicyActor, input: z.infer<T>) => Promise<PolicyResult>,
): Promise<ActionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((issue) => issue.message).join(" · ") };
  }
  try {
    const actor = await loadPolicyActor(await ensureWorkspaceFromSession());
    const result = await mutate(actor, parsed.data);
    if (!result.ok) {
      return { ok: false, message: result.error };
    }
    refresh();
    return { ok: true, message: result.message };
  } catch (error) {
    if (error instanceof OrganizationRequiredError) {
      return { ok: false, message: error.message };
    }
    // Sin datos del formulario en el log: solo lo necesario para depurar.
    console.error(`[policies/${name}] falló la acción`, error);
    return { ok: false, message: "No se pudo guardar. Intenta de nuevo." };
  }
}

export async function createSupplierAction(_prev: ActionState, formData: FormData) {
  return run("create-supplier", SupplierInputSchema, formData, createSupplier);
}

export async function createPolicyVersionAction(_prev: ActionState, formData: FormData) {
  return run("create-policy-version", PolicyInputSchema, formData, createPolicyVersion);
}

export async function createAuthorizationAction(_prev: ActionState, formData: FormData) {
  return run("create-authorization", AuthorizationInputSchema, formData, createAuthorization);
}

export async function revokeAuthorizationAction(_prev: ActionState, formData: FormData) {
  return run("revoke-authorization", RevokeInputSchema, formData, (actor, input) =>
    revokeAuthorization(actor, input.authorizationId),
  );
}

export async function setApprovalPermissionAction(_prev: ActionState, formData: FormData) {
  return run("set-approval-permission", PermissionInputSchema, formData, setApprovalPermission);
}

export async function loadDemoDataAction(_prev: ActionState, formData: FormData) {
  if (!devToolsEnabled()) {
    return { ok: false, message: "Las herramientas de prueba están desactivadas (PACTA_SHOW_DEV_TOOLS)." };
  }
  const today = new Date().toISOString().slice(0, 10);
  return run("load-demo-data", z.object({}), formData, (actor) => loadDemoData(actor, today));
}
