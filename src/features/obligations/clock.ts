/**
 * Purpose: reloj de las obligaciones. En producción rige el reloj del sistema; en la demo (PACTA_SHOW_DEV_TOOLS=true) cada
 *   organización puede tener un reloj propio guardado en la BD, que se «avanza» ejecutando el tick de cada día intermedio
 *   a las 09:00 de Bogotá, en orden. Repetir un avance no duplica nada (las fases ya reclamadas se saltan).
 * Runs in: servidor y pruebas.
 * Receives → Returns: almacén/runtime + fechas → instante actual o los informes de los ticks ejecutados.
 */
import { addDays } from "./schedule/dates";
import { runTick, bogotaDay, type TickInput, type TickReport } from "./tick";
import type { ObligationStore } from "./store";

/** Instante de los ticks de demo: 09:00 en Bogotá. */
export const demoInstantOf = (date: string) => `${date}T14:00:00Z`;

export type ClockReading = { now: string; mode: "demo" | "system" };

/** El reloj vigente: el de demo solo si las herramientas de prueba están activas y hay uno guardado. */
export async function readClock(store: ObligationStore, organizationId: string, options: { demoEnabled: boolean; systemNow?: () => Date }): Promise<ClockReading> {
  if (options.demoEnabled) {
    const stored = await store.getDemoClock(organizationId);
    if (stored) return { now: stored, mode: "demo" };
  }
  return { now: (options.systemNow ? options.systemNow() : new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"), mode: "system" };
}

/** Fija el reloj de demo en una fecha (09:00 Bogotá) SIN ejecutar ticks: punto de partida explícito. */
export async function setDemoClockDate(store: ObligationStore, organizationId: string, date: string, by: string) {
  const now = demoInstantOf(date);
  await store.setDemoClock(organizationId, now, by);
  await store.audit({ organizationId, entityType: "demo_clock", entityId: organizationId, eventType: "demo_clock.set", actorId: by, payload: { now } });
  return now;
}

export const MAX_ADVANCE_DAYS = 400;

/**
 * Avanza el reloj de demo hasta `to` (inclusive) ejecutando el tick de cada día, en orden. Persiste el reloj día a día, de
 * modo que un fallo deja el avance hasta donde llegó. Nunca retrocede.
 */
export async function advanceDemoClock(
  input: Omit<TickInput, "now"> & { to: string; by: string; start: ClockReading },
): Promise<{ reports: TickReport[]; clock: string }> {
  const { runtime, organizationId } = input;
  const from = bogotaDay(input.start.now);
  if (input.to <= from) throw new Error(`El reloj solo avanza: hoy es ${from} y se pidió ${input.to}.`);
  const days: string[] = [];
  for (let day = addDays(from, 1); day <= input.to; day = addDays(day, 1)) {
    days.push(day);
    if (days.length > MAX_ADVANCE_DAYS) throw new Error(`No se avanza más de ${MAX_ADVANCE_DAYS} días de una vez.`);
  }
  const reports: TickReport[] = [];
  let clock = input.start.now;
  for (const day of days) {
    const now = demoInstantOf(day);
    reports.push(await runTick({ ...input, now }));
    await runtime.store.setDemoClock(organizationId, now, input.by);
    clock = now;
  }
  await runtime.store.audit({ organizationId, entityType: "demo_clock", entityId: organizationId, eventType: "demo_clock.advanced", actorId: input.by, payload: { from, to: input.to, days: days.length } });
  return { reports, clock };
}
