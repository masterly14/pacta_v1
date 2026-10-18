/**
 * FIXTURE — Abre un escenario del mock de Buk: transporte (archivos o HTTP al mock), almacén de datos de Pacta (`_pacta/`)
 * y la fuente de obligaciones lista para el motor. Todo es ficticio; el dinero es simulado.
 */
import { ObligationTemplateSchema, type ObligationTemplate } from "@/shared/schemas/obligation-config";
import { HttpTransport, type BukTransport, type Query } from "../../sources/buk/client";
import type { BenefitCalendar, PactaEvidenceStore, SnapshotResource } from "../../sources/buk/evidence-store";
import { BukWebhookSchema } from "../../sources/buk/schemas";
import { BukPayrollReader, createBukObligationSource, type BukObligationSource } from "../../sources/buk/source";
import type { BukRawBundle } from "../../sources/buk/mapper";
import { loadManifest, readScenarioJson, resolveRoute, type FetchLog, type LastConfirmedFile, type ScenarioManifest, type TreasuryFile } from "./manifest";

/** Transporte que sirve los payloads del escenario directamente desde disco (sin servidor). */
export class FileTransport implements BukTransport {
  constructor(private scenario: string) {}
  async get(path: string, query: Query): Promise<unknown> {
    const manifest = loadManifest(this.scenario);
    const route = resolveRoute(manifest, path, query);
    if (!route) throw new Error(`[${this.scenario}] sin payload para GET ${path} ${JSON.stringify(query)}`);
    return readScenarioJson(this.scenario, route.file);
  }
  async getUrl(url: string): Promise<unknown> {
    const parsed = new URL(url);
    return this.get(parsed.pathname.replace(/^.*\/api\/v1\/colombia/, ""), Object.fromEntries(parsed.searchParams));
  }
}

/** Datos de Pacta congelados en el escenario (`payloads/<escenario>/_pacta/*.json`). */
export class FixtureEvidenceStore implements PactaEvidenceStore {
  private log: FetchLog;
  private confirmed: LastConfirmedFile;
  private treasuryFile: TreasuryFile;
  private calendar: BenefitCalendar;
  private hooks: ReturnType<PactaEvidenceStore["webhooksReceived"]>;
  constructor(scenario: string, manifest: ScenarioManifest = loadManifest(scenario)) {
    this.log = readScenarioJson<FetchLog>(scenario, manifest.pacta.fetchLog);
    this.confirmed = readScenarioJson<LastConfirmedFile>(scenario, manifest.pacta.lastConfirmed);
    this.treasuryFile = readScenarioJson<TreasuryFile>(scenario, manifest.pacta.treasury);
    this.calendar = readScenarioJson<BenefitCalendar>(scenario, manifest.pacta.benefitCalendar);
    this.hooks = manifest.pacta.webhooks.map((hook) => ({ receivedAt: hook.receivedAt, body: BukWebhookSchema.parse(readScenarioJson(scenario, hook.file)) }));
  }
  capturedAt(resource: SnapshotResource) {
    return this.log.capturedAt[resource];
  }
  lastConfirmed(counterpartyRef: string) {
    return this.confirmed.byCounterparty[counterpartyRef] ?? null;
  }
  treasury() {
    return { fundsAvailableMinor: this.treasuryFile.fundsAvailableMinor, fundsReservedMinor: this.treasuryFile.fundsReservedMinor };
  }
  benefitCalendar() {
    return this.calendar;
  }
  webhooksReceived() {
    return this.hooks;
  }
}

export type OpenedScenario = {
  scenario: string;
  manifest: ScenarioManifest;
  template: ObligationTemplate;
  raw: BukRawBundle;
  source: BukObligationSource;
};

/** Plantilla del escenario (`_pacta/obligation.json`) sin las marcas `fixture`/`note`. */
export function scenarioTemplate(scenario: string, manifest: ScenarioManifest = loadManifest(scenario)): ObligationTemplate {
  const template = readScenarioJson<Record<string, unknown>>(scenario, manifest.pacta.obligation);
  delete template.fixture;
  delete template.note;
  return ObligationTemplateSchema.parse(template);
}

/** Lee el período del escenario por archivos, o por HTTP si se da `baseUrl` (mock servido por la ruta de Next). */
export async function openScenario(scenario: string, opts: { baseUrl?: string; fetch?: typeof fetch } = {}): Promise<OpenedScenario> {
  const manifest = loadManifest(scenario);
  const store = new FixtureEvidenceStore(scenario, manifest);
  const transport = opts.baseUrl
    ? new HttpTransport(`${opts.baseUrl.replace(/\/$/, "")}/${scenario}/api/v1/colombia`, "fixture-token", opts.fetch)
    : new FileTransport(scenario);
  const raw = await new BukPayrollReader(transport, store).load(manifest.period.month);
  const template = scenarioTemplate(scenario, manifest);
  const source = createBukObligationSource(raw, store, { organizationId: template.organizationId, currency: template.currency });
  return { scenario, manifest, template, raw, source };
}
