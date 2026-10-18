/**
 * Por escenario y por evaluación (inicial / reevaluación):
 *   payloads de Buk -> BukPayrollReader -> fuente de obligaciones (contratos compartidos) -> oráculo de reglas
 * y compara contra `expected/`. También verifica que cada `evidence[].sha256` corresponda a un payload de Buk,
 * que cada payload cumpla el esquema estricto de su endpoint y las reglas de datos de fixture (cuentas enmascaradas,
 * documentos falsos). El mismo recorrido se repite por HTTP contra el handler del mock.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ObligationContextSchema, OccurrenceContextSchema } from "@/shared/schemas/obligation-context";
import { ENDPOINT_SCHEMAS, type EndpointKey } from "../../sources/buk/schemas";
import { sha256Json } from "../../sources/buk/source";
import { handleBukMock } from "./handler";
import { EXPECTED_DIR, listScenarios, loadManifest, readScenarioJson } from "./manifest";
import { oracleDecideOccurrence, type OracleOccurrenceResult } from "./oracle-rules";
import { openScenario } from "./scenario";

type ExpectedStage = Pick<OracleOccurrenceResult, "asOf" | "occurrenceStatus" | "counts" | "runFindings" | "lines"> & { stage: string };

const normalize = (stage: Pick<ExpectedStage, "asOf" | "occurrenceStatus" | "counts" | "runFindings" | "lines">) => ({
  asOf: stage.asOf,
  occurrenceStatus: stage.occurrenceStatus,
  counts: stage.counts,
  runFindings: stage.runFindings.map((finding) => `${finding.ruleId}:${finding.code}:${finding.effect}:${finding.counterpartyRef}`),
  lines: stage.lines.map((line) => `${line.lineId}|${line.counterpartyRef}|${line.lineType}|${line.amountMinor}|${line.decision}|${line.reasons.join(",")}`),
});

const BASE_URL = "http://mock.test";
const mockFetch = ((input: RequestInfo | URL, init?: RequestInit) => handleBukMock(new Request(input, init))) as typeof fetch;

const scenarios = listScenarios();

describe("mock de Buk: escenarios", () => {
  it("hay al menos los escenarios de nómina acordados", () => {
    expect(scenarios).toEqual(expect.arrayContaining(["nomina-limpia", "nomina-anomalias", "trampa-fondos-insuficientes"]));
  });

  for (const scenario of scenarios) {
    const manifest = loadManifest(scenario);
    const expected = JSON.parse(readFileSync(join(EXPECTED_DIR, `${scenario}.json`), "utf8")) as { evaluations: ExpectedStage[] };

    it(`${scenario}: el manifiesto y el oráculo tienen las mismas evaluaciones`, () => {
      expect(expected.evaluations.map((evaluation) => evaluation.asOf)).toEqual(manifest.evaluations.map((evaluation) => evaluation.asOf));
    });

    it(`${scenario}: cada payload cumple el esquema estricto de su endpoint`, () => {
      for (const route of manifest.routes) {
        ENDPOINT_SCHEMAS[route.endpoint as EndpointKey].parse(readScenarioJson(scenario, route.file));
      }
    });

    it(`${scenario}: datos de fixture (cuentas enmascaradas, documentos falsos, correos .example)`, () => {
      const raw = JSON.stringify(manifest.routes.map((route) => readScenarioJson(scenario, route.file)));
      expect(raw).not.toMatch(/"account_number":\s*"(?!\*{4}\d{4}")/);
      expect(raw).not.toMatch(/"(rut|document_number)":\s*"(?!999)/);
      expect(raw).not.toMatch(/"email":\s*"(?![^"]+\.example")/);
    });

    for (const via of ["archivos", "HTTP"] as const) {
      it(`${scenario}: coincide con el oráculo (${via})`, async () => {
        const opened = await openScenario(scenario, via === "HTTP" ? { baseUrl: BASE_URL, fetch: mockFetch } : {});
        const payloadHashes = new Set(manifest.routes.map((route) => sha256Json(readScenarioJson(scenario, route.file))));
        for (const [index, evaluation] of expected.evaluations.entries()) {
          const asOf = manifest.evaluations[index]!.asOf;
          const built = opened.source.occurrence(opened.template, asOf);
          for (const line of built.lines) {
            ObligationContextSchema.parse(line);
            for (const snapshot of line.evidence) expect(payloadHashes.has(snapshot.sha256), `${snapshot.snapshotId} sin payload`).toBe(true);
          }
          OccurrenceContextSchema.parse(built.occurrence);
          const result = oracleDecideOccurrence({ template: opened.template, occurrence: built.occurrence, lines: built.lines, dataset: built.dataset });
          expect(normalize(result), `${scenario}/${evaluation.stage}`).toEqual(normalize(evaluation));
        }
      });
    }
  }
});

describe("mock de Buk: borde HTTP", () => {
  it("rechaza métodos distintos de GET y exige auth_token", async () => {
    expect((await handleBukMock(new Request(`${BASE_URL}/nomina-limpia/api/v1/colombia/process_periods`, { method: "POST" }))).status).toBe(405);
    expect((await handleBukMock(new Request(`${BASE_URL}/nomina-limpia/api/v1/colombia/process_periods`))).status).toBe(401);
  });

  it("responde 404 ante un escenario o recurso desconocido y valida page_size", async () => {
    const headers = { auth_token: "x" };
    expect((await handleBukMock(new Request(`${BASE_URL}/no-existe/api/v1/colombia/process_periods`, { headers }))).status).toBe(404);
    expect((await handleBukMock(new Request(`${BASE_URL}/nomina-limpia/api/v1/colombia/nada`, { headers }))).status).toBe(404);
    expect((await handleBukMock(new Request(`${BASE_URL}/nomina-limpia/api/v1/colombia/process_periods?page_size=5`, { headers }))).status).toBe(400);
  });
});
