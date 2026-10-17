"use server";
/**
 * Purpose: server actions behind the contracts forms; resolve the session, validate input
 *   with Zod and delegate to server.ts, which enforces permissions.
 * Runs in: server (Next.js server actions).
 * Triggered by: form submissions on /platform/contracts (via useActionState).
 * Receives → Returns: (previous ActionState, FormData) → ActionState { ok, message } | null.
 * Talks to: ensureWorkspaceFromSession, ./schemas.ts, ./server.ts; next/cache refresh().
 */
import { refresh } from "next/cache";
import type { z } from "zod";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";
import type { ContractActor } from "./permissions";
import { ContractInputSchema, TerminateContractInputSchema } from "./schemas";
import { contractActorFromWorkspace, createContract, terminateContract, type ContractResult } from "./server";

export type ActionState = { ok: boolean; message: string } | null;

// La sesión se verifica en cada acción: ocultar un formulario no es una barrera de seguridad.
async function run<T extends z.ZodType>(
  name: string,
  schema: T,
  formData: FormData,
  mutate: (actor: ContractActor, input: z.infer<T>) => Promise<ContractResult>,
): Promise<ActionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((issue) => issue.message).join(" · ") };
  }
  try {
    const actor = contractActorFromWorkspace(await ensureWorkspaceFromSession());
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
    console.error(`[contracts/${name}] falló la acción`, error);
    return { ok: false, message: "No se pudo guardar. Intenta de nuevo." };
  }
}

export async function createContractAction(_prev: ActionState, formData: FormData) {
  return run("create-contract", ContractInputSchema, formData, createContract);
}

export async function terminateContractAction(_prev: ActionState, formData: FormData) {
  return run("terminate-contract", TerminateContractInputSchema, formData, (actor, input) =>
    terminateContract(actor, input.contractId),
  );
}
