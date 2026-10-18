/**
 * FIXTURE — Festivos de Colombia para el calendario de la demo.
 * ⚠ VERIFICAR contra la fuente oficial antes de la demo: son datos de fixture escritos a mano, no una fuente autorizada.
 * El cálculo de fechas recibe una función `IsHoliday`; esta lista es solo una implementación para el entorno de demo.
 */
import type { IsHoliday } from "./dates";

export const CO_HOLIDAYS_FIXTURE: Readonly<Record<string, readonly string[]>> = {
  "2026": [
    "2026-01-01", "2026-01-12", "2026-03-23", "2026-04-02", "2026-04-03", "2026-05-01", "2026-05-18", "2026-06-08", "2026-06-15",
    "2026-06-29", "2026-07-20", "2026-08-07", "2026-08-17", "2026-10-12", "2026-11-02", "2026-11-16", "2026-12-08", "2026-12-25",
  ],
};

/** Festivo según el fixture. Fuera de los años cargados no hay festivos conocidos: solo se respetan los fines de semana. */
export const isColombiaHolidayFixture: IsHoliday = (date) => CO_HOLIDAYS_FIXTURE[date.slice(0, 4)]?.includes(date) ?? false;

/** Fábrica para pruebas y para festivos configurados por la organización. */
export const holidaysFrom = (dates: readonly string[]): IsHoliday => {
  const set = new Set(dates);
  return (date) => set.has(date);
};
