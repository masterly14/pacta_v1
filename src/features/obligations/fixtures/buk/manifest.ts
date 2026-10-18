/** FIXTURE / Pacta — Formato del manifiesto por escenario y resolución de rutas (compartido por mock server y FileTransport). */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Rutas desde la raíz del repo: la ruta de Next, Vitest y los scripts corren con ese cwd.
const BUK_FIXTURES_DIR = join(process.cwd(), "src/features/obligations/fixtures/buk");
export const PAYLOADS_DIR = join(BUK_FIXTURES_DIR, "payloads");
export const EXPECTED_DIR = join(BUK_FIXTURES_DIR, "expected");

export interface RouteEntry {
  method: "GET";
  /** Ruta relativa al basePath de Buk Colombia (/api/v1/colombia). */
  path: string;
  /** Endpoint documentado (clave de ENDPOINT_SCHEMAS). */
  endpoint: string;
  query: Record<string, string>;
  file: string;
}

export interface ScenarioManifest {
  fixture: true;
  scenario: string;
  description: string;
  organization: string;
  period: { month: string; startDate: string; endDate: string };
  routes: RouteEntry[];
  /** Datos propios de Pacta (no son de Buk). */
  pacta: {
    obligation: string;
    treasury: string;
    lastConfirmed: string;
    benefitCalendar: string;
    fetchLog: string;
    /** Webhooks de Buk recibidos por Pacta, con hora de recepción (UTC). */
    webhooks: { file: string; receivedAt: string }[];
  };
  /** Evaluaciones a reproducir (append-only, §4): inicial y, si aplica, reevaluación. */
  evaluations: { stage: string; asOf: string; description: string }[];
}

export interface FetchLog {
  fixture: true;
  note: string;
  capturedAt: { periods: string; employees: string; payroll: string; licences: string; terminations: string };
}

export interface TreasuryFile {
  fixture: true;
  note: string;
  fundsAvailableMinor: number | null;
  fundsReservedMinor: number | null;
}

export interface LastConfirmedFile {
  fixture: true;
  note: string;
  byCounterparty: Record<string, { beneficiaryReference: string | null; amountMinor: number | null }>;
}

/** Parámetros de paginación: no forman parte de la llave de la ruta. */
const IGNORED_QUERY = new Set(["page", "page_size", "sort"]);

export function listScenarios(): string[] {
  const idx = JSON.parse(readFileSync(join(PAYLOADS_DIR, "index.json"), "utf8")) as { scenarios: string[] };
  return idx.scenarios;
}

export function loadManifest(scenario: string): ScenarioManifest {
  if (!/^[a-z0-9-]+$/.test(scenario)) throw new Error(`Escenario inválido: ${scenario}`);
  return JSON.parse(readFileSync(join(PAYLOADS_DIR, scenario, "manifest.json"), "utf8")) as ScenarioManifest;
}

export function readScenarioJson<T = unknown>(scenario: string, file: string): T {
  if (file.includes("..")) throw new Error("ruta inválida");
  return JSON.parse(readFileSync(join(PAYLOADS_DIR, scenario, file), "utf8")) as T;
}

export function resolveRoute(m: ScenarioManifest, path: string, query: Record<string, string>): RouteEntry | null {
  return (
    m.routes.find((r) => {
      if (r.path !== path) return false;
      const keys = new Set([...Object.keys(r.query), ...Object.keys(query).filter((k) => !IGNORED_QUERY.has(k))]);
      for (const k of keys) if (r.query[k] !== query[k]) return false;
      return true;
    }) ?? null
  );
}
