/**
 * Purpose: calendar period math (UTC) for authorization usage and the monthly budget.
 * Runs in: anywhere (pure functions, no I/O, no clock).
 * Triggered by: load-facts.ts when computing approvalsInCurrentPeriod and budgetUsedMinor.
 * Receives → Returns: periodBounds(frequency, "YYYY-MM-DD") → { start, end } calendar dates
 *   (inclusive); monthBoundsUtc(instant) → { start, endExclusive } Date instants.
 * Talks to: nothing.
 */

export type AuthorizationFrequency = "weekly" | "monthly" | "quarterly" | "yearly";

const pad = (n: number) => String(n).padStart(2, "0");
const toCalendar = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const fromCalendar = (s: string) => new Date(`${s}T00:00:00.000Z`);

// Periodo calendario (UTC) que contiene la fecha. Semanas ISO: lunes a domingo.
export function periodBounds(frequency: AuthorizationFrequency, date: string): { start: string; end: string } {
  const d = fromCalendar(date);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();

  switch (frequency) {
    case "weekly": {
      const offset = (d.getUTCDay() + 6) % 7; // lunes = 0
      const start = new Date(Date.UTC(year, month, d.getUTCDate() - offset));
      const end = new Date(Date.UTC(year, month, d.getUTCDate() - offset + 6));
      return { start: toCalendar(start), end: toCalendar(end) };
    }
    case "monthly":
      return { start: toCalendar(new Date(Date.UTC(year, month, 1))), end: toCalendar(new Date(Date.UTC(year, month + 1, 0))) };
    case "quarterly": {
      const first = month - (month % 3);
      return { start: toCalendar(new Date(Date.UTC(year, first, 1))), end: toCalendar(new Date(Date.UTC(year, first + 3, 0))) };
    }
    case "yearly":
      return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
}

// Mes calendario UTC que contiene el instante (presupuesto mensual).
export function monthBoundsUtc(instant: string | Date): { start: Date; endExclusive: Date } {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return {
    start: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)),
    endExclusive: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)),
  };
}
