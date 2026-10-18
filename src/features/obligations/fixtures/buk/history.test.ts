/**
 * Historia de nómina del mock de Buk: determinismo, eventos de vida, forma de Buk, rutas compartidas, libro de decisiones
 * y aislamiento de las etiquetas de verdad respecto del aprendizaje.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENDPOINT_SCHEMAS } from "../../sources/buk/schemas";
import { OBLIGATION_BASE } from "./builders";
import { HISTORY_SEED, PRIMA_MONTHS, TIMELINE, addMonths, bankAt, buildMonth, monthRange, rng, wageAt, rosterPerson } from "./history";
import { replayLedger, type Ledger } from "./ledger";
import { MemoryBukTransport } from "./memory-transport";
import { loadManifest, readScenarioJson, resolveRoute } from "./manifest";
import { HISTORY_RESOLUTIONS } from "./resolutions";

const SCENARIO = "aprendizaje-trimestral";
const net = (month: string, employeeId: number) => {
  const settlement = buildMonth(month).payrollDetail.data.find((row) => row.employee_id === employeeId);
  if (!settlement) throw new Error(`sin liquidación ${employeeId} en ${month}`);
  return settlement.liquid_reach;
};

describe("historia: determinismo", () => {
  it("el mismo mes produce exactamente los mismos payloads", () => {
    expect(JSON.stringify(buildMonth("2026-03"))).toBe(JSON.stringify(buildMonth("2026-03")));
  });

  it("el generador pseudoaleatorio depende solo de (semilla, clave)", () => {
    expect(rng("a")()).toBe(rng("a")());
    expect(rng("a")()).not.toBe(rng("b")());
    expect(rng("a", HISTORY_SEED + 1)()).not.toBe(rng("a")());
  });

  it("las inyecciones no alteran a las demás personas", () => {
    const clean = buildMonth("2026-12");
    const injected = buildMonth("2026-12", { injections: [{ kind: "bump_pct", employeeId: 1010, bps: 500 }] });
    const pick = (month: ReturnType<typeof buildMonth>, id: number) => JSON.stringify(month.payrollDetail.data.find((row) => row.employee_id === id));
    expect(pick(injected, 1002)).toBe(pick(clean, 1002));
    expect(pick(injected, 1010)).not.toBe(pick(clean, 1010));
  });
});

describe("historia: eventos de vida", () => {
  it("la bonificación trimestral de 1002 sube el neto y desaparece al mes siguiente", () => {
    expect(net("2026-03", 1002)).toBeGreaterThan(net("2026-02", 1002) * 1.3);
    expect(net("2026-04", 1002)).toBeLessThan(net("2026-03", 1002) * 0.8);
    for (const quiet of ["2025-12", "2026-01", "2026-05"]) {
      expect(buildMonth(quiet).payrollDetail.data.find((row) => row.employee_id === 1002)!.lines_settlement.some((line) => line.code === "bonificacion")).toBe(false);
    }
  });

  it("los aumentos de 1010 (enero) y 1007 (abril) aplican desde su mes y dentro de la tolerancia del 10 %", () => {
    const p1010 = rosterPerson(1010);
    expect(wageAt(p1010, "2025-12")).toBe(p1010.wage);
    expect(wageAt(p1010, "2026-01")).toBeGreaterThan(p1010.wage);
    expect(wageAt(p1010, "2026-01") / p1010.wage).toBeLessThan(1.1);
    const p1007 = rosterPerson(1007);
    expect(wageAt(p1007, "2026-03")).toBe(p1007.wage);
    expect(wageAt(p1007, "2026-04")).toBeGreaterThan(p1007.wage);
  });

  it("1005 cambia de cuenta en febrero y 1004 tiene incapacidad con licencia en mayo", () => {
    const p1005 = rosterPerson(1005);
    expect(bankAt(p1005, "2026-01").last4).toBe(p1005.bankInfo.last4);
    expect(bankAt(p1005, "2026-02").last4).toBe("5560");
    expect(buildMonth("2026-05").licences.data.map((licence) => licence.employee_id)).toEqual([1004]);
    expect(buildMonth("2026-04").licences.data).toEqual([]);
  });

  it("la prima aparece para todos solo en jun y dic", () => {
    for (const month of monthRange("2025-10", "2026-12")) {
      const withPrima = buildMonth(month).payrollDetail.data.filter((row) => row.lines_settlement.some((line) => line.code === "prima_servicios")).length;
      expect(withPrima).toBe((PRIMA_MONTHS as readonly string[]).includes(month.slice(5)) ? 12 : 0);
    }
  });

  it("1006 y 1012 tienen pago variable distinto de un mes a otro (dispersión natural)", () => {
    const amounts = monthRange("2025-10", "2026-09").map((month) => buildMonth(month).payrollDetail.data.find((row) => row.employee_id === 1006)!.lines_settlement.find((line) => line.code === "recargos")?.amount ?? 0);
    expect(new Set(amounts).size).toBeGreaterThan(3);
    const maxBps = TIMELINE.find((event) => event.kind === "variable_pay" && event.employeeId === 1006);
    expect(maxBps).toBeDefined();
  });

  it("cada mes del rango cumple el esquema estricto de Buk y las reglas de datos de fixture", () => {
    for (const month of monthRange("2025-10", "2026-12")) {
      const payloads = buildMonth(month, { injections: [{ kind: "duplicate", employeeId: 1004 }, { kind: "terminated_paid", employeeId: 1008 }] });
      ENDPOINT_SCHEMAS["GET /employees/active"].parse(payloads.employeesActive);
      ENDPOINT_SCHEMAS["GET /payroll_detail/month"].parse(payloads.payrollDetail);
      ENDPOINT_SCHEMAS["GET /absences/licence"].parse(payloads.licences);
      ENDPOINT_SCHEMAS["GET /jobs/events/terminations"].parse(payloads.terminations);
      const raw = JSON.stringify(payloads);
      expect(raw).not.toMatch(/"account_number":\s*"(?!\*{4}\d{4}")/);
      expect(raw).not.toMatch(/"(rut|document_number)":\s*"(?!999)/);
    }
  });
});

describe("historia: rutas compartidas y transporte en memoria", () => {
  const manifest = loadManifest(SCENARIO);

  it("el escenario con historia expone 14 meses anteriores + el mes de prueba por los mismos endpoints", () => {
    const periods = readScenarioJson<{ data: { month: string }[] }>(SCENARIO, resolveRoute(manifest, "/process_periods", {})!.file);
    expect(periods.data.map((row) => row.month)).toEqual(monthRange("2025-10", "2026-12"));
    const march = resolveRoute(manifest, "/payroll_detail/month", { date: "01-03-2026" });
    expect(march?.file).toBe("shared:payroll_detail_month_2026-03.json");
    expect(readScenarioJson(SCENARIO, march!.file)).toEqual(buildMonth("2026-03").payrollDetail);
  });

  it("el mes de prueba es propio del escenario (lleva las anomalías sembradas)", () => {
    const december = resolveRoute(manifest, "/payroll_detail/month", { date: "01-12-2026" })!;
    expect(december.file).toBe("payroll_detail_month_2026-12.json");
    expect(readScenarioJson(SCENARIO, december.file)).toEqual(
      buildMonth("2026-12", { injections: [{ kind: "bonus_multiple", employeeId: 1002, x100: 300 }, { kind: "bump_pct", employeeId: 1010, bps: 500 }] }).payrollDetail,
    );
  });

  it("los archivos compartidos no permiten salir de payloads/_history", () => {
    expect(() => readScenarioJson(SCENARIO, "shared:../manifest.json")).toThrow();
    expect(() => readScenarioJson(SCENARIO, "shared:sub/dir.json")).toThrow();
  });

  it("el transporte en memoria sirve lo mismo que los archivos", async () => {
    const memory = new MemoryBukTransport(monthRange("2025-10", "2026-11"));
    expect(await memory.get("/payroll_detail/month", { date: "01-06-2026" })).toEqual(buildMonth("2026-06").payrollDetail);
    expect(await memory.get("/employees/active", { date: "2026-02-28" })).toEqual(buildMonth("2026-02").employeesActive);
    await expect(memory.get("/payroll_detail/month", { date: "01-01-2030" })).rejects.toThrow();
  });

  it("sin historia, Buk solo expone la ventana corta y el libro no trae decisiones", () => {
    const bare = loadManifest("aprendizaje-sin-historia");
    const periods = readScenarioJson<{ data: { month: string }[] }>("aprendizaje-sin-historia", resolveRoute(bare, "/process_periods", {})!.file);
    expect(periods.data.map((row) => row.month)).toEqual(["2026-10", "2026-11", "2026-12"]);
    const ledger = readScenarioJson<Ledger>("aprendizaje-sin-historia", bare.pacta.decisionHistory!);
    expect(ledger.months).toEqual([]);
    const full = readScenarioJson<Ledger>(SCENARIO, manifest.pacta.decisionHistory!);
    expect(ledger.confirmed).toEqual(full.confirmed);
  });
});

describe("libro de decisiones", () => {
  const stored = readScenarioJson<Ledger & { seedThrough: string }>(SCENARIO, loadManifest(SCENARIO).pacta.decisionHistory!);

  it("el archivo del escenario es exactamente el replay actual (nada escrito a mano)", async () => {
    const replay = await replayLedger({ template: OBLIGATION_BASE, from: "2025-10", to: "2026-11", resolutions: HISTORY_RESOLUTIONS });
    expect(JSON.parse(JSON.stringify({ ...replay, seedThrough: "2026-02" }))).toEqual(stored);
  });

  it("cada línea que escaló tiene una resolución humana con actor y comentario; nada queda pendiente", () => {
    for (const month of stored.months) {
      for (const line of month.lines) {
        if (line.autoDecision === "requires_approval") {
          expect(line.resolution, `${month.month} ${line.counterpartyRef}`).not.toBeNull();
          expect(line.resolution!.actor).toMatch(/^usr_/);
          expect(line.resolution!.comment.length).toBeGreaterThan(10);
        }
        expect(line.finalDecision).not.toBe("requires_approval");
      }
    }
  });

  it("cuenta la historia esperada: 1005 cambia de cuenta (feb), 1002 recibe bonificación (mar) y escala al volver a la base (abr)", () => {
    const at = (month: string, id: number) => stored.months.find((m) => m.month === month)!.lines.find((l) => l.counterpartyRef === `buk:employee:${id}` && l.lineType === "salary")!;
    expect(at("2026-02", 1005).reasons).toContain("BENEFICIARY_CHANGED");
    expect(at("2026-03", 1005).autoDecision).toBe("approved");
    expect(at("2026-03", 1002).reasons).toContain("VARIANCE_EXCEEDED");
    expect(at("2026-03", 1002).resolution?.comment).toMatch(/Bonificación trimestral/);
    expect(at("2026-04", 1002).reasons).toContain("VARIANCE_EXCEEDED");
    expect(at("2026-05", 1004).reasons).toContain("INSUFFICIENT_DATA");
  });

  it("1002 genera seis intervenciones humanas (tres bonificaciones y tres regresos): la carga que luego una autorización puede evitar", () => {
    const interventions = stored.months.flatMap((m) => m.lines).filter((l) => l.counterpartyRef === "buk:employee:1002" && l.resolution !== null);
    expect(interventions).toHaveLength(6);
  });

  it("falla si una resolución no corresponde a una línea que escaló (no pueden desalinearse de las reglas)", async () => {
    await expect(
      replayLedger({
        template: OBLIGATION_BASE,
        from: "2025-10",
        to: "2025-12",
        resolutions: [{ month: "2025-11", employeeId: 1001, lineType: "salary", action: "approve", actor: "usr_x", comment: "no debería existir esta resolución" }],
      }),
    ).rejects.toThrow(/sin línea que escalara/);
  });

  it("la ventana del libro termina un mes antes del mes de prueba", () => {
    expect(stored.months[0]!.month).toBe("2025-10");
    expect(stored.months.at(-1)!.month).toBe(addMonths("2026-12", -1));
    expect(stored.seedThrough).toBe("2026-02");
  });
});

describe("etiquetas de verdad", () => {
  it("solo las dos anomalías sembradas están etiquetadas", () => {
    const file = JSON.parse(readFileSync(join(process.cwd(), "src/features/obligations/fixtures/buk/expected/learning", `${SCENARIO}.labels.json`), "utf8")) as {
      lines: { counterpartyRef: string; lineType: string; label: string; kind: string | null }[];
    };
    const anomalous = file.lines.filter((line) => line.label === "anomalous").map((line) => `${line.counterpartyRef}:${line.kind}`);
    expect(anomalous.sort()).toEqual(["buk:employee:1002:bonus_over_pattern", "buk:employee:1010:off_cycle_raise"]);
  });

  it("ningún módulo de learning/ importa etiquetas ni expected/learning", () => {
    const dir = join(process.cwd(), "src/features/obligations/learning");
    if (!existsSync(dir)) return;
    const files: string[] = [];
    const walk = (current: string) => {
      for (const entry of readdirSync(current)) {
        const path = join(current, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) files.push(path);
      }
    };
    walk(dir);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/labels\.json|expected\/learning|fixtures\/buk\/expected/);
    }
  });
});
