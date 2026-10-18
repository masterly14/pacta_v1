"use server";
/**
 * Purpose: server action for the bank CSV upload on /platform/payment-history.
 * Runs in: server (Next.js server action).
 * Triggered by: the import form.
 * Receives → Returns: (previous state, FormData with a file) → { ok, message } | null.
 * Talks to: ensureWorkspaceFromSession, loadPolicyActor, import-csv.ts.
 */
import { refresh } from "next/cache";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";
import { loadPolicyActor } from "@/features/policies/server";
import { importBankCsv } from "./import-csv";

export type ActionState = { ok: boolean; message: string } | null;

export async function importBankCsvAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, message: "Elige un archivo CSV." };
  }
  try {
    const actor = await loadPolicyActor(await ensureWorkspaceFromSession());
    const result = await importBankCsv(actor, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    if (!result.ok) return { ok: false, message: result.error };
    refresh();
    return { ok: true, message: result.message };
  } catch (error) {
    if (error instanceof OrganizationRequiredError) return { ok: false, message: error.message };
    console.error("[payment-history/import] falló la importación", error);
    return { ok: false, message: "No se pudo importar el archivo. Intenta de nuevo." };
  }
}
