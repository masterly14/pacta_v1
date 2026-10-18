/**
 * Backtest del aprendizaje histórico, en memoria y reproducible (semilla fija).
 *
 * Para cada ensayo (un mes de prueba + anomalías sembradas al azar) compara dos brazos con la MISMA historia visible:
 *   A) solo las reglas fijas (tolerancia de la plantilla), y
 *   B) reglas fijas + hallazgos aprendidos (que solo pueden escalar).
 * y mide, para historias de 0, 3, 6 y 12 meses: aprobaciones indebidas, detección, escalamientos falsos y automatización.
 *
 * La verdad de cada línea sale de lo que el ensayo SIEMBRA (`Injection`), nunca de las decisiones de las reglas ni de un
 * archivo del escenario. Este módulo es el único que conoce esa verdad; `profile.ts`, `assess.ts` y `compose.ts` no.
 * Los datos son sintéticos (12 empleados ficticios): demuestran el mecanismo, no significancia estadística.
 */
import { OBLIGATION_BASE, ROSTER } from "../fixtures/buk/builders";
import { buildMonth, monthRange, rng, addMonths, type Injection } from "../fixtures/buk/history";
import { LedgerEvidenceStore, replayLedger } from "../fixtures/buk/ledger";
import { MemoryBukTransport } from "../fixtures/buk/memory-transport";
import { oracleDecideOccurrence, type OracleDecision } from "../fixtures/buk/oracle-rules";
import { HISTORY_RESOLUTIONS } from "../fixtures/buk/resolutions";
import { loadObservations, type PayrollObservation } from "../sources/buk/observations";
import { BukPayrollReader, createBukObligationSource } from "../sources/buk/source";
import { assessLine } from "./assess";
import { composeDecision } from "./compose";
import { buildProfiles } from "./profile";

export const BACKTEST_SEED = 20261019;
export const HISTORY_LENGTHS = [0, 3, 6, 12] as const;
const WINDOW_FROM = "2025-01";
const WINDOW_TO = "2026-12";
const TEST_MONTHS = monthRange("2026-03", "2026-11");
const SEEDS_PER_MONTH = 13; // 9 meses × 13 = 117 ensayos

/** violation = la política (tolerancia) lo prohíbe aprobar; pattern = dentro de la política pero fuera de lo habitual; clean = legítimo. */
export type Truth = "clean" | "pattern_anomaly" | "policy_violation";
export type ArmId = "A" | "B";

export type ArmMetrics = {
  lines: number;
  clean: number;
  cleanApproved: number;
  falseEscalations: number;
  policyViolations: number;
  /** Violaciones de política que terminaron `approved`: debe ser 0. */
  improperApprovals: number;
  policyDetected: number;
  patternAnomalies: number;
  patternDetected: number;
};

export type BacktestRow = { historyMonths: number; arms: Record<ArmId, ArmMetrics> };

export type BacktestReport = {
  seed: number;
  trials: number;
  months: string[];
  historyLengths: number[];
  rows: BacktestRow[];
  /** Violaciones de política que las reglas fijas aprobaron (brazo A, primera longitud de historia). */
  fixedRuleMisses: { month: string; employeeId: number; kind: string; netMinor: number | null; lastConfirmedMinor: number | null }[];
  notes: string[];
};

const emptyMetrics = (): ArmMetrics => ({
  lines: 0, clean: 0, cleanApproved: 0, falseEscalations: 0, policyViolations: 0, improperApprovals: 0, policyDetected: 0, patternAnomalies: 0, patternDetected: 0,
});

/**
 * Anomalías sembradas posibles. `truth` es la intención de la siembra, independiente de las reglas. Para las que cambian el
 * monto (aumento fuera de ciclo, bonificación) la verdad final depende del efecto REAL sobre el neto de esa línea frente al
 * mes limpio (ver `effectTruth`), porque p. ej. un +15 % de salario puede subir el neto menos si cruza el tope del auxilio.
 */
type Seed = { injection: Injection; truth: Truth; kind: string };

/** Frente al mes limpio, ¿cuánto cambió el neto de la línea? >10 % viola la política, 1–10 % es un patrón raro, <1 % es indistinguible. */
export function effectTruth(injectedNetMinor: number, cleanNetMinor: number): Truth {
  const effectBps = Math.round((Math.abs(injectedNetMinor - cleanNetMinor) * 10_000) / cleanNetMinor);
  if (effectBps > OBLIGATION_BASE.varianceToleranceBps) return "policy_violation";
  return effectBps >= 100 ? "pattern_anomaly" : "clean";
}

function cleanNetMinor(month: string, employeeId: number): number {
  const settlement = buildMonth(month).payrollDetail.data.find((row) => row.employee_id === employeeId)!;
  const prima = settlement.lines_settlement.filter((line) => line.code === "prima_servicios").reduce((total, line) => total + Math.round(line.amount * 100), 0);
  return Math.round(settlement.liquid_reach * 100) - prima;
}

const AMOUNT_SEEDS = new Set(["bump_5", "bump_15", "bump_40", "bonus_small", "bonus_large"]);

function drawSeeds(month: string, key: string): Seed[] {
  const draw = rng(`${BACKTEST_SEED}:${key}:${month}`);
  const count = Math.floor(draw() * 4); // 0 a 3
  const pool = ROSTER.map((person) => person.id);
  const seeds: Seed[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const employeeId = pool.splice(Math.floor(draw() * pool.length), 1)[0]!;
    const wage = ROSTER.find((person) => person.id === employeeId)!.wage;
    const kinds: Seed[] = [
      { injection: { kind: "bump_pct", employeeId, bps: 500 }, truth: "pattern_anomaly", kind: "bump_5" },
      { injection: { kind: "bump_pct", employeeId, bps: 1500 }, truth: "policy_violation", kind: "bump_15" },
      { injection: { kind: "bump_pct", employeeId, bps: 4000 }, truth: "policy_violation", kind: "bump_40" },
      { injection: { kind: "unexpected_bonus", employeeId, amount: Math.round((wage * 0.04) / 1000) * 1000 }, truth: "pattern_anomaly", kind: "bonus_small" },
      { injection: { kind: "unexpected_bonus", employeeId, amount: Math.round((wage * 0.4) / 1000) * 1000 }, truth: "policy_violation", kind: "bonus_large" },
      { injection: { kind: "account_change", employeeId, to: { bank: "Nequi", account_type: "Ahorro", last4: "0042" } }, truth: "policy_violation", kind: "account_change" },
      { injection: { kind: "duplicate", employeeId }, truth: "policy_violation", kind: "duplicate" },
      { injection: { kind: "terminated_paid", employeeId }, truth: "policy_violation", kind: "terminated_paid" },
    ];
    seeds.push(kinds[Math.floor(draw() * kinds.length)]!);
  }
  return seeds;
}

type Ledgered = Awaited<ReturnType<typeof replayLedger>>["confirmed"];
const confirmedCache = new Map<string, Promise<Ledgered>>();
function confirmedBefore(month: string): Promise<Ledgered> {
  const previous = addMonths(month, -1);
  let cached = confirmedCache.get(previous);
  if (!cached) {
    cached = replayLedger({
      template: OBLIGATION_BASE,
      from: addMonths(WINDOW_FROM, 1),
      to: previous,
      resolutions: HISTORY_RESOLUTIONS.filter((resolution) => resolution.month <= previous),
    }).then((ledger) => ledger.confirmed);
    confirmedCache.set(previous, cached);
  }
  return cached;
}

async function cleanObservations(): Promise<PayrollObservation[]> {
  const months = monthRange(WINDOW_FROM, WINDOW_TO);
  const reader = new BukPayrollReader(new MemoryBukTransport(months), new LedgerEvidenceStore(WINDOW_TO, {}));
  return loadObservations(reader, months);
}

export async function runBacktest(options: { historyLengths?: readonly number[]; seedsPerMonth?: number; months?: readonly string[] } = {}): Promise<BacktestReport> {
  const lengths = options.historyLengths ?? HISTORY_LENGTHS;
  const seedsPerMonth = options.seedsPerMonth ?? SEEDS_PER_MONTH;
  const testMonths = options.months ?? TEST_MONTHS;
  const observations = await cleanObservations();
  const months = monthRange(WINDOW_FROM, WINDOW_TO);
  const rows: BacktestRow[] = lengths.map((historyMonths) => ({ historyMonths, arms: { A: emptyMetrics(), B: emptyMetrics() } }));
  let trials = 0;
  const fixedRuleMisses: BacktestReport["fixedRuleMisses"] = [];

  for (const month of testMonths) {
    const confirmed = await confirmedBefore(month);
    for (let k = 0; k < seedsPerMonth; k++) {
      trials++;
      const seeds = drawSeeds(month, String(k));
      const injections = seeds.map((seed) => seed.injection);
      const transport = new MemoryBukTransport(months, (m) => (m === month ? { injections } : {}));
      const store = new LedgerEvidenceStore(month, confirmed);
      const raw = await new BukPayrollReader(transport, store).load(month);
      const source = createBukObligationSource(raw, store, { organizationId: OBLIGATION_BASE.organizationId, currency: OBLIGATION_BASE.currency });
      const built = source.occurrence(OBLIGATION_BASE, `${raw.period.endDate}T14:00:00Z`);
      const base = oracleDecideOccurrence({ template: OBLIGATION_BASE, occurrence: built.occurrence, lines: built.lines, dataset: built.dataset });

      // Verdad por línea: lo sembrado. Para un duplicado, la anomalía es la segunda aparición.
      const truthOf = (index: number): { truth: Truth; kind: string | null } => {
        const line = built.lines[index]!;
        const employeeId = Number(line.counterpartyRef.replace("buk:employee:", ""));
        const seed = seeds.find((candidate) => candidate.injection.employeeId === employeeId);
        if (!seed || line.lineType !== "salary") return { truth: "clean", kind: null };
        if (seed.injection.kind === "duplicate") {
          const firstIndex = built.lines.findIndex((other) => other.counterpartyRef === line.counterpartyRef && other.lineType === "salary");
          return firstIndex === index ? { truth: "clean", kind: null } : { truth: seed.truth, kind: seed.kind };
        }
        if (AMOUNT_SEEDS.has(seed.kind) && line.amountMinor !== null) {
          const truth = effectTruth(line.amountMinor, cleanNetMinor(month, employeeId));
          return { truth, kind: truth === "clean" ? null : seed.kind };
        }
        return { truth: seed.truth, kind: seed.kind };
      };

      for (const row of rows) {
        const visible = observations.filter((observation) => observation.month < month && observation.month >= addMonths(month, -row.historyMonths));
        const profiles = buildProfiles(visible, { beforeMonth: month });
        for (const [index, line] of built.lines.entries()) {
          const decisionA: OracleDecision = base.lines[index]!.decision;
          const learned = assessLine(profiles.get(line.counterpartyRef), line, { month });
          const decisionB = composeDecision(decisionA, learned);
          const { truth } = truthOf(index);
          for (const [arm, decision] of [["A", decisionA], ["B", decisionB]] as const) {
            const metrics = row.arms[arm];
            metrics.lines++;
            if (truth === "clean") {
              metrics.clean++;
              if (decision === "approved") metrics.cleanApproved++;
              else metrics.falseEscalations++;
            } else if (truth === "policy_violation") {
              metrics.policyViolations++;
              if (decision === "approved") {
                metrics.improperApprovals++;
                if (arm === "A" && row === rows[0]) {
                  fixedRuleMisses.push({
                    month,
                    employeeId: Number(line.counterpartyRef.replace("buk:employee:", "")),
                    kind: truthOf(index).kind ?? "?",
                    netMinor: line.amountMinor,
                    lastConfirmedMinor: line.lastConfirmedAmountMinor,
                  });
                }
              }
              else metrics.policyDetected++;
            } else {
              metrics.patternAnomalies++;
              if (decision !== "approved") metrics.patternDetected++;
            }
          }
        }
      }
    }
  }

  return {
    seed: BACKTEST_SEED,
    trials,
    months: [...testMonths],
    historyLengths: [...lengths],
    rows,
    fixedRuleMisses,
    notes: [
      "Datos sintéticos de 12 empleados ficticios: demuestra el mecanismo, no significancia estadística.",
      "La verdad de cada línea es lo que el ensayo siembra, no lo que deciden las reglas.",
      "El brazo B solo puede escalar: sube la carga de revisión. La mejora de autonomía depende de autorizaciones aceptadas por una persona (F4).",
    ],
  };
}

/** Razón en puntos básicos (entero); 0 si el denominador es 0. */
export const bps = (numerator: number, denominator: number) => (denominator === 0 ? 0 : Math.round((numerator * 10_000) / denominator));
