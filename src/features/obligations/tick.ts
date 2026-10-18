/**
 * Purpose: el tick. Un único proceso (cron real o botón de demo) que mira la fecha de hoy, calcula qué fases del calendario
 *   de cada obligación activa ya vencieron y las ejecuta UNA sola vez. El calendario es dato; no hay un cron por usuario.
 *   Idempotente: cada fase se reclama con un índice único dentro de la misma transacción que sus efectos, así repetir el
 *   tick, o correr dos a la vez, no duplica decisiones, solicitudes ni pagos; si la fase falla, la transacción revierte y
 *   la fase queda libre para el siguiente tick.
 * Runs in: servidor (ruta del cron y acciones de la demo) y pruebas.
 * Receives → Returns: { runtime, organización, now (instante UTC) } → TickReport.
 * Talks to: schedule (fechas y fases), runner (preparar, avisar, ejecutar), store.
 * Alcance: solo nóminas con la fuente del fixture. Otros tipos quedan como `unsupported` hasta tener su ejecutor.
 */
import { addDays, dueDatesInMonth, duePhases, phasesFor, type IsHoliday, type ScheduledDue } from "./schedule/dates";
import { isColombiaHolidayFixture } from "./schedule/holidays";
import { alertOccurrence, executeOccurrence, prepareOccurrence, type LearnedProvider, type PayrollFactsOpener, type RunDeps } from "./runner";
import type { Phase, StoreRuntime, StoredObligation } from "./store";

export type TickOutcome = "ran" | "skipped" | "failed" | "unsupported";

export type TickEntry = {
  obligationId: string;
  periodStart: string;
  dueDate: string;
  phase: Phase | null;
  outcome: TickOutcome;
  detail: string | null;
};

export type TickReport = { organizationId: string; now: string; entries: TickEntry[] };

/** Fecha de calendario en Bogotá (UTC-5, sin horario de verano) de un instante UTC. */
export const bogotaDay = (utc: string) => new Date(Date.parse(utc) - 5 * 3_600_000).toISOString().slice(0, 10);

const monthOf = (date: string) => date.slice(0, 7);
const shiftMonth = (month: string, delta: number) => {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, m - 1 + delta, 1)).toISOString().slice(0, 7);
};

/**
 * Días después del vencimiento en que el tick todavía recupera una fase que no corrió (un cron caído un par de días). Pasado
 * ese margen un periodo no se retoma solo: pagar con semanas de retraso es una decisión de una persona, no del cron.
 */
export const CATCH_UP_DAYS = 7;

/** Las ocurrencias cercanas a `today` que el calendario de la obligación genera, sin las anteriores a su activación. */
export function nearbyDues(obligation: StoredObligation, today: string, isHoliday: IsHoliday): ScheduledDue[] {
  const activatedDay = obligation.activatedAt ? bogotaDay(obligation.activatedAt) : null;
  const month = monthOf(today);
  return [shiftMonth(month, -1), month, shiftMonth(month, 1)]
    .flatMap((m) => dueDatesInMonth(obligation.settings.schedule, m, isHoliday))
    .filter((due) => due.dueDate >= addDays(today, -CATCH_UP_DAYS) && (activatedDay === null || due.dueDate >= activatedDay));
}

export type TickInput = {
  runtime: StoreRuntime;
  organizationId: string;
  /** Instante lógico del tick: el reloj de demo o el del sistema. */
  now: string;
  openFacts: PayrollFactsOpener;
  learned?: LearnedProvider;
  isHoliday?: IsHoliday;
};

export async function runTick(input: TickInput): Promise<TickReport> {
  const { runtime, organizationId, now } = input;
  const isHoliday = input.isHoliday ?? isColombiaHolidayFixture;
  const today = bogotaDay(now);
  const entries: TickEntry[] = [];

  for (const obligation of await runtime.store.latestActive(organizationId)) {
    if (obligation.kind !== "payroll") {
      entries.push({ obligationId: obligation.obligationId, periodStart: "", dueDate: "", phase: null, outcome: "unsupported", detail: `Tipo ${obligation.kind} sin ejecutor todavía` });
      continue;
    }
    const slots = nearbyDues(obligation, today, isHoliday)
      .flatMap((due) =>
        duePhases(
          phasesFor(due.dueDate, { leadDays: obligation.settings.schedule.leadDays, earlyAlertDays: obligation.template.earlyAlertDays, urgentAlertDays: obligation.template.urgentAlertDays }, isHoliday),
          now,
        ).map((slot) => ({ due, slot })),
      )
      .sort((a, b) => a.slot.instant.localeCompare(b.slot.instant));

    for (const { due, slot } of slots) {
      const base = { obligationId: obligation.obligationId, periodStart: due.periodStart, dueDate: due.dueDate, phase: slot.phase };
      try {
        const ran = await runtime.transaction(organizationId, async (store) => {
          const claimed = await store.claimPhase({ organizationId, obligationId: obligation.obligationId, periodStart: due.periodStart, phase: slot.phase, asOf: now });
          if (!claimed) return false;
          const deps: RunDeps = { store, openFacts: input.openFacts, learned: input.learned };
          if (slot.phase === "prepare") await prepareOccurrence(deps, obligation, due, now);
          else if (slot.phase === "execute") await executeOccurrence(deps, obligation, due, now);
          else await alertOccurrence(deps, obligation, due, now, slot.phase);
          return true;
        });
        entries.push({ ...base, outcome: ran ? "ran" : "skipped", detail: null });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Error desconocido";
        entries.push({ ...base, outcome: "failed", detail });
        // Fail-closed: la transacción revirtió, no se pagó nada y la fase queda libre; se deja rastro.
        await runtime.store
          .audit({ organizationId, entityType: "obligation", entityId: obligation.obligationId, eventType: "obligation_run.failed", actorId: null, payload: { phase: slot.phase, periodStart: due.periodStart, asOf: now, detail } })
          .catch(() => undefined);
      }
    }
  }
  return { organizationId, now, entries };
}
