/**
 * Purpose: perfiles estadísticos por empleado a partir de observaciones históricas. Determinista, sin I/O ni IA,
 *   y solo con enteros (importes en unidades menores, razones en puntos básicos).
 * Runs in: servidor y pruebas.
 * Receives → Returns: (observaciones, { beforeMonth }) → Map<counterpartyRef, CounterpartyProfile>.
 * Un perfil es un dato derivado: describe qué es normal, no autoriza nada. Solo usa meses anteriores a `beforeMonth`.
 */
import type { PayrollObservation } from "../sources/buk/observations";
import { BASELINE_WINDOW, CADENCE_STABILITY_PCT, K_ROBUST, LEVEL_SHIFT_RUN, MAD_TO_SIGMA_X10000, SCALE_FLOOR_BPS } from "./config";
import type { ConceptProfile, CounterpartyProfile } from "./types";

export const monthIndex = (month: string) => {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return year * 12 + (m - 1);
};
export const monthsBetween = (from: string, to: string) => monthIndex(to) - monthIndex(from);

const sortedCopy = (values: readonly number[]) => [...values].sort((a, b) => a - b);

/** Mediana entera (promedio redondeado de los dos centrales cuando hay un número par). */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("mediana de una lista vacía");
  const sorted = sortedCopy(values);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Desviación absoluta mediana alrededor de `center`. */
export const mad = (values: readonly number[], center: number) => median(values.map((value) => Math.abs(value - center)));

const scaleOf = (values: readonly number[], baseline: number) =>
  Math.max(Math.round((mad(values, baseline) * MAD_TO_SIGMA_X10000) / 10_000), Math.round((baseline * SCALE_FLOOR_BPS) / 10_000));

function conceptProfile(code: string, observations: readonly PayrollObservation[]): ConceptProfile | null {
  const seen = observations.filter((observation) => (observation.concepts[code] ?? 0) > 0);
  if (seen.length === 0) return null;
  const months = seen.map((observation) => observation.month);
  const amounts = seen.map((observation) => observation.concepts[code]!);
  let cadenceMonths: number | null = null;
  if (months.length >= 2) {
    const gaps = months.slice(1).map((month, index) => monthsBetween(months[index]!, month));
    const counts = new Map<number, number>();
    for (const gap of gaps) counts.set(gap, (counts.get(gap) ?? 0) + 1);
    const [gap, count] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]!;
    if ((count * 100) / gaps.length >= CADENCE_STABILITY_PCT) cadenceMonths = gap;
  }
  return { code, months, occurrences: months.length, cadenceMonths, medianMinor: median(amounts), maxMinor: Math.max(...amounts), lastMonth: months.at(-1)! };
}

function profileOf(counterpartyRef: string, all: readonly PayrollObservation[]): CounterpartyProfile {
  const ordered = [...all].sort((a, b) => a.month.localeCompare(b.month));
  const window = ordered.slice(-BASELINE_WINDOW).map((observation) => observation.netMinor);
  let baselineMinor = median(window);
  let scaleMinor = scaleOf(window, baselineMinor);

  // Cambio de nivel persistente: las últimas observaciones se alejan de la línea base y coinciden entre sí.
  let levelShiftFrom: string | null = null;
  const run = ordered.slice(-LEVEL_SHIFT_RUN);
  if (ordered.length > LEVEL_SHIFT_RUN && run.length === LEVEL_SHIFT_RUN) {
    const earlier = ordered.slice(-BASELINE_WINDOW - LEVEL_SHIFT_RUN, -LEVEL_SHIFT_RUN).map((observation) => observation.netMinor);
    if (earlier.length > 0) {
      const before = median(earlier);
      const beforeScale = scaleOf(earlier, before);
      const values = run.map((observation) => observation.netMinor);
      const away = values.every((value) => Math.abs(value - before) > K_ROBUST * beforeScale);
      const sameSide = values.every((value) => Math.sign(value - before) === Math.sign(values[0]! - before));
      const consistent = Math.max(...values) - Math.min(...values) <= K_ROBUST * beforeScale;
      if (away && sameSide && consistent) {
        baselineMinor = median(values);
        scaleMinor = Math.max(beforeScale, scaleOf(values, baselineMinor));
        levelShiftFrom = run[0]!.month;
      }
    }
  }

  const codes = [...new Set(ordered.flatMap((observation) => Object.keys(observation.concepts)))].sort();
  const concepts = codes.flatMap((code) => {
    const profile = conceptProfile(code, ordered);
    return profile ? [profile] : [];
  });
  const accountChanges: CounterpartyProfile["accountChanges"] = [];
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i]!.beneficiaryReference !== ordered[i - 1]!.beneficiaryReference) {
      accountChanges.push({ month: ordered[i]!.month, from: ordered[i - 1]!.beneficiaryReference, to: ordered[i]!.beneficiaryReference });
    }
  }
  return { counterpartyRef, n: ordered.length, baselineMinor, scaleMinor, levelShiftFrom, concepts, accountChanges, lastMonth: ordered.at(-1)!.month };
}

export function buildProfiles(observations: readonly PayrollObservation[], options: { beforeMonth: string }): Map<string, CounterpartyProfile> {
  const byRef = new Map<string, PayrollObservation[]>();
  for (const observation of observations) {
    if (observation.month >= options.beforeMonth) continue; // nunca mira el mes evaluado ni el futuro
    const list = byRef.get(observation.counterpartyRef) ?? [];
    list.push(observation);
    byRef.set(observation.counterpartyRef, list);
  }
  return new Map([...byRef.entries()].map(([ref, list]) => [ref, profileOf(ref, list)]));
}
