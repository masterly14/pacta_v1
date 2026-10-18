/**
 * Prueba el motor de nómina contra los 12 escenarios de Buk: payloads → fuente de obligaciones →
 * decidePayrollRun, comparado con las expectativas escritas a mano en `fixtures/buk/expected/`.
 * Además cubre los casos trampa que ningún escenario fija solo: nada se aprueba sin pasar todas las reglas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPECTED_DIR, listScenarios, loadManifest } from "@/features/obligations/fixtures/buk/manifest";
import { openScenario } from "@/features/obligations/fixtures/buk/scenario";
import { decidePayrollRun, PAYROLL_LINE_RULE_IDS, type PayrollRunResult } from "./payroll";

type Expected = {
  evaluations: {
    stage: string;
    asOf: string;
    occurrenceStatus: string;
    counts: Record<string, number>;
    runFindings: { ruleId: string; code: string; effect: string; counterpartyRef: string | null }[];
    lines: { lineId: string; counterpartyRef: string; lineType: string; amountMinor: number | null; decision: string; reasons: string[] }[];
  }[];
};

const shapeOf = (r: PayrollRunResult) => ({
  asOf: r.asOf,
  occurrenceStatus: r.occurrenceStatus,
  counts: r.counts,
  runFindings: r.runFindings.map((f) => `${f.ruleId}:${f.reasonCode}:${f.effect}:${f.counterpartyRef}`),
  lines: r.lines.map((l) => `${l.lineId}|${l.counterpartyRef}|${l.lineType}|${l.amountMinor}|${l.decision}|${l.reasonCodes.join(",")}`),
});

const expectedShape = (e: Expected["evaluations"][number]) => ({
  asOf: e.asOf,
  occurrenceStatus: e.occurrenceStatus,
  counts: e.counts,
  runFindings: e.runFindings.map((f) => `${f.ruleId}:${f.code}:${f.effect}:${f.counterpartyRef}`),
  lines: e.lines.map((l) => `${l.lineId}|${l.counterpartyRef}|${l.lineType}|${l.amountMinor}|${l.decision}|${l.reasons.join(",")}`),
});

describe("decidePayrollRun contra los escenarios de Buk", () => {
  for (const scenario of listScenarios()) {
    it(`${scenario}: coincide con lo esperado en cada evaluación`, async () => {
      const manifest = loadManifest(scenario);
      const expected = JSON.parse(readFileSync(join(EXPECTED_DIR, `${scenario}.json`), "utf8")) as Expected;
      const opened = await openScenario(scenario);
      for (const [index, evaluation] of expected.evaluations.entries()) {
        const built = opened.source.occurrence(opened.template, manifest.evaluations[index]!.asOf);
        const result = decidePayrollRun({ template: opened.template, occurrence: built.occurrence, lines: built.lines, dataset: built.dataset });
        expect(shapeOf(result), `${scenario}/${evaluation.stage}`).toEqual(expectedShape(evaluation));
      }
    });
  }

  it("toda decisión lleva todas las reglas de línea evaluadas y es simulada", async () => {
    const opened = await openScenario("nomina-anomalias");
    const built = opened.source.occurrence(opened.template, loadManifest("nomina-anomalias").evaluations[0]!.asOf);
    const result = decidePayrollRun({ template: opened.template, occurrence: built.occurrence, lines: built.lines, dataset: built.dataset });
    for (const line of result.lines) {
      expect(line.isSimulated).toBe(true);
      expect(new Set(line.rulesEvaluated.map((r) => r.ruleId))).toEqual(new Set(PAYROLL_LINE_RULE_IDS));
      // Una línea aprobada no puede tener ninguna regla fallida.
      if (line.decision === "approved") expect(line.rulesEvaluated.every((r) => r.result === "pass")).toBe(true);
    }
  });

  it("una plantilla en borrador nunca aprueba: escala toda la corrida", async () => {
    const opened = await openScenario("nomina-limpia");
    const built = opened.source.occurrence(opened.template, loadManifest("nomina-limpia").evaluations[0]!.asOf);
    const draft = { ...opened.template, status: "draft" as const, activatedAt: null, activatedBy: null };
    const result = decidePayrollRun({ template: draft, occurrence: built.occurrence, lines: built.lines, dataset: built.dataset });
    expect(result.counts.approved).toBe(0);
    expect(result.runFindings.some((f) => f.reasonCode === "OBLIGATION_NOT_AUTHORIZED")).toBe(true);
  });
});
