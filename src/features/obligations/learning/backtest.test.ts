/**
 * Backtest del aprendizaje: reglas fijas (A) contra reglas fijas + hallazgos aprendidos (B), con historia de 0, 3, 6 y 12 meses.
 * Las aserciones expresan lo que el diseño promete y lo que cuesta; los números salen del backtest, no se ajustan a mano.
 */
import { describe, expect, it } from "vitest";
import { BACKTEST_SEED, HISTORY_LENGTHS, bps, effectTruth, runBacktest, type BacktestReport } from "./backtest";

let report: BacktestReport;
const row = (months: number) => report.rows.find((candidate) => candidate.historyMonths === months)!;

describe("backtest del aprendizaje histórico", () => {
  it("es reproducible: dos corridas dan exactamente el mismo reporte", async () => {
    report = await runBacktest();
    expect(JSON.stringify(await runBacktest())).toBe(JSON.stringify(report));
    expect(report.seed).toBe(BACKTEST_SEED);
    expect(report.trials).toBe(117);
    expect(report.historyLengths).toEqual([...HISTORY_LENGTHS]);
  });

  it("cero aprobaciones indebidas en ambos brazos y con cualquier historia", () => {
    for (const r of report.rows) {
      expect(r.arms.A.improperApprovals, `A h=${r.historyMonths}`).toBe(0);
      expect(r.arms.B.improperApprovals, `B h=${r.historyMonths}`).toBe(0);
      expect(r.arms.A.policyViolations).toBeGreaterThan(50); // hay muestra suficiente de violaciones
    }
  });

  it("las reglas fijas no dependen de la historia: el brazo A es idéntico con cualquier longitud", () => {
    for (const r of report.rows) expect(r.arms.A).toEqual(row(0).arms.A);
  });

  it("sin historia el brazo B no cambia nada respecto de las reglas fijas", () => {
    expect(row(0).arms.B).toEqual(row(0).arms.A);
  });

  it("con historia, B detecta mucho más de lo que está dentro de la política pero fuera del patrón", () => {
    const a = row(3).arms.A;
    for (const months of [3, 6, 12]) {
      const b = row(months).arms.B;
      expect(b.patternAnomalies).toBe(a.patternAnomalies);
      expect(bps(b.patternDetected, b.patternAnomalies)).toBeGreaterThan(bps(a.patternDetected, a.patternAnomalies) + 5_000);
      expect(b.policyDetected).toBeGreaterThanOrEqual(a.policyDetected);
    }
  });

  it("la detección de patrones no empeora con más historia", () => {
    const detected = HISTORY_LENGTHS.map((months) => row(months).arms.B.patternDetected);
    for (let i = 1; i < detected.length; i++) expect(detected[i]!).toBeGreaterThanOrEqual(detected[i - 1]!);
  });

  it("el costo es explícito: B escala más líneas limpias, dentro de un presupuesto del 5 % de las limpias", () => {
    for (const months of [3, 6, 12]) {
      const a = row(months).arms.A;
      const b = row(months).arms.B;
      expect(b.falseEscalations).toBeGreaterThanOrEqual(a.falseEscalations);
      expect(bps(b.falseEscalations - a.falseEscalations, b.clean)).toBeLessThanOrEqual(500);
    }
  });

  it("la verdad se define por el efecto real sobre el neto, no por la intención de la siembra", () => {
    expect(effectTruth(110_000_000, 100_000_000)).toBe("pattern_anomaly"); // +10 % exacto: dentro de la tolerancia
    expect(effectTruth(111_000_000, 100_000_000)).toBe("policy_violation");
    expect(effectTruth(100_500_000, 100_000_000)).toBe("clean"); // menos de 1 %: indistinguible
    expect(effectTruth(95_000_000, 100_000_000)).toBe("pattern_anomaly");
  });
});
