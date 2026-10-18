/**
 * El motor de nómina contra el oráculo escrito a mano (`expected/*.json`) en todos los escenarios, y contra la
 * implementación independiente de las reglas (`oracle-rules.ts`) en cada ensayo del backtest.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_DIR, listScenarios, loadManifest } from "@/features/obligations/fixtures/buk/manifest";
import { oracleDecideOccurrence } from "@/features/obligations/fixtures/buk/oracle-rules";
import { openScenario } from "@/features/obligations/fixtures/buk/scenario";
import { decidePayrollRun, type PayrollRunResult } from "./payroll";

type ExpectedStage = {
  asOf: string;
  occurrenceStatus: string;
  counts: Record<string, number>;
  runFindings: { ruleId: string; code: string; effect: string; counterpartyRef: string | null }[];
  lines: { lineId: string; counterpartyRef: string; lineType: string; amountMinor: number | null; decision: string; reasons: string[] }[];
};

const fromEngine = (result: PayrollRunResult) => ({
  asOf: result.asOf,
  status: result.status,
  counts: result.counts,
  runFindings: result.runFindings.map((f) => `${f.ruleId}:${f.reasonCode}:${f.effect}:${f.counterpartyRef}`).sort(),
  lines: result.lines.map((l) => `${l.lineId}|${l.counterpartyRef}|${l.lineType}|${l.amountMinor}|${l.decision}|${[...l.reasonCodes].sort().join(",")}`),
});

const fromExpected = (stage: ExpectedStage) => ({
  asOf: stage.asOf,
  status: stage.occurrenceStatus,
  counts: stage.counts,
  runFindings: stage.runFindings.map((f) => `${f.ruleId}:${f.code}:${f.effect}:${f.counterpartyRef}`).sort(),
  lines: stage.lines.map((l) => `${l.lineId}|${l.counterpartyRef}|${l.lineType}|${l.amountMinor}|${l.decision}|${[...l.reasons].sort().join(",")}`),
});

describe("motor de nómina contra el oráculo escrito a mano", () => {
  for (const scenario of listScenarios()) {
    it(`${scenario}: cada evaluación coincide`, async () => {
      const opened = await openScenario(scenario);
      const expected = JSON.parse(readFileSync(join(EXPECTED_DIR, `${scenario}.json`), "utf8")) as { evaluations: ExpectedStage[] };
      const manifest = loadManifest(scenario);
      for (const [index, evaluation] of expected.evaluations.entries()) {
        const built = opened.source.occurrence(opened.template, manifest.evaluations[index]!.asOf);
        const result = decidePayrollRun({ template: opened.template, occurrence: built.occurrence, lines: built.lines, dataset: built.dataset });
        expect(fromEngine(result), `${scenario}#${index}`).toEqual(fromExpected(evaluation));
      }
    });
  }

  it("coincide con la implementación independiente de las reglas en todos los escenarios", async () => {
    for (const scenario of listScenarios()) {
      const opened = await openScenario(scenario);
      for (const evaluation of loadManifest(scenario).evaluations) {
        const built = opened.source.occurrence(opened.template, evaluation.asOf);
        const engine = decidePayrollRun({ template: opened.template, occurrence: built.occurrence, lines: built.lines, dataset: built.dataset });
        const oracle = oracleDecideOccurrence({ template: opened.template, occurrence: built.occurrence, lines: built.lines, dataset: built.dataset });
        expect(engine.status).toBe(oracle.occurrenceStatus);
        expect(engine.lines.map((l) => [l.lineId, l.decision, [...l.reasonCodes].sort()])).toEqual(oracle.lines.map((l) => [l.lineId, l.decision, [...l.reasons].sort()]));
      }
    }
  });
});

describe("explicabilidad y seguridad", () => {
  it("cada línea trae todas las reglas con una explicación; ninguna aprobada tiene reglas fallidas", async () => {
    const opened = await openScenario("nomina-anomalias");
    const built = opened.source.occurrence(opened.template, opened.manifest.evaluations[0]!.asOf);
    const result = decidePayrollRun({ template: opened.template, occurrence: built.occurrence, lines: built.lines, dataset: built.dataset });
    for (const line of result.lines) {
      expect(line.rules.map((r) => r.ruleId)).toEqual(
        expect.arrayContaining(["moneda_soportada", "datos_esenciales", "cuenta_estable", "variacion_aceptable", "obligacion_autorizada", "fondos_suficientes"]),
      );
      for (const rule of line.rules) expect(rule.explanation.length).toBeGreaterThan(5);
      if (line.decision === "approved") expect(line.rules.every((r) => r.result === "pass")).toBe(true);
      if (line.decision !== "approved") expect(line.reasonCodes.length).toBeGreaterThan(0);
    }
  });

  it("un hallazgo aprendido solo escala y no toca una línea bloqueada", async () => {
    const opened = await openScenario("nomina-limpia");
    const built = opened.source.occurrence(opened.template, opened.manifest.evaluations[0]!.asOf);
    const target = built.lines[0]!.lineId;
    const finding = { ruleId: "patron_historico" as const, reasonCode: "VARIANCE_EXCEEDED" as const, explanation: "desviación de prueba", detail: {} };
    const base = decidePayrollRun({ template: opened.template, occurrence: built.occurrence, lines: built.lines, dataset: built.dataset });
    const learned = decidePayrollRun({ template: opened.template, occurrence: built.occurrence, lines: built.lines, dataset: built.dataset, learned: new Map([[target, [finding]]]) });
    expect(base.counts.approved).toBe(12);
    expect(learned.lines.find((l) => l.lineId === target)!.decision).toBe("requires_approval");
    expect(learned.counts.approved).toBe(11);
    expect(learned.status).toBe("in_approval");
  });

  it("sin fondos conocidos no se aprueba nada", async () => {
    const opened = await openScenario("nomina-limpia");
    const built = opened.source.occurrence(opened.template, opened.manifest.evaluations[0]!.asOf);
    const unknownFunds = { ...built.occurrence, fundsAvailableMinor: null, fundsReservedMinor: null, missingFields: ["fundsAvailableMinor", "fundsReservedMinor"] as ("fundsAvailableMinor" | "fundsReservedMinor")[] };
    const result = decidePayrollRun({ template: opened.template, occurrence: unknownFunds, lines: built.lines, dataset: built.dataset });
    expect(result.counts.approved).toBe(0);
    expect(result.status).toBe("held");
  });
});
