/**
 * FIXTURE / Pacta — Historia de nómina de "Andina Demo S.A.S." con la forma de la API de Buk.
 *
 * Una línea de tiempo DECLARATIVA de eventos de vida (aumentos, bonificación trimestral, pago variable, incapacidad, cambio
 * de cuenta) más un generador pseudoaleatorio con semilla fija producen cualquier mes como payloads de Buk. El mismo módulo
 * lo usan el generador de archivos (`generate.ts`) y el backtest en memoria. Los eventos son hechos legítimos de la
 * empresa ficticia: NO llevan etiqueta de anomalía. Las anomalías se agregan aparte con `Injection` y sus etiquetas viven
 * fuera del alcance del aprendiz (`expected/learning/`).
 *
 * Determinista: el mismo (mes, inyecciones) produce siempre los mismos bytes. Dinero simulado; todo ficticio.
 */
import { ROSTER, employeeJson, licenceJson, page, settlementJson, st } from "./builders";
import type { Bank, EmpState, Person, SettleOpts } from "./builders";

export const HISTORY_SEED = 20261018;

// ---------------------------------------------------------------------------
// Meses
// ---------------------------------------------------------------------------

export const lastDayOf = (month: string) => {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
};

export const addMonths = (month: string, delta: number) => {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, m - 1 + delta, 1)).toISOString().slice(0, 7);
};

/** Meses de `from` a `to`, ambos incluidos. */
export const monthRange = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
};

/** Índice absoluto del mes desde 2025-01 (para ids de liquidación estables). */
const monthNumber = (month: string) => {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return (year - 2025) * 12 + m;
};

// ---------------------------------------------------------------------------
// PRNG con semilla (mulberry32), independiente del orden de iteración
// ---------------------------------------------------------------------------

function hash32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Generador en [0, 1) determinado solo por (semilla, clave). */
export function rng(key: string, seed = HISTORY_SEED): () => number {
  let a = (hash32(key) ^ seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1000 = (value: number) => Math.round(value / 1000) * 1000;

// ---------------------------------------------------------------------------
// Línea de tiempo de eventos de vida
// ---------------------------------------------------------------------------

export type LifeEvent =
  /** Aumento de salario a partir de `from`, en puntos básicos sobre el salario vigente. */
  | { kind: "raise"; employeeId: number; from: string; bps: number }
  /** Bonificación en meses concretos; el monto varía ±`jitterBps` alrededor de `baseAmount`. */
  | { kind: "bonus"; employeeId: number; months: string[]; baseAmount: number; jitterBps: number }
  /** Recargos mensuales de 0 a `maxBps` del salario. */
  | { kind: "variable_pay"; employeeId: number; maxBps: number }
  /** Incapacidad con su registro en /absences/licence. */
  | { kind: "incapacity"; employeeId: number; month: string; startDay: number; days: number }
  /** Cambio de cuenta confirmado y legítimo a partir de `from`. */
  | { kind: "account_change"; employeeId: number; from: string; to: Bank };

export const TIMELINE: readonly LifeEvent[] = [
  { kind: "raise", employeeId: 1010, from: "2026-01", bps: 900 },
  { kind: "raise", employeeId: 1007, from: "2026-04", bps: 600 },
  { kind: "bonus", employeeId: 1002, months: ["2026-03", "2026-06", "2026-09", "2026-12"], baseAmount: 2_300_000, jitterBps: 1000 },
  { kind: "variable_pay", employeeId: 1006, maxBps: 800 },
  { kind: "variable_pay", employeeId: 1012, maxBps: 600 },
  { kind: "incapacity", employeeId: 1004, month: "2026-05", startDay: 6, days: 8 },
  { kind: "account_change", employeeId: 1005, from: "2026-02", to: { bank: "Banco Davivienda", account_type: "Ahorro", last4: "5560" } },
];

/** Meses en que toca prima de servicios (calendario de beneficios del escenario). */
export const PRIMA_MONTHS = ["06", "12"] as const;

// ---------------------------------------------------------------------------
// Estado de cada persona en un mes
// ---------------------------------------------------------------------------

/** Salario vigente en `month` aplicando los aumentos de la línea de tiempo (redondeado a miles de pesos). */
export function wageAt(person: Person, month: string, timeline: readonly LifeEvent[] = TIMELINE): number {
  let wage = person.wage;
  for (const event of timeline) {
    if (event.kind === "raise" && event.employeeId === person.id && event.from <= month) wage = round1000((wage * (10_000 + event.bps)) / 10_000);
  }
  return wage;
}

export function bankAt(person: Person, month: string, timeline: readonly LifeEvent[] = TIMELINE): Bank {
  let bank = person.bankInfo;
  for (const event of timeline) {
    if (event.kind === "account_change" && event.employeeId === person.id && event.from <= month) bank = event.to;
  }
  return bank;
}

export function bonusAt(person: Person, month: string, timeline: readonly LifeEvent[] = TIMELINE): number {
  let total = 0;
  for (const event of timeline) {
    if (event.kind === "bonus" && event.employeeId === person.id && event.months.includes(month)) {
      const jitter = Math.round((rng(`${person.id}:${month}:bonus`)() * 2 - 1) * event.jitterBps);
      total += round1000((event.baseAmount * (10_000 + jitter)) / 10_000);
    }
  }
  return total;
}

export function variablePayAt(person: Person, month: string, wage: number, timeline: readonly LifeEvent[] = TIMELINE): number {
  let total = 0;
  for (const event of timeline) {
    if (event.kind === "variable_pay" && event.employeeId === person.id) {
      const bps = Math.floor(rng(`${person.id}:${month}:var`)() * (event.maxBps + 1));
      total += round1000((wage * bps) / 10_000);
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Inyecciones: anomalías que se agregan a un mes limpio
// ---------------------------------------------------------------------------

export type Injection =
  /** Sube el salario del mes `bps` puntos básicos (aumento fuera de ciclo). */
  | { kind: "bump_pct"; employeeId: number; bps: number }
  /** Multiplica por `x100 / 100` la bonificación esperada de la persona (o su monto base si ese mes no toca). */
  | { kind: "bonus_multiple"; employeeId: number; x100: number }
  /** Bonificación de `amount` COP a alguien que no la recibe. */
  | { kind: "unexpected_bonus"; employeeId: number; amount: number }
  | { kind: "account_change"; employeeId: number; to: Bank }
  /** Quita la liquidación de un empleado activo. */
  | { kind: "omit"; employeeId: number }
  /** Repite la liquidación (otro liquidacion_id, mismo mes y monto). */
  | { kind: "duplicate"; employeeId: number }
  /** Liquida con línea ordinaria a alguien que Buk ya reporta retirado. */
  | { kind: "terminated_paid"; employeeId: number };

export type MonthOptions = { injections?: readonly Injection[]; timeline?: readonly LifeEvent[] };

type EmployeeJson = ReturnType<typeof employeeJson>;
type SettlementJson = ReturnType<typeof settlementJson>;
type LicenceJson = ReturnType<typeof licenceJson>;

export type MonthPayloads = {
  month: string;
  employeesActive: ReturnType<typeof page<EmployeeJson>>;
  payrollDetail: ReturnType<typeof page<SettlementJson>>;
  licences: ReturnType<typeof page<LicenceJson>>;
  terminations: ReturnType<typeof page<never>>;
  /** Detalle de quien no está en /employees/active pero tiene liquidación (retirado). */
  employeeDetails: Record<number, EmployeeJson>;
};

const person = (id: number): Person => {
  const found = ROSTER.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Empleado ${id} fuera de la plantilla`);
  return found;
};

/** Payloads de Buk del mes `month`, con los eventos de vida y las inyecciones indicadas. */
export function buildMonth(month: string, options: MonthOptions = {}): MonthPayloads {
  const timeline = options.timeline ?? TIMELINE;
  const injections = options.injections ?? [];
  const injected = (employeeId: number) => injections.filter((injection) => injection.employeeId === employeeId);
  const isPrimaMonth = (PRIMA_MONTHS as readonly string[]).includes(month.slice(5));

  const active: EmpState[] = [];
  const detail: Record<number, ReturnType<typeof employeeJson>> = {};
  const settlements: ReturnType<typeof settlementJson>[] = [];
  const licences: ReturnType<typeof licenceJson>[] = [];

  for (const base of ROSTER) {
    const mine = injected(base.id);
    let wage = wageAt(base, month, timeline);
    let bank = bankAt(base, month, timeline);
    let bonus = bonusAt(base, month, timeline);
    for (const injection of mine) {
      if (injection.kind === "bump_pct") wage = round1000((wage * (10_000 + injection.bps)) / 10_000);
      if (injection.kind === "account_change") bank = injection.to;
      if (injection.kind === "unexpected_bonus") bonus += injection.amount;
      if (injection.kind === "bonus_multiple") {
        const event = timeline.find((e) => e.kind === "bonus" && e.employeeId === base.id);
        const reference = bonus > 0 ? bonus : event?.kind === "bonus" ? event.baseAmount : 0;
        bonus = round1000((reference * injection.x100) / 100);
      }
    }
    const current: Person = { ...base, wage, bankInfo: bank };
    const terminated = mine.some((injection) => injection.kind === "terminated_paid");
    const state = terminated
      ? st(current, { status: "inactivo", activeUntil: lastDayOf(addMonths(month, -1)), terminationReason: "renuncia", bankInfo: bank })
      : st(current, { bankInfo: bank });
    if (terminated) detail[base.id] = employeeJson(state);
    else active.push(state);

    const incapacity = timeline.find((e) => e.kind === "incapacity" && e.employeeId === base.id && e.month === month);
    const extras: NonNullable<SettleOpts["extras"]> = [];
    const variable = variablePayAt(base, month, wage, timeline);
    if (variable > 0) extras.push({ code: "recargos", name: "Recargos y horas extra", amount: variable });
    if (incapacity?.kind === "incapacity") {
      licences.push(licenceJson(base.id, 8000 + monthNumber(month), `${month}-${String(incapacity.startDay).padStart(2, "0")}`, incapacity.days));
    }

    if (mine.some((injection) => injection.kind === "omit")) continue;
    const liqId = 700000 + monthNumber(month) * 1000 + (base.id - 1000);
    const opts: Omit<SettleOpts, "liqId"> = {
      ...(bonus > 0 ? { bonus } : {}),
      ...(incapacity?.kind === "incapacity" ? { incapacityDays: incapacity.days } : {}),
      ...(extras.length ? { extras } : {}),
      prima: isPrimaMonth,
    };
    settlements.push(settlementJson(current, month, { ...opts, liqId }));
    if (mine.some((injection) => injection.kind === "duplicate")) settlements.push(settlementJson(current, month, { ...opts, liqId: liqId + 500 }));
  }

  return {
    month,
    employeesActive: page(active.map(employeeJson)),
    payrollDetail: page(settlements),
    licences: page(licences),
    terminations: page([]),
    employeeDetails: detail,
  };
}

export { person as rosterPerson };
