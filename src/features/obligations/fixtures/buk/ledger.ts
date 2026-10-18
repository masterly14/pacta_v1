/**
 * FIXTURE — Libro de decisiones de Pacta sobre la historia de nómina (`_pacta/decision-history.json`).
 *
 * Reproduce, mes a mes y en orden, lo que Pacta habría decidido: lee Buk (transporte en memoria), arma la corrida con el
 * adaptador real, la evalúa con las reglas y aplica una lista DECLARATIVA de resoluciones humanas a lo que escaló
 * (acción, actor y comentario son datos de fixture). De ahí salen el último monto y la última cuenta confirmados que usa
 * el mes siguiente: no se sintetizan aparte. Las decisiones automáticas son calculadas, no escritas a mano.
 */
import type { ObligationTemplate } from "@/shared/schemas/obligation-config";
import type { BenefitCalendar, LastConfirmed, PactaEvidenceStore } from "../../sources/buk/evidence-store";
import { counterpartyRefOf, isPrimaLine, maskAccount, toMinor } from "../../sources/buk/mapper";
import { BukPayrollReader, createBukObligationSource } from "../../sources/buk/source";
import { AUX, SMMLV } from "./builders";
import { PRIMA_MONTHS, addMonths, lastDayOf, type MonthOptions } from "./history";
import { MemoryBukTransport } from "./memory-transport";
import { oracleDecideOccurrence, type OracleDecision } from "./oracle-rules";

export type HumanResolution = {
  month: string;
  employeeId: number;
  lineType: "salary" | "bonus" | "final_settlement";
  action: "approve" | "reject";
  actor: string;
  comment: string;
};

export type LedgerLine = {
  lineId: string;
  counterpartyRef: string;
  displayName: string;
  lineType: string;
  amountMinor: number | null;
  autoDecision: OracleDecision;
  reasons: string[];
  resolution: (Omit<HumanResolution, "month" | "employeeId" | "lineType"> & { resolvedAt: string }) | null;
  finalDecision: OracleDecision;
};

export type LedgerMonth = { month: string; asOf: string; occurrenceId: string; occurrenceStatus: string; lines: LedgerLine[] };

export type Ledger = {
  fixture: true;
  note: string;
  baselineMonth: string;
  months: LedgerMonth[];
  /** Último monto y cuenta confirmados al terminar el último mes del libro. */
  confirmed: Record<string, LastConfirmed>;
};

export const asOfOf = (month: string) => `${lastDayOf(month)}T14:00:00Z`; // 09:00 en Bogotá
const minusMinutes = (utc: string, minutes: number) => new Date(Date.parse(utc) - minutes * 60_000).toISOString().replace(".000Z", "Z");

export const LEDGER_TREASURY = { fundsAvailableMinor: 8_000_000_000, fundsReservedMinor: 0 };

export const LEDGER_BENEFIT_CALENDAR: BenefitCalendar = {
  primaMonths: [...PRIMA_MONTHS],
  formula: "prima_semestral_simplificada",
  smmlvMinor: SMMLV * 100,
  auxTransporteMinor: AUX * 100,
};

/** Almacén de Pacta del libro: lo confirmado hasta el mes anterior, sin webhooks. */
export class LedgerEvidenceStore implements PactaEvidenceStore {
  constructor(
    private month: string,
    private confirmed: Record<string, LastConfirmed>,
  ) {}
  capturedAt() {
    return minusMinutes(asOfOf(this.month), 5);
  }
  lastConfirmed(counterpartyRef: string) {
    return this.confirmed[counterpartyRef] ?? null;
  }
  treasury() {
    return LEDGER_TREASURY;
  }
  benefitCalendar() {
    return LEDGER_BENEFIT_CALENDAR;
  }
  webhooksReceived() {
    return [];
  }
}

type Settlement = { employee_id: number; liquid_reach: number; lines_settlement: { code?: string | null; name: string; type: string; amount: number }[] };

/** Lo confirmado antes de que Pacta empezara a operar: la nómina limpia del mes anterior a la ventana (baseline de onboarding). */
async function baseline(month: string, options: MonthOptions): Promise<Record<string, LastConfirmed>> {
  const transport = new MemoryBukTransport([month], () => options);
  const payroll = (await transport.get("/payroll_detail/month", { date: `01-${month.slice(5)}-${month.slice(0, 4)}` })) as { data: Settlement[] };
  const employees = (await transport.get("/employees/active", { date: lastDayOf(month) })) as { data: { id: number; account_number: string | null }[] };
  const accountOf = new Map(employees.data.map((employee) => [employee.id, maskAccount(employee.account_number)]));
  const confirmed: Record<string, LastConfirmed> = {};
  for (const settlement of payroll.data) {
    const prima = settlement.lines_settlement.filter(isPrimaLine).reduce((sum, line) => sum + toMinor(line.amount), 0);
    confirmed[counterpartyRefOf(settlement.employee_id)] = {
      beneficiaryReference: accountOf.get(settlement.employee_id) ?? null,
      amountMinor: toMinor(settlement.liquid_reach) - prima,
    };
  }
  return confirmed;
}

export async function replayLedger(input: {
  template: ObligationTemplate;
  /** Primer mes a decidir; el mes anterior es el baseline de onboarding. */
  from: string;
  to: string;
  resolutions: readonly HumanResolution[];
  options?: (month: string) => MonthOptions;
}): Promise<Ledger> {
  const options = input.options ?? (() => ({}));
  const baselineMonth = addMonths(input.from, -1);
  const months: string[] = [];
  for (let m = baselineMonth; m <= input.to; m = addMonths(m, 1)) months.push(m);
  const transport = new MemoryBukTransport(months, options);
  let confirmed = await baseline(baselineMonth, options(baselineMonth));
  const used = new Set<HumanResolution>();
  const out: LedgerMonth[] = [];

  for (const month of months.slice(1)) {
    const store = new LedgerEvidenceStore(month, confirmed);
    const raw = await new BukPayrollReader(transport, store).load(month);
    const source = createBukObligationSource(raw, store, { organizationId: input.template.organizationId, currency: input.template.currency });
    const asOf = asOfOf(month);
    const built = source.occurrence(input.template, asOf);
    const result = oracleDecideOccurrence({ template: input.template, occurrence: built.occurrence, lines: built.lines, dataset: built.dataset });

    const next = { ...confirmed };
    const lines: LedgerLine[] = result.lines.map((line) => {
      const employeeId = Number(line.counterpartyRef.replace("buk:employee:", ""));
      const resolution = line.decision === "requires_approval" ? input.resolutions.find((r) => r.month === month && r.employeeId === employeeId && r.lineType === line.lineType) : undefined;
      if (resolution) used.add(resolution);
      const finalDecision: OracleDecision = resolution ? (resolution.action === "approve" ? "approved" : "blocked") : line.decision;
      const source = built.lines.find((candidate) => candidate.lineId === line.lineId);
      if (finalDecision === "approved" && line.lineType === "salary" && line.amountMinor !== null) {
        next[line.counterpartyRef] = { beneficiaryReference: source?.beneficiaryAccountReference ?? null, amountMinor: line.amountMinor };
      }
      return {
        lineId: line.lineId,
        counterpartyRef: line.counterpartyRef,
        displayName: line.displayName,
        lineType: line.lineType,
        amountMinor: line.amountMinor,
        autoDecision: line.decision,
        reasons: line.reasons,
        resolution: resolution
          ? { action: resolution.action, actor: resolution.actor, comment: resolution.comment, resolvedAt: new Date(Date.parse(asOf) + 2 * 3_600_000).toISOString().replace(".000Z", "Z") }
          : null,
        finalDecision,
      };
    });
    confirmed = next;
    out.push({ month, asOf, occurrenceId: built.occurrence.occurrenceId, occurrenceStatus: result.occurrenceStatus, lines });
  }

  const unused = input.resolutions.filter((resolution) => !used.has(resolution));
  if (unused.length) throw new Error(`Resoluciones sin línea que escalara: ${unused.map((r) => `${r.month}/${r.employeeId}/${r.lineType}`).join(", ")}`);
  return {
    fixture: true,
    note: "Libro de decisiones de Pacta sobre la historia de nómina. Decisiones automáticas calculadas con las reglas; resoluciones humanas = datos de fixture. Dinero simulado.",
    baselineMonth,
    months: out,
    confirmed,
  };
}
