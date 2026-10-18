/**
 * Perfiles, evaluación de líneas y composición con las reglas fijas. Casos construidos a mano: no dependen del backtest.
 */
import { describe, expect, it } from "vitest";
import { ObligationContextSchema, type ObligationContext } from "@/shared/schemas/obligation-context";
import { rng, monthRange } from "../fixtures/buk/history";
import { LedgerEvidenceStore } from "../fixtures/buk/ledger";
import { MemoryBukTransport } from "../fixtures/buk/memory-transport";
import type { OracleDecision } from "../fixtures/buk/oracle-rules";
import { loadObservations, observationsFromBundle, type PayrollObservation } from "../sources/buk/observations";
import { BukPayrollReader } from "../sources/buk/source";
import { assessLine } from "./assess";
import { composeDecision, composeReasons, isAtLeastAsCautious } from "./compose";
import { MIN_OBSERVATIONS, SCALE_FLOOR_BPS } from "./config";
import { buildProfiles, mad, median, monthsBetween } from "./profile";
import type { LearnedFinding } from "./types";

const REF = "buk:employee:1010";
const observation = (month: string, netMinor: number, extra: Partial<PayrollObservation> = {}): PayrollObservation => ({
  month,
  counterpartyRef: REF,
  netMinor,
  beneficiaryReference: "****1234",
  concepts: {},
  status: "active",
  ...extra,
});
const series = (from: string, count: number, net: number, extra: (month: string, index: number) => Partial<PayrollObservation> = () => ({})) =>
  monthRange(from, `${from.slice(0, 4)}-12`).slice(0, count).map((month, index) => observation(month, net, extra(month, index)));

const line = (netMinor: number | null, components: { code: string; amountMinor: number }[] = [], lineType: ObligationContext["lineType"] = "salary"): ObligationContext =>
  ObligationContextSchema.parse({
    schemaVersion: 1,
    lineId: "occ:line",
    occurrenceId: "occ",
    obligationId: "obl",
    obligationVersion: 1,
    organizationId: "org",
    kind: "payroll",
    asOf: "2026-12-31T14:00:00Z",
    periodStart: "2026-12-01",
    periodEnd: "2026-12-31",
    dueDate: "2026-12-31",
    counterpartyRef: REF,
    displayName: "Persona Ficticia",
    beneficiaryAccountReference: "****1234",
    lastConfirmedBeneficiaryReference: "****1234",
    lineType,
    amountMinor: netMinor,
    currency: netMinor === null ? null : "COP",
    components: netMinor === null ? [] : components.length ? components : [{ code: "net_pay", amountMinor: netMinor }],
    lastConfirmedAmountMinor: netMinor === null ? null : 700_000_000,
    evidence: [],
    signals: [],
    missingFields: netMinor === null ? ["amountMinor", "currency", "lastConfirmedAmountMinor"] : [],
    warnings: [],
  });

describe("estadística entera", () => {
  it("mediana y MAD", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3); // (2+3)/2 = 2,5 redondea a 3
    expect(mad([10, 12, 14, 100], 13)).toBe(2);
    expect(() => median([])).toThrow();
    expect(monthsBetween("2026-03", "2026-12")).toBe(9);
  });
});

describe("perfiles", () => {
  const history = series("2026-01", 6, 700_000_000);

  it("solo usa meses anteriores al evaluado (no mira el futuro ni el propio mes)", () => {
    const withFuture = [...history, observation("2026-07", 900_000_000), observation("2026-08", 900_000_000)];
    const profile = buildProfiles(withFuture, { beforeMonth: "2026-07" }).get(REF)!;
    expect(profile.n).toBe(6);
    expect(profile.baselineMinor).toBe(700_000_000);
    expect(profile.lastMonth).toBe("2026-06");
  });

  it("un salario fijo tiene escala igual al piso (nunca cero)", () => {
    const profile = buildProfiles(history, { beforeMonth: "2026-07" }).get(REF)!;
    expect(profile.scaleMinor).toBe((700_000_000 * SCALE_FLOOR_BPS) / 10_000);
  });

  it("una variación natural amplia ensancha la escala", () => {
    const noisy = series("2026-01", 6, 0).map((o, i) => ({ ...o, netMinor: [300_000_000, 318_000_000, 291_000_000, 322_000_000, 297_000_000, 312_000_000][i]! }));
    const fixed = buildProfiles(history, { beforeMonth: "2026-07" }).get(REF)!;
    const variable = buildProfiles(noisy, { beforeMonth: "2026-07" }).get(REF)!;
    expect(variable.scaleMinor / variable.baselineMinor).toBeGreaterThan(fixed.scaleMinor / fixed.baselineMinor);
  });

  it("detecta una cadencia trimestral estable y un cambio de cuenta", () => {
    const obs = series("2026-01", 12, 600_000_000, (month, i) => ({
      concepts: ["2026-03", "2026-06", "2026-09", "2026-12"].includes(month) ? { bonificacion: 230_000_000 } : {},
      beneficiaryReference: i >= 5 ? "****9999" : "****1234",
    }));
    const profile = buildProfiles(obs, { beforeMonth: "2027-01" }).get(REF)!;
    const bonus = profile.concepts.find((concept) => concept.code === "bonificacion")!;
    expect(bonus.cadenceMonths).toBe(3);
    expect(bonus.occurrences).toBe(4);
    expect(bonus.maxMinor).toBe(230_000_000);
    expect(profile.accountChanges).toEqual([{ month: "2026-06", from: "****1234", to: "****9999" }]);
  });

  it("un concepto irregular no tiene cadencia", () => {
    const obs = series("2026-01", 10, 600_000_000, (month) => ({ concepts: ["2026-02", "2026-03", "2026-09"].includes(month) ? { recargos: 10_000_000 } : {} }));
    expect(buildProfiles(obs, { beforeMonth: "2027-01" }).get(REF)!.concepts[0]!.cadenceMonths).toBeNull();
  });

  it("un cambio de nivel persistente (dos meses coherentes) mueve la línea base", () => {
    const obs = [...series("2026-01", 6, 700_000_000), observation("2026-07", 763_000_000), observation("2026-08", 763_000_000)];
    const profile = buildProfiles(obs, { beforeMonth: "2026-09" }).get(REF)!;
    expect(profile.levelShiftFrom).toBe("2026-07");
    expect(profile.baselineMinor).toBe(763_000_000);
    expect(assessLine(profile, line(763_000_000), { month: "2026-09" })).toEqual([]);
  });

  it("un solo mes distinto no mueve la línea base", () => {
    const obs = [...series("2026-01", 6, 700_000_000), observation("2026-07", 763_000_000)];
    const profile = buildProfiles(obs, { beforeMonth: "2026-08" }).get(REF)!;
    expect(profile.levelShiftFrom).toBeNull();
    expect(profile.baselineMinor).toBe(700_000_000);
  });
});

describe("evaluación de una línea", () => {
  const profile = buildProfiles(series("2026-01", 6, 700_000_000), { beforeMonth: "2026-07" }).get(REF)!;

  it("un +5 % sobre un salario fijo se marca aunque esté dentro de la tolerancia del 10 %", () => {
    const findings = assessLine(profile, line(735_000_000), { month: "2026-07" });
    expect(findings.map((finding) => finding.ruleId)).toEqual(["patron_historico"]);
    expect(findings[0]!.reasonCode).toBe("VARIANCE_EXCEEDED");
  });

  it("una variación del 2 % no se marca", () => {
    expect(assessLine(profile, line(714_000_000), { month: "2026-07" })).toEqual([]);
  });

  it("también se marca una caída anormal", () => {
    expect(assessLine(profile, line(640_000_000), { month: "2026-07" }).map((finding) => finding.ruleId)).toEqual(["patron_historico"]);
  });

  it(`con menos de ${MIN_OBSERVATIONS} observaciones no hay hallazgo (rige la regla fija)`, () => {
    const short = buildProfiles(series("2026-01", MIN_OBSERVATIONS - 1, 700_000_000), { beforeMonth: "2026-07" }).get(REF);
    expect(assessLine(short, line(900_000_000), { month: "2026-07" })).toEqual([]);
    expect(assessLine(undefined, line(900_000_000), { month: "2026-07" })).toEqual([]);
  });

  it("solo evalúa líneas de salario con importe", () => {
    expect(assessLine(profile, line(900_000_000, [], "bonus"), { month: "2026-07" })).toEqual([]);
    expect(assessLine(profile, line(null), { month: "2026-07" })).toEqual([]);
  });

  it("un concepto que nunca había aparecido es inesperado", () => {
    const findings = assessLine(profile, line(700_000_000, [{ code: "net_base", amountMinor: 650_000_000 }, { code: "bonificacion", amountMinor: 50_000_000 }]), { month: "2026-07" });
    expect(findings.map((finding) => finding.ruleId)).toContain("concepto_inesperado");
  });

  it("un concepto trimestral fuera de su cadencia es inesperado y dentro de ella no lo es", () => {
    const obs = series("2026-01", 8, 600_000_000, (month) => ({ concepts: ["2026-03", "2026-06"].includes(month) ? { bonificacion: 230_000_000 } : {} }));
    const p = buildProfiles(obs, { beforeMonth: "2026-09" }).get(REF)!;
    const bonus = (net: number) => line(net, [{ code: "net_base", amountMinor: 600_000_000 }, { code: "bonificacion", amountMinor: net - 600_000_000 }]);
    expect(assessLine(p, bonus(830_000_000), { month: "2026-08" }).map((finding) => finding.ruleId)).toContain("concepto_inesperado");
    expect(assessLine(p, bonus(830_000_000), { month: "2026-09" }).map((finding) => finding.ruleId)).not.toContain("concepto_inesperado");
  });

  it("si toca un concepto trimestral y no viene, lo señala", () => {
    const obs = series("2026-01", 8, 600_000_000, (month) => ({ concepts: ["2026-03", "2026-06"].includes(month) ? { bonificacion: 230_000_000 } : {} }));
    const p = buildProfiles(obs, { beforeMonth: "2026-09" }).get(REF)!;
    expect(assessLine(p, line(600_000_000), { month: "2026-09" }).map((finding) => finding.ruleId)).toContain("concepto_recurrente_ausente");
  });

  it("todo hallazgo reutiliza un código que escala; ninguno es un permiso", () => {
    const all = assessLine(profile, line(900_000_000, [{ code: "net_base", amountMinor: 700_000_000 }, { code: "recargos", amountMinor: 200_000_000 }]), { month: "2026-07" });
    expect(all.length).toBeGreaterThan(0);
    for (const finding of all) expect(["VARIANCE_EXCEEDED", "BENEFIT_MISMATCH"]).toContain(finding.reasonCode);
  });
});

describe("composición con las reglas fijas", () => {
  const finding: LearnedFinding = { ruleId: "patron_historico", reasonCode: "VARIANCE_EXCEEDED", explanation: "x", detail: {} };
  const decisions: OracleDecision[] = ["approved", "requires_approval", "blocked"];

  it("lo aprendido solo escala: aprobada pasa a requiere_aprobacion; lo demás no cambia", () => {
    expect(composeDecision("approved", [finding])).toBe("requires_approval");
    expect(composeDecision("approved", [])).toBe("approved");
    expect(composeDecision("requires_approval", [finding])).toBe("requires_approval");
    expect(composeDecision("blocked", [finding])).toBe("blocked");
  });

  it("propiedad: el resultado nunca es más permisivo que la decisión base (1000 casos sembrados)", () => {
    const draw = rng("compose-property");
    for (let i = 0; i < 1000; i++) {
      const base = decisions[Math.floor(draw() * 3)]!;
      const learned = draw() < 0.5 ? [] : [finding];
      expect(isAtLeastAsCautious(composeDecision(base, learned), base)).toBe(true);
    }
  });

  it("agrega el motivo sin duplicarlo", () => {
    expect(composeReasons(["VARIANCE_EXCEEDED"], [finding])).toEqual(["VARIANCE_EXCEEDED"]);
    expect(composeReasons([], [finding])).toEqual(["VARIANCE_EXCEEDED"]);
  });
});

describe("observaciones desde Buk", () => {
  it("una por empleado y mes, con el neto de la línea de salario (sin prima) y los conceptos rastreados", async () => {
    const months = monthRange("2026-02", "2026-06");
    const reader = new BukPayrollReader(new MemoryBukTransport(months), new LedgerEvidenceStore("2026-06", {}));
    const march = observationsFromBundle(await reader.load("2026-03"));
    expect(march).toHaveLength(12);
    expect(march.find((o) => o.counterpartyRef === "buk:employee:1002")!.concepts.bonificacion).toBeGreaterThan(0);
    expect(march.find((o) => o.counterpartyRef === "buk:employee:1001")!.concepts).toEqual({});
    // junio trae prima: el neto observado no la incluye
    const june = observationsFromBundle(await reader.load("2026-06"));
    const raw = await reader.load("2026-06");
    const settlement = raw.payrollCurrent.find((row) => row.employee_id === 1001)!;
    const prima = settlement.lines_settlement.find((l) => l.code === "prima_servicios")!.amount;
    expect(june.find((o) => o.counterpartyRef === "buk:employee:1001")!.netMinor).toBe(Math.round((settlement.liquid_reach - prima) * 100));
    const all = await loadObservations(reader, months);
    expect(all).toHaveLength(12 * months.length);
    expect(all.map((o) => o.month)).toEqual([...all.map((o) => o.month)].sort());
  });
});
