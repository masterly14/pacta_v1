/**
 * Purpose: cálculo puro de fechas de vencimiento y de las fases de una ocurrencia a partir del calendario.
 *   Todo son fechas de calendario `YYYY-MM-DD` (hora de Bogotá); los instantes UTC se derivan con `phaseInstant`.
 * Runs in: servidor, cliente (vista previa) y pruebas. Sin I/O ni reloj: la fecha de hoy la trae quien llama.
 * Receives → Returns: (Schedule, fechas, esFestivo) → vencimientos con periodo; (vencimiento, avisos) → fases ordenadas.
 */
import type { BusinessDayAdjust, Schedule } from "./calendar";

export type IsHoliday = (date: string) => boolean;

const parts = (date: string) => date.split("-").map(Number) as [number, number, number];
const toDate = (date: string) => {
  const [year, month, day] = parts(date);
  return new Date(Date.UTC(year, month - 1, day));
};
const fromDate = (value: Date) => value.toISOString().slice(0, 10);

export const addDays = (date: string, days: number) => fromDate(new Date(toDate(date).getTime() + days * 86_400_000));
export const lastDayOfMonth = (month: string) => {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return fromDate(new Date(Date.UTC(year, m, 0)));
};
const addMonthsTo = (month: string, delta: number) => {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, m - 1 + delta, 1)).toISOString().slice(0, 7);
};
const clampDay = (month: string, day: number) => {
  const last = Number(lastDayOfMonth(month).slice(8));
  return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
};

export const isWeekend = (date: string) => [0, 6].includes(toDate(date).getUTCDay());
export const isBusinessDay = (date: string, isHoliday: IsHoliday) => !isWeekend(date) && !isHoliday(date);

/** Mueve la fecha al día hábil anterior o siguiente según el ajuste. `none` la deja igual. */
export function adjustBusinessDay(date: string, mode: BusinessDayAdjust, isHoliday: IsHoliday): string {
  if (mode === "none") return date;
  const step = mode === "previous" ? -1 : 1;
  let current = date;
  for (let guard = 0; guard < 15 && !isBusinessDay(current, isHoliday); guard++) current = addDays(current, step);
  return current;
}

export type ScheduledDue = {
  /** Periodo que se paga (calendario). */
  periodStart: string;
  periodEnd: string;
  /** Vencimiento nominal según la regla, antes de ajustar por día hábil. */
  nominalDueDate: string;
  /** Vencimiento efectivo, ya ajustado. */
  dueDate: string;
};

/** Vencimientos que genera el calendario dentro de un mes (`YYYY-MM`), en orden. */
export function dueDatesInMonth(schedule: Schedule, month: string, isHoliday: IsHoliday): ScheduledDue[] {
  const first = `${month}-01`;
  const last = lastDayOfMonth(month);
  const build = (periodStart: string, periodEnd: string, nominal: string): ScheduledDue => ({
    periodStart,
    periodEnd,
    nominalDueDate: nominal,
    dueDate: adjustBusinessDay(nominal, schedule.businessDayAdjust, isHoliday),
  });
  switch (schedule.rule) {
    case "month_end":
      return [build(first, last, last)];
    case "day_of_month":
      return [build(first, last, clampDay(month, schedule.day))];
    case "semi_monthly": {
      const middle = clampDay(month, schedule.firstDay);
      return [build(first, middle, middle), build(addDays(middle, 1), last, last)];
    }
  }
}

/** Los próximos `count` vencimientos con `dueDate >= from`, en orden cronológico. */
export function computeDueDates(schedule: Schedule, from: string, count: number, isHoliday: IsHoliday): ScheduledDue[] {
  const out: ScheduledDue[] = [];
  let month = addMonthsTo(from.slice(0, 7), -1); // un ajuste hacia atrás podría traer a `from` un vencimiento del mes anterior
  for (let guard = 0; out.length < count && guard < count * 2 + 6; guard++) {
    for (const due of dueDatesInMonth(schedule, month, isHoliday)) {
      if (due.dueDate >= from && out.length < count) out.push(due);
    }
    month = addMonthsTo(month, 1);
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

export type SchedulePhase = "prepare" | "alert_early" | "alert_urgent" | "execute";

const PHASE_ORDER: Record<SchedulePhase, number> = { prepare: 0, alert_early: 1, alert_urgent: 2, execute: 3 };

export type PhaseSlot = { phase: SchedulePhase; date: string; instant: string };

/** 09:00 en Bogotá (UTC-5, sin horario de verano) de una fecha de calendario, como instante UTC. */
export const phaseInstant = (date: string) => `${date}T14:00:00Z`;

/**
 * Fases de una ocurrencia: preparar la corrida (T-lead, llevada al día hábil anterior para que haya quién la revise),
 * avisos temprano y urgente (T-early, T-urgent) y ejecución (T-0). Un aviso que cae antes de preparar no se emite: los avisos
 * hablan de una corrida ya preparada.
 */
export function phasesFor(
  dueDate: string,
  config: { leadDays: number; earlyAlertDays: number; urgentAlertDays: number },
  isHoliday: IsHoliday,
): PhaseSlot[] {
  const prepareDate = adjustBusinessDay(addDays(dueDate, -config.leadDays), "previous", isHoliday);
  const candidates: { phase: SchedulePhase; date: string }[] = [
    { phase: "prepare", date: prepareDate },
    { phase: "alert_early", date: addDays(dueDate, -config.earlyAlertDays) },
    { phase: "alert_urgent", date: addDays(dueDate, -config.urgentAlertDays) },
    { phase: "execute", date: dueDate },
  ];
  return candidates
    .filter((slot) => slot.phase === "prepare" || slot.date >= prepareDate)
    .map((slot) => ({ ...slot, instant: phaseInstant(slot.date) }))
    .sort((a, b) => a.date.localeCompare(b.date) || PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase]);
}

/** Fases ya vencidas en `nowInstant` (UTC). El orden de entrada se conserva. */
export const duePhases = (slots: readonly PhaseSlot[], nowInstant: string) => slots.filter((slot) => Date.parse(slot.instant) <= Date.parse(nowInstant));
