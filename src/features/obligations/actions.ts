"use server";
/**
 * Purpose: acciones de servidor de las pantallas de obligaciones y corridas. Resuelven la sesión en cada llamada (ocultar un
 *   control no es una barrera), validan con Zod y delegan en server.ts, que verifica el permiso.
 * Runs in: servidor (Next.js server actions).
 * Triggered by: formularios de /platform/obligations y /platform/runs (via useFormAction).
 * Receives → Returns: (estado previo, FormData) → { ok, message } | null.
 * Talks to: ensureWorkspaceFromSession, policies/server#loadPolicyActor, ./server, ./clock.
 */
import { refresh } from "next/cache";
import { z } from "zod";
import { loadPolicyActor } from "@/features/policies/server";
import type { PolicyActor } from "@/features/policies/permissions";
import { ensureWorkspaceFromSession, OrganizationRequiredError } from "@/shared/auth/ensure-workspace";
import { devToolsEnabled } from "@/shared/config/dev-tools";
import { readClock } from "./clock";
import { ResolveLineInputSchema } from "./lines";
import {
  activateObligation,
  advanceClock,
  defaultRuntime,
  pauseObligation,
  policyCurrencyOf,
  resolveLine,
  saveObligationDraft,
  seedDemoHistory,
  setClock,
} from "./server";

export type ActionState = { ok: boolean; message: string } | null;

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const DateSchema = z.iso.date();

async function run(name: string, mutate: (actor: PolicyActor) => Promise<{ ok: true; message: string } | { ok: false; error: string }>): Promise<ActionState> {
  try {
    const actor = await loadPolicyActor(await ensureWorkspaceFromSession());
    const result = await mutate(actor);
    if (!result.ok) return { ok: false, message: result.error };
    refresh();
    return { ok: true, message: result.message };
  } catch (error) {
    if (error instanceof OrganizationRequiredError) return { ok: false, message: error.message };
    console.error(`[obligations/${name}] falló la acción`, error);
    return { ok: false, message: "No se pudo completar la acción. Intenta de nuevo." };
  }
}

const DraftSchema = z.object({ schedule: z.string().min(2).max(2000), scenario: z.string().regex(/^[a-z0-9-]+$/) });

export async function saveDraftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = DraftSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Completa el calendario y la fuente de RR. HH." };
  let schedule: unknown;
  try {
    schedule = JSON.parse(parsed.data.schedule);
  } catch {
    return { ok: false, message: "El calendario no es válido." };
  }
  return run("save-draft", async (actor) => {
    const result = await saveObligationDraft(defaultRuntime(), actor, { schedule, scenario: parsed.data.scenario, now: nowIso() });
    return result.ok ? { ok: true, message: `Versión ${result.obligation.version} guardada como borrador. Nada opera hasta que una persona la active.` } : result;
  });
}

const VersionSchema = z.object({ obligationId: z.string().min(1).max(200), version: z.coerce.number().int().positive() });

export async function activateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = VersionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Plantilla inválida." };
  return run("activate", async (actor) => {
    const result = await activateObligation(defaultRuntime(), actor, { ...parsed.data, now: nowIso() });
    return result.ok ? { ok: true, message: `Versión ${result.obligation.version} activa: Pacta preparará y evaluará cada corrida según el calendario.` } : result;
  });
}

export async function pauseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = VersionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Plantilla inválida." };
  return run("pause", async (actor) => {
    const result = await pauseObligation(defaultRuntime(), actor, { ...parsed.data, now: nowIso() });
    return result.ok ? { ok: true, message: "Plantilla pausada: no se prepararán nuevas corridas." } : result;
  });
}

export async function advanceClockAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ to: DateSchema }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Elige una fecha válida." };
  return run("advance-clock", async (actor) => {
    const result = await advanceClock(defaultRuntime(), actor, parsed.data);
    return result.ok
      ? { ok: true, message: `Reloj en ${parsed.data.to}: ${result.ran} fase(s) ejecutada(s)${result.failed ? `, ${result.failed} con error (revisa la auditoría)` : ""}.` }
      : result;
  });
}

export async function setClockAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z.object({ date: DateSchema }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "Elige una fecha válida." };
  return run("set-clock", async (actor) => {
    const result = await setClock(defaultRuntime(), actor, parsed.data);
    return result.ok ? { ok: true, message: `Reloj fijado en ${parsed.data.date} (sin ejecutar fases).` } : result;
  });
}

export async function seedHistoryAction(): Promise<ActionState> {
  if (!devToolsEnabled()) return { ok: false, message: "Las herramientas de prueba están desactivadas (PACTA_SHOW_DEV_TOOLS)." };
  return run("seed-history", async (actor) => {
    const result = await seedDemoHistory(defaultRuntime(), actor, { now: nowIso() });
    return result.ok ? { ok: true, message: `Historia fixture cargada: ${result.seededMonths} meses de nómina con sus resoluciones.` } : result;
  });
}

export async function resolveLineAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = ResolveLineInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, message: "La resolución no es válida." };
  return run("resolve-line", async (actor) => {
    const runtime = defaultRuntime();
    const clock = await readClock(runtime.store, actor.organizationId, { demoEnabled: devToolsEnabled() });
    const result = await resolveLine(runtime, actor, parsed.data, { now: clock.now, policyCurrency: await policyCurrencyOf(actor.organizationId) });
    return result.ok ? { ok: true, message: result.message } : { ok: false, error: result.error };
  });
}
