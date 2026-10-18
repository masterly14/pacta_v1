/**
 * Purpose: operaciones de servidor de las obligaciones recurrentes: crear una plantilla en borrador, activarla (la
 *   autorización explícita de una persona), guardar un calendario nuevo, leer las corridas para la pantalla, avanzar el
 *   reloj de demo, sembrar la historia fixture y resolver líneas. Toda mutación verifica el permiso en el servidor y se audita.
 * Runs in: servidor (acciones, ruta del cron y pruebas con un runtime en memoria).
 * Receives → Returns: actor + datos validados → { ok, … } | { ok: false, error } (los casos de negocio no lanzan).
 * Talks to: store (Prisma o memoria), tick/clock/runner/lines, policies/permissions, fixtures de Buk (solo la demo).
 */
import { db } from "@/lib/db";
import { checkCanManagePolicies, type PolicyActor } from "@/features/policies/permissions";
import { DEFAULT_EVIDENCE_MAX_AGE_DAYS, DEFAULT_URGENT_ALERT_DAYS, DEFAULT_EARLY_ALERT_DAYS, DEFAULT_VARIANCE_TOLERANCE_BPS, ObligationTemplateSchema, type ObligationTemplate } from "@/shared/schemas/obligation-config";
import { devToolsEnabled } from "@/shared/config/dev-tools";
import { advanceDemoClock, readClock, setDemoClockDate, type ClockReading } from "./clock";
import { replayLedger, type Ledger } from "./fixtures/buk/ledger";
import { loadManifest, listScenarios, readScenarioJson } from "./fixtures/buk/manifest";
import { HISTORY_RESOLUTIONS } from "./fixtures/buk/resolutions";
import { OBLIGATION_BASE } from "./fixtures/buk/builders";
import { resolveObligationLine, type ResolveLineInput, type ResolveLineResult } from "./lines";
import { createPrismaRuntime } from "./prisma-store";
import { openFixturePayroll, type LearnedProvider } from "./runner";
import { ScheduleSchema, type Schedule } from "./schedule/calendar";
import { ObligationSettingsSchema, type ApprovalRequestRow, type DecisionRow, type ObligationSettings, type OccurrenceRow, type SimulatedPaymentRow, type StoreRuntime, type StoredObligation } from "./store";
import type { TickReport } from "./tick";

export type ObligationResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export const defaultRuntime = (): StoreRuntime => createPrismaRuntime(db);

/** Hallazgos aprendidos que el servidor inyecta al motor (F4); null mientras no haya perfiles disponibles. */
let learnedProvider: LearnedProvider | undefined;
export const setLearnedProvider = (provider: LearnedProvider | undefined) => {
  learnedProvider = provider;
};
export const getLearnedProvider = () => learnedProvider;

/** Plantilla de nómina con los valores por omisión de los contratos compartidos. */
export function buildPayrollTemplate(input: {
  organizationId: string;
  obligationId: string;
  version: number;
  status: ObligationTemplate["status"];
  activatedBy: string | null;
  activatedAt: string | null;
  runCapMinor?: number;
  varianceToleranceBps?: number;
}): ObligationTemplate {
  return ObligationTemplateSchema.parse({
    schemaVersion: 1,
    obligationId: input.obligationId,
    organizationId: input.organizationId,
    kind: "payroll",
    calendar: { kind: "payroll", frequency: "monthly", anchor: "month_end" },
    currency: "COP",
    varianceToleranceBps: input.varianceToleranceBps ?? DEFAULT_VARIANCE_TOLERANCE_BPS,
    runCapMinor: input.runCapMinor ?? 12_000_000_000, // $120.000.000 COP
    evidenceMaxAgeDays: DEFAULT_EVIDENCE_MAX_AGE_DAYS,
    earlyAlertDays: DEFAULT_EARLY_ALERT_DAYS,
    urgentAlertDays: DEFAULT_URGENT_ALERT_DAYS,
    version: input.version,
    status: input.status,
    activatedBy: input.activatedBy,
    activatedAt: input.activatedAt,
    dataOrigin: "fixture",
  });
}

export const payrollObligationIdOf = (organizationId: string) => `obl_nomina_${organizationId.replace(/[^a-zA-Z0-9]/g, "").slice(-10).toLowerCase()}`;

/** Escenarios de Buk que sirven como fuente de la demo (nómina mensual). */
export const availableScenarios = () => listScenarios().filter((name) => name.startsWith("nomina-") || name.startsWith("aprendizaje-"));

/** Con la fuente del fixture solo hay liquidaciones mensuales completas: los calendarios quincenales no se soportan todavía. */
export const supportedScheduleRules: Schedule["rule"][] = ["month_end", "day_of_month"];

function checkSettings(settings: ObligationSettings): string | null {
  if (!supportedScheduleRules.includes(settings.schedule.rule)) return "Con la fuente actual (liquidación mensual de RR. HH.) el calendario debe ser fin de mes o un día fijo del mes.";
  if (!availableScenarios().includes(settings.source.scenario)) return "El escenario de RR. HH. no existe.";
  return null;
}

/** Crear o actualizar la plantilla = una versión NUEVA en borrador. Nada opera en automático hasta que una persona la active. */
export async function saveObligationDraft(
  runtime: StoreRuntime,
  actor: PolicyActor,
  input: { schedule: unknown; scenario: string; now: string; varianceToleranceBps?: number; runCapMinor?: number },
): Promise<ObligationResult<{ obligation: StoredObligation }>> {
  const denial = checkCanManagePolicies(actor);
  if (denial) return fail(denial);
  const schedule = ScheduleSchema.safeParse(input.schedule);
  if (!schedule.success) return fail(schedule.error.issues[0]?.message ?? "Calendario inválido.");
  const settings = ObligationSettingsSchema.safeParse({ schedule: schedule.data, source: { provider: "buk_fixture", scenario: input.scenario } });
  if (!settings.success) return fail("La fuente de RR. HH. no es válida.");
  const rejection = checkSettings(settings.data);
  if (rejection) return fail(rejection);

  // Reglas de control opcionales (si faltan, valen los valores por omisión de la plantilla).
  if (input.varianceToleranceBps !== undefined && !(Number.isInteger(input.varianceToleranceBps) && input.varianceToleranceBps >= 0 && input.varianceToleranceBps <= 10_000)) return fail("La tolerancia debe estar entre 0 % y 100 %.");
  if (input.runCapMinor !== undefined && !(Number.isSafeInteger(input.runCapMinor) && input.runCapMinor > 0)) return fail("El tope de la corrida debe ser un monto mayor que 0.");

  const obligationId = payrollObligationIdOf(actor.organizationId);
  return runtime.transaction(actor.organizationId, async (store) => {
    const versions = (await store.listObligations(actor.organizationId)).filter((o) => o.obligationId === obligationId);
    const version = Math.max(0, ...versions.map((o) => o.version)) + 1;
    const obligation = await store.insertObligation({
      organizationId: actor.organizationId,
      obligationId,
      version,
      kind: "payroll",
      status: "draft",
      template: buildPayrollTemplate({ organizationId: actor.organizationId, obligationId, version, status: "draft", activatedBy: null, activatedAt: null, varianceToleranceBps: input.varianceToleranceBps, runCapMinor: input.runCapMinor }),
      settings: settings.data,
      createdBy: actor.userId,
    });
    await store.audit({ organizationId: actor.organizationId, entityType: "payment_obligation", entityId: obligationId, eventType: "payment_obligation.draft_created", actorId: actor.userId, payload: { version, settings: settings.data, at: input.now } });
    return { ok: true as const, obligation };
  });
}

/**
 * Activar = autorizar pagos automáticos de esta plantilla dentro de sus límites. Exige permiso de gestionar políticas Y de
 * aprobar: nadie autoriza lo que no podría aprobar. Las versiones activas anteriores se pausan.
 */
export async function activateObligation(runtime: StoreRuntime, actor: PolicyActor, input: { obligationId: string; version: number; now: string }): Promise<ObligationResult<{ obligation: StoredObligation }>> {
  const denial = checkCanManagePolicies(actor);
  if (denial) return fail(denial);
  if (!actor.permission?.canApprove) return fail("Necesitas permiso de aprobación para activar pagos automáticos.");
  return runtime.transaction(actor.organizationId, async (store) => {
    const target = await store.getObligation(actor.organizationId, input.obligationId, input.version);
    if (!target) return fail("La plantilla no existe.");
    if (target.status !== "draft" && target.status !== "paused") return fail("Solo se activa una plantilla en borrador o pausada.");
    for (const other of (await store.listObligations(actor.organizationId)).filter((o) => o.obligationId === target.obligationId && o.status === "active")) {
      await store.setObligationStatus(actor.organizationId, other.obligationId, other.version, { status: "paused", actorId: actor.userId, at: input.now });
    }
    const obligation = (await store.setObligationStatus(actor.organizationId, target.obligationId, target.version, { status: "active", actorId: actor.userId, at: input.now }))!;
    await store.audit({ organizationId: actor.organizationId, entityType: "payment_obligation", entityId: target.obligationId, eventType: "payment_obligation.activated", actorId: actor.userId, payload: { version: target.version, runCapMinor: target.template.runCapMinor, toleranceBps: target.template.varianceToleranceBps, at: input.now } });
    return { ok: true as const, obligation };
  });
}

export async function pauseObligation(runtime: StoreRuntime, actor: PolicyActor, input: { obligationId: string; version: number; now: string }): Promise<ObligationResult<{ obligation: StoredObligation }>> {
  const denial = checkCanManagePolicies(actor);
  if (denial) return fail(denial);
  return runtime.transaction(actor.organizationId, async (store) => {
    const obligation = await store.setObligationStatus(actor.organizationId, input.obligationId, input.version, { status: "paused", actorId: actor.userId, at: input.now });
    if (!obligation) return fail("La plantilla no existe.");
    await store.audit({ organizationId: actor.organizationId, entityType: "payment_obligation", entityId: input.obligationId, eventType: "payment_obligation.paused", actorId: actor.userId, payload: { version: input.version, at: input.now } });
    return { ok: true as const, obligation };
  });
}

// ---------------------------------------------------------------------------
// Lectura para las pantallas
// ---------------------------------------------------------------------------

export type RunView = {
  occurrence: OccurrenceRow;
  obligation: StoredObligation | null;
  lines: DecisionRow[];
  requests: (ApprovalRequestRow & { decision: DecisionRow | null })[];
  payments: SimulatedPaymentRow[];
};

export type ObligationsOverview = {
  clock: ClockReading;
  demoClockEnabled: boolean;
  obligations: StoredObligation[];
  runs: RunView[];
  claims: { obligationId: string; periodStart: string; phase: string; asOf: string }[];
};

export async function getObligationsOverview(runtime: StoreRuntime, organizationId: string, options: { demoEnabled: boolean }): Promise<ObligationsOverview> {
  const { store } = runtime;
  const [obligations, occurrences, clock] = await Promise.all([store.listObligations(organizationId), store.listOccurrences(organizationId, 6), readClock(store, organizationId, { demoEnabled: options.demoEnabled })]);
  const requests = await store.listRequests(organizationId, null, 200);
  const runs: RunView[] = [];
  for (const occurrence of occurrences) {
    const lines = await store.latestDecisions(organizationId, occurrence.id);
    const own = requests.filter((r) => r.occurrenceId === occurrence.id);
    runs.push({
      occurrence,
      obligation: obligations.find((o) => o.obligationId === occurrence.obligationId && o.version === occurrence.obligationVersion) ?? null,
      lines,
      requests: await Promise.all(own.map(async (r) => ({ ...r, decision: await store.getDecision(organizationId, r.decisionId) }))),
      payments: await store.listPayments(organizationId, occurrence.id),
    });
  }
  const claims = (await Promise.all([...new Set(obligations.map((o) => o.obligationId))].map(async (id) => (await store.listPhaseClaims(organizationId, id)).map((c) => ({ obligationId: id, ...c }))))).flat();
  return { clock, demoClockEnabled: options.demoEnabled, obligations, runs, claims };
}

// ---------------------------------------------------------------------------
// Reloj de demo y siembra de historia (solo con las herramientas de prueba activas)
// ---------------------------------------------------------------------------

const requireAdminDemo = (actor: PolicyActor) => {
  if (!devToolsEnabled()) return "Las herramientas de prueba están ocultas en este entorno.";
  if (actor.role !== "admin") return "Solo un administrador maneja el reloj de demo.";
  return null;
};

export async function advanceClock(runtime: StoreRuntime, actor: PolicyActor, input: { to: string }): Promise<ObligationResult<{ reports: TickReport[]; ran: number; failed: number; clock: string }>> {
  const denied = requireAdminDemo(actor);
  if (denied) return fail(denied);
  try {
    const start = await readClock(runtime.store, actor.organizationId, { demoEnabled: true });
    const { reports, clock } = await advanceDemoClock({ runtime, organizationId: actor.organizationId, openFacts: openFixturePayroll, learned: learnedProvider, to: input.to, by: actor.userId, start });
    const entries = reports.flatMap((r) => r.entries);
    return { ok: true, reports, ran: entries.filter((e) => e.outcome === "ran").length, failed: entries.filter((e) => e.outcome === "failed").length, clock };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "No se pudo avanzar el reloj.");
  }
}

export async function setClock(runtime: StoreRuntime, actor: PolicyActor, input: { date: string }): Promise<ObligationResult<{ now: string }>> {
  const denied = requireAdminDemo(actor);
  if (denied) return fail(denied);
  return { ok: true, now: await setDemoClockDate(runtime.store, actor.organizationId, input.date, actor.userId) };
}

export const DEMO_SCENARIO = "aprendizaje-trimestral";

/**
 * Siembra la historia fixture hasta `seedThrough` del escenario: la plantilla activa, lo último confirmado y las corridas
 * pasadas con sus decisiones y resoluciones humanas (de ahí aprenden los perfiles). Idempotente: si ya hay corridas, no toca nada.
 */
export async function seedDemoHistory(runtime: StoreRuntime, actor: PolicyActor, input: { now: string }): Promise<ObligationResult<{ seededMonths: number }>> {
  const denied = requireAdminDemo(actor);
  if (denied) return fail(denied);
  return runtime.transaction(actor.organizationId, async (store) => {
    if ((await store.listOccurrences(actor.organizationId, 1)).length > 0) return fail("Ya hay corridas en esta organización: la siembra no sobrescribe nada.");
    const manifest = loadManifest(DEMO_SCENARIO);
    const stored = readScenarioJson<Ledger & { seedThrough: string }>(DEMO_SCENARIO, manifest.pacta.decisionHistory!);
    const obligationId = payrollObligationIdOf(actor.organizationId);
    const activatedAt = "2025-09-01T14:00:00Z";
    const obligation = await store.insertObligation({
      organizationId: actor.organizationId,
      obligationId,
      version: 1,
      kind: "payroll",
      status: "active",
      template: buildPayrollTemplate({ organizationId: actor.organizationId, obligationId, version: 1, status: "active", activatedBy: actor.userId, activatedAt }),
      settings: { schedule: ScheduleSchema.parse({ rule: "month_end" }), source: { provider: "buk_fixture", scenario: DEMO_SCENARIO } },
      createdBy: actor.userId,
      activatedBy: actor.userId,
      activatedAt,
    });
    const through = stored.seedThrough;
    const months = stored.months.filter((m) => m.month <= through);
    for (const month of months) {
      const periodStart = `${month.month}-01`;
      const periodEnd = new Date(Date.UTC(Number(month.month.slice(0, 4)), Number(month.month.slice(5)), 0)).toISOString().slice(0, 10);
      const occurrence = await store.upsertOccurrence({
        organizationId: actor.organizationId,
        obligationId,
        obligationVersion: 1,
        periodStart,
        periodEnd,
        dueDate: periodEnd,
        status: "simulated_executed",
        asOf: month.asOf,
        evidenceSha: null,
        evaluation: { seeded: true, dataOrigin: "fixture" },
      });
      for (const line of month.lines) {
        const key = `seed:${occurrence.id}:${line.lineId}`;
        const automatic = await store.insertDecision({
          organizationId: actor.organizationId,
          occurrenceId: occurrence.id,
          lineId: line.lineId,
          counterpartyRef: line.counterpartyRef,
          displayName: line.displayName,
          lineType: line.lineType,
          amountMinor: line.amountMinor,
          currency: "COP",
          decision: line.autoDecision,
          decisionSource: "automatic",
          reasonCodes: line.reasons,
          rules: [],
          decisionKey: key,
          evidenceSha: "seed",
          actorId: null,
          comment: null,
          evaluatedAt: month.asOf,
        });
        let deciding = automatic.row;
        if (line.resolution) {
          const request = await store.insertRequest({ organizationId: actor.organizationId, occurrenceId: occurrence.id, lineId: line.lineId, decisionId: automatic.row.id, at: month.asOf });
          const human = await store.insertDecision({
            ...{ organizationId: actor.organizationId, occurrenceId: occurrence.id, lineId: line.lineId, counterpartyRef: line.counterpartyRef, displayName: line.displayName, lineType: line.lineType, amountMinor: line.amountMinor, currency: "COP" },
            decision: line.finalDecision,
            decisionSource: "human",
            reasonCodes: line.reasons,
            rules: [],
            decisionKey: `${key}:human`,
            evidenceSha: "seed",
            actorId: line.resolution.actor,
            comment: line.resolution.comment,
            evaluatedAt: line.resolution.resolvedAt,
          });
          deciding = human.row;
          if (request) await store.resolveRequest(actor.organizationId, request.id, { status: line.resolution.action === "approve" ? "approved" : "rejected", by: line.resolution.actor, comment: line.resolution.comment, at: line.resolution.resolvedAt });
        }
        if (line.finalDecision === "approved" && line.amountMinor !== null) {
          await store.recordPayment({ organizationId: actor.organizationId, occurrenceId: occurrence.id, lineId: line.lineId, decisionId: deciding.id, amountMinor: line.amountMinor, currency: "COP", executedAt: month.asOf });
        }
      }
    }
    // Lo confirmado al cierre de la siembra, derivado del libro (no escrito a mano)
    const confirmed = await replayLedger({ template: OBLIGATION_BASE, from: "2025-10", to: through, resolutions: HISTORY_RESOLUTIONS.filter((r) => r.month <= through) });
    for (const [counterpartyRef, value] of Object.entries(confirmed.confirmed)) {
      if (value.amountMinor !== null) await store.upsertConfirmation({ organizationId: actor.organizationId, obligationId, counterpartyRef, beneficiaryReference: value.beneficiaryReference, amountMinor: value.amountMinor, confirmedPeriod: `${through}-01` });
    }
    // Fases del calendario de los meses sembrados, ya reclamadas: el tick no las repite
    for (const month of months) {
      for (const phase of ["prepare", "alert_early", "alert_urgent", "execute"] as const) {
        await store.claimPhase({ organizationId: actor.organizationId, obligationId, periodStart: `${month.month}-01`, phase, asOf: month.asOf });
      }
    }
    await setDemoClockDate(store, actor.organizationId, `${through.slice(0, 7)}-28`, actor.userId);
    await store.audit({ organizationId: actor.organizationId, entityType: "payment_obligation", entityId: obligation.obligationId, eventType: "payment_obligation.demo_history_seeded", actorId: actor.userId, payload: { scenario: DEMO_SCENARIO, through, months: months.length, at: input.now, dataOrigin: "fixture" } });
    return { ok: true as const, seededMonths: months.length };
  });
}

// ---------------------------------------------------------------------------
// Aprobación de una línea y cron
// ---------------------------------------------------------------------------

export async function resolveLine(runtime: StoreRuntime, actor: PolicyActor, input: ResolveLineInput, options: { now: string; policyCurrency: string | null }): Promise<ResolveLineResult> {
  return resolveObligationLine({ runtime, actor, input, now: options.now, policyCurrency: options.policyCurrency, openFacts: openFixturePayroll, learned: learnedProvider });
}

/** Moneda de la política de pagos vigente de la organización (en ella se interpreta el límite del aprobador). */
export async function policyCurrencyOf(organizationId: string): Promise<string | null> {
  const policy = await db.paymentPolicy.findFirst({ where: { organizationId }, orderBy: { version: "desc" }, select: { currency: true } });
  return policy?.currency ?? null;
}

/** Organizaciones con al menos una plantilla activa: las que recorre el cron. */
export async function organizationsWithActiveObligations(): Promise<string[]> {
  const rows = await db.paymentObligation.findMany({ where: { status: "active" }, distinct: ["organizationId"], select: { organizationId: true } });
  return rows.map((row) => row.organizationId);
}
