/**
 * Uso: npm run learning:backtest [-- --json]
 * Corre el backtest reproducible del aprendizaje histórico e imprime la tabla (o el reporte JSON completo).
 */
import { BACKTEST_SEED, bps, runBacktest } from "./backtest";

const report = await runBacktest();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const pct = (value: number) => `${(value / 100).toFixed(1)} %`;
  console.log(`Backtest del aprendizaje histórico · semilla ${BACKTEST_SEED} · ${report.trials} ensayos (${report.months[0]} a ${report.months.at(-1)})`);
  console.log("A = reglas fijas · B = reglas fijas + hallazgos aprendidos (solo escalan)\n");
  console.log("historia  brazo  indebidas  violaciones  patrones detectados  falsos escalamientos  automatización");
  for (const row of report.rows) {
    for (const arm of ["A", "B"] as const) {
      const m = row.arms[arm];
      console.log(
        `${String(row.historyMonths).padStart(5)} m   ${arm}      ${String(m.improperApprovals).padStart(5)}     ${String(m.policyDetected).padStart(4)}/${String(m.policyViolations).padEnd(5)}   ${String(m.patternDetected).padStart(5)}/${String(m.patternAnomalies).padEnd(6)}     ${pct(bps(m.falseEscalations, m.clean)).padStart(8)}         ${pct(bps(m.cleanApproved, m.clean)).padStart(8)}`,
      );
    }
  }
  console.log(`\n${report.notes.join("\n")}`);
}
