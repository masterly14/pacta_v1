"use server";
/**
 * Purpose: server actions del editor de flujos: guardar borrador, activar y simular. Resuelven la
 *   sesión en cada llamada y delegan en server.ts, que aplica permisos y validación.
 * Runs in: servidor (server actions de Next.js).
 * Triggered by: el editor de /platform/contracts/[id]/editor (componentes cliente).
 * Receives → Returns: (contractId, JSON del grafo, hash base) → FlowActionState; el simulador
 *   devuelve la evaluación sin guardar nada.
 * Talks to: ensureWorkspaceFromSession, ./server.ts, ./validate.ts, ./evaluate.ts; next/cache refresh().
 */
import { refresh } from "next/cache";
import { z } from "zod";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";
import { AmountMinorSchema, CalendarDateSchema, CurrencyCodeSchema } from "@/shared/schemas/invoice-context";
import { checkCanManageContracts } from "../permissions";
import { contractActorFromWorkspace } from "../server";
import { evaluateFlow, type FlowEvaluation } from "./evaluate";
import { activateFlow, saveFlowDraft, type FlowResult } from "./server";
import { validateFlow, type FlowIssue } from "./validate";

export type FlowActionState =
  | { ok: true; message: string; version: number; graphSha256: string }
  | { ok: false; message: string; issues: FlowIssue[] };

const FactsSchema = z.strictObject({
  amountMinor: AmountMinorSchema.nullable(),
  currency: CurrencyCodeSchema.nullable(),
  invoiceDate: CalendarDateSchema.nullable(),
  dueDate: CalendarDateSchema.nullable(),
  beneficiaryAccountReference: z.string().trim().min(1).max(120).nullable(),
  deliveredMilestones: z.array(z.string().max(80)).max(50).nullable(),
});

const IdSchema = z.string().min(1).max(64);
const Sha = z.string().regex(/^[a-f0-9]{64}$/);

async function withActor<T>(name: string, fallback: T, fn: (actor: ReturnType<typeof contractActorFromWorkspace>) => Promise<T>): Promise<T> {
  try {
    return await fn(contractActorFromWorkspace(await ensureWorkspaceFromSession()));
  } catch (error) {
    if (error instanceof OrganizationRequiredError) throw error;
    console.error(`[contracts/flow/${name}] falló la acción`, error);
    return fallback;
  }
}

const unexpected: FlowActionState = { ok: false, message: "No se pudo completar la acción. Intenta de nuevo.", issues: [] };

function toState(result: FlowResult): FlowActionState {
  if (!result.ok) return { ok: false, message: result.error, issues: result.issues };
  refresh();
  return { ok: true, message: result.message, version: result.version, graphSha256: result.graphSha256 };
}

export async function saveFlowDraftAction(contractId: string, graph: unknown, baseSha256: string | null): Promise<FlowActionState> {
  const args = z.tuple([IdSchema, Sha.nullable()]).safeParse([contractId, baseSha256]);
  if (!args.success) return { ok: false, message: "Solicitud inválida.", issues: [] };
  return withActor("save-draft", unexpected, async (actor) => toState(await saveFlowDraft(actor, args.data[0], graph, args.data[1])));
}

export async function activateFlowAction(contractId: string, expectedSha256: string): Promise<FlowActionState> {
  const args = z.tuple([IdSchema, Sha]).safeParse([contractId, expectedSha256]);
  if (!args.success) return { ok: false, message: "Solicitud inválida.", issues: [] };
  return withActor("activate", unexpected, async (actor) => toState(await activateFlow(actor, args.data[0], args.data[1])));
}

export type SimulationState =
  | { ok: true; evaluation: FlowEvaluation }
  | { ok: false; message: string; issues: FlowIssue[] };

// No toca la base de datos: evalúa un grafo (aunque sea un borrador) contra una factura de prueba.
export async function simulateFlowAction(graph: unknown, facts: unknown): Promise<SimulationState> {
  return withActor<SimulationState>("simulate", { ok: false, message: "No se pudo simular.", issues: [] }, async (actor) => {
    const denial = checkCanManageContracts(actor);
    if (denial !== null) return { ok: false, message: denial, issues: [] };
    const validation = validateFlow(graph);
    if (!validation.ok) return { ok: false, message: "El flujo no es válido.", issues: validation.errors };
    const parsed = FactsSchema.safeParse(facts);
    if (!parsed.success) return { ok: false, message: "Los datos de la factura de prueba no son válidos.", issues: [] };
    return { ok: true, evaluation: evaluateFlow(validation.graph, parsed.data) };
  });
}
