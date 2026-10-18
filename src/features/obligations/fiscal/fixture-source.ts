/**
 * Purpose: the simulated accounting connector. Loads a demo scenario (JSON versioned in the
 *   repo) and validates it with Zod, as a real connector would validate an API response.
 *   No real accounting provider is called; everything returned is labeled `fixture`.
 * Runs in: server and tests (pure, no network; JSON is bundled at build time).
 * Triggered by: the fiscal engine tests today; later the obligations cron and demo UI.
 * Receives → Returns: scenario name → FiscalScenario (throws on invalid data);
 *   parseFiscalScenario(unknown) → { ok: true, scenario } | { ok: false, error }.
 * Talks to: ./schemas.ts and the JSON files in ./fixtures.
 */
import { FiscalScenarioSchema, type FiscalScenario } from "./schemas";
import fiscalAnomalias from "./fixtures/fiscal-anomalias.json";
import fiscalLimpio from "./fixtures/fiscal-limpio.json";

const SCENARIOS = {
  "fiscal-limpio": fiscalLimpio,
  "fiscal-anomalias": fiscalAnomalias,
} as const;

export type FiscalScenarioName = keyof typeof SCENARIOS;

export const FISCAL_SCENARIO_NAMES = Object.keys(SCENARIOS) as FiscalScenarioName[];

export type ParseFiscalScenarioResult = { ok: true; scenario: FiscalScenario } | { ok: false; error: string };

// Límite de entrada: datos inválidos no pasan al motor (CLAUDE.md §5).
export function parseFiscalScenario(raw: unknown): ParseFiscalScenarioResult {
  const parsed = FiscalScenarioSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`);
    return { ok: false, error: `Escenario fiscal inválido. ${issues.join("; ")}` };
  }
  return { ok: true, scenario: parsed.data };
}

export function loadFiscalScenario(name: FiscalScenarioName): FiscalScenario {
  const result = parseFiscalScenario(SCENARIOS[name]);
  if (!result.ok) throw new Error(result.error);
  return result.scenario;
}
