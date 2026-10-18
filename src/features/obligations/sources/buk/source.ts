/**
 * Adaptador de RR. HH. sobre la API de Buk (Colombia) en dos pasos, porque el puerto compartido es síncrono:
 *   1. `BukPayrollReader.load(period)` (asíncrono) lee Buk y congela cada respuesta como evidencia con sha256.
 *   2. `createBukObligationSource(bundle, …)` (síncrono y puro) implementa `ObligationSource` sobre lo leído.
 * El transporte es intercambiable: archivos del escenario, HTTP al mock, o HTTP al tenant real.
 */
import { createHash } from "node:crypto";
import { UtcInstantSchema } from "@/shared/schemas/invoice-context";
import { ConfiguredObligationSourceSchema, type ObligationTemplate, type PayrollDataset } from "@/shared/schemas/obligation-config";
import {
  ObligationContextSchema,
  ObligationPeriodSchema,
  type EvidenceSnapshotRef,
  type ObligationContext,
  type ObligationPeriod,
  type OccurrenceContext,
} from "@/shared/schemas/obligation-context";
import { describeOccurrence } from "@/shared/ports/memory-obligation-source";
import type { ConfiguredCounterpartyFact, ObligationSource } from "@/shared/ports/obligation-source";
import { BukClient, bukDate, type BukTransport } from "./client";
import type { PactaEvidenceStore, SnapshotResource } from "./evidence-store";
import { buildLines, buildPayrollDataset, hrCapturedAtOf, pactaDataFrom, type BukRawBundle } from "./mapper";
import {
  EmployeeDetailResponseSchema,
  EmployeesActiveResponseSchema,
  LicencesResponseSchema,
  PayrollDetailMonthResponseSchema,
  ProcessPeriodsResponseSchema,
  TerminationResponseSchema,
  TerminationsResponseSchema,
  type BukEmployee,
} from "./schemas";

/** Mes a pagar, YYYY-MM. */
export type Period = string;

export const sha256Json = (body: unknown) => createHash("sha256").update(JSON.stringify(body)).digest("hex");

const lastDay = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
};

export class BukPayrollReader {
  private client: BukClient;
  constructor(
    transport: BukTransport,
    private store: PactaEvidenceStore,
  ) {
    this.client = new BukClient(transport);
  }

  /** Lee Buk para un período. Cada respuesta cruda se congela como evidencia (sha256 del JSON recibido). */
  async load(period: Period): Promise<BukRawBundle> {
    const startDate = `${period}-01`;
    const endDate = lastDay(period);
    const evidence: BukRawBundle["evidence"] = { employees: [], payroll: [], terminations: [], licences: [], periods: [] };
    const freeze = (resource: SnapshotResource, endpoint: string) => (raw: unknown) => {
      const sha256 = sha256Json(raw);
      evidence[resource].push({
        snapshotId: `snap_buk_${endpoint}_${sha256.slice(0, 12)}`,
        source: "configured",
        kind: "payroll_roster",
        capturedAt: this.store.capturedAt(resource),
        sha256,
      });
    };

    const periods = await this.client.listAll("/process_periods", {}, ProcessPeriodsResponseSchema, freeze("periods", "process_periods"));
    if (!periods.some((row) => row.month === period)) throw new Error(`Buk no tiene el período ${period}`);

    const activeEmployees = await this.client.listAll("/employees/active", { date: bukDate.iso(endDate) }, EmployeesActiveResponseSchema, freeze("employees", "employees_active"));
    const payrollCurrent = await this.client.listAll("/payroll_detail/month", { date: bukDate.ddmmyyyy(startDate) }, PayrollDetailMonthResponseSchema, freeze("payroll", "payroll_detail_month"));
    const terminations = await this.client.listAll("/jobs/events/terminations", { start_date: startDate, end_date: endDate }, TerminationsResponseSchema, freeze("terminations", "jobs_terminations"));
    const finiquitos = [];
    for (const termination of terminations) {
      const response = await this.client.getOne(`/jobs/${termination.id}/termination`, {}, TerminationResponseSchema, freeze("terminations", "job_termination"));
      finiquitos.push({ jobId: termination.id, finiquito: response.data });
    }
    const known = new Set(activeEmployees.map((employee) => employee.id));
    const missing = new Set<number>([...payrollCurrent.map((row) => row.employee_id), ...terminations.map((row) => row.employee_id)].filter((id) => !known.has(id)));
    const employeeDetails: BukEmployee[] = [];
    for (const id of missing) {
      const response = await this.client.getOne(`/employees/${id}`, {}, EmployeeDetailResponseSchema, freeze("employees", "employee_detail"));
      employeeDetails.push("data" in response ? response.data : response);
    }
    const licences = await this.client.listAll("/absences/licence", { from: startDate, to: endDate }, LicencesResponseSchema, freeze("licences", "absences_licence"));

    return { period: { month: period, startDate, endDate }, activeEmployees, employeeDetails, payrollCurrent, terminations, finiquitos, licences, evidence };
  }
}

export type BukObligationSource = ObligationSource & {
  /** Dataset de nómina que corresponde a lo leído, visto desde `asOf`. */
  dataset(asOf: string): PayrollDataset;
  /** Líneas + datos de corrida listos para el motor, validados con los contratos compartidos. */
  occurrence(template: ObligationTemplate, asOf: string, period?: ObligationPeriod): { dataset: PayrollDataset; period: ObligationPeriod; lines: ObligationContext[]; occurrence: OccurrenceContext };
};

/** Período de pago del mes leído. Calendario `month_end`: vence el último día del mes. */
export function periodOf(raw: BukRawBundle): ObligationPeriod {
  return ObligationPeriodSchema.parse({ periodStart: raw.period.startDate, periodEnd: raw.period.endDate, dueDate: raw.period.endDate });
}

export function createBukObligationSource(raw: BukRawBundle, store: PactaEvidenceStore, org: { organizationId: string; currency: string }): BukObligationSource {
  const pacta = pactaDataFrom(store);
  const capturedAt = hrCapturedAtOf(raw);
  if (capturedAt === null) throw new Error("La lectura de Buk no trae instantáneas de RR. HH.");
  const dataset = (asOf: string) => buildPayrollDataset(raw, pacta, org, capturedAt, UtcInstantSchema.parse(asOf));
  const source: BukObligationSource = {
    dataset,
    generateLines(template, givenDataset, period, asOf) {
      ConfiguredObligationSourceSchema.parse({ template, dataset: givenDataset });
      const window = ObligationPeriodSchema.parse(period);
      if (window.periodStart !== raw.period.startDate) throw new Error(`La lectura de Buk es del período ${raw.period.month}`);
      const instant = UtcInstantSchema.parse(asOf);
      // Mismo criterio que la fuente en memoria: una instantánea posterior a `asOf` no existe todavía.
      if (Date.parse(capturedAt) > Date.parse(instant)) return [];
      return buildLines(raw, pacta, template, window, instant).map((line) => ObligationContextSchema.parse(line));
    },
    getFacts(counterpartyRef, asOf): ConfiguredCounterpartyFact | null {
      const instant = UtcInstantSchema.parse(asOf);
      if (Date.parse(capturedAt) > Date.parse(instant)) return null;
      const employee = dataset(instant).employees.find((row) => row.counterpartyRef === counterpartyRef);
      return employee ? { kind: "payroll", employee } : null;
    },
    occurrence(template, asOf, override) {
      const period = override ?? periodOf(raw);
      const built = dataset(asOf);
      const lines = source.generateLines(template, built, period, asOf);
      return { dataset: built, period, lines, occurrence: describeOccurrence({ template, dataset: built, period, asOf, lines }) };
    },
  };
  return source;
}

export type { EvidenceSnapshotRef };
