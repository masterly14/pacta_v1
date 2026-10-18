/**
 * Mapper puro: respuestas de Buk (validadas con Zod) + datos propios de Pacta
 * -> `PayrollDataset` y `ObligationContext[]` de los contratos compartidos (platform-core §6).
 * No hace I/O. Todo lo que Buk no dice queda `null`; 0 nunca sustituye a un dato faltante.
 */
import type { z } from "zod";
import type { EmployeeStatus, ObligationLineType, ObligationTemplate, PayrollDataset, PayrollEmployee } from "@/shared/schemas/obligation-config";
import {
  ObligationContextSchema,
  obligationMissingFields,
  type EvidenceSnapshotRef,
  type ObligationContext,
  type ObligationPeriod,
  type ObligationSignalRef,
} from "@/shared/schemas/obligation-context";
import type { BenefitCalendar, LastConfirmed, PactaEvidenceStore } from "./evidence-store";
import type { BukEmployee, BukLicence, BukSettlement, BukWebhook, FiniquitoSchema, TerminatedJobSchema } from "./schemas";

export type BukFiniquito = z.infer<typeof FiniquitoSchema>;
export type BukTerminatedJob = z.infer<typeof TerminatedJobSchema>;

/** Todo lo leído de Buk para un período, con las instantáneas congeladas (una por recurso). */
export type BukRawBundle = {
  period: { month: string; startDate: string; endDate: string };
  activeEmployees: BukEmployee[];
  employeeDetails: BukEmployee[];
  payrollCurrent: BukSettlement[];
  terminations: BukTerminatedJob[];
  finiquitos: { jobId: number; finiquito: BukFiniquito }[];
  licences: BukLicence[];
  evidence: {
    employees: EvidenceSnapshotRef[];
    payroll: EvidenceSnapshotRef[];
    terminations: EvidenceSnapshotRef[];
    licences: EvidenceSnapshotRef[];
    periods: EvidenceSnapshotRef[];
  };
};

/** Datos de Pacta ya leídos del almacén (sin I/O dentro del mapper). */
export type PactaData = {
  lastConfirmed: (counterpartyRef: string) => LastConfirmed | null;
  treasury: { fundsAvailableMinor: number | null; fundsReservedMinor: number | null };
  benefitCalendar: BenefitCalendar;
  webhooks: { receivedAt: string; body: BukWebhook }[];
};

export const pactaDataFrom = (store: PactaEvidenceStore): PactaData => ({
  lastConfirmed: (ref) => store.lastConfirmed(ref),
  treasury: store.treasury(),
  benefitCalendar: store.benefitCalendar(),
  webhooks: store.webhooksReceived(),
});

/** COP unidades mayores (float de Buk) -> unidades menores enteras. */
export const toMinor = (cop: number): number => Math.round(cop * 100);

/** Regla de datos: nunca un número completo. Deja solo los últimos 4 dígitos como ****1234. */
export function maskAccount(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `****${digits.slice(-4)}`;
}

/** Conceptos variables que el perfil histórico sigue por separado. El resto del neto es la base (`net_base`). */
export const TRACKED_CONCEPT_CODES = ["bonificacion", "recargos", "incapacidad_general"] as const;

/** Haberes rastreables de una liquidación, sumados por código, en unidades menores. */
export function trackedConcepts(settlement: Pick<BukSettlement, "lines_settlement">): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of settlement.lines_settlement) {
    const code = line.code ?? "";
    if (line.type === "haber" && (TRACKED_CONCEPT_CODES as readonly string[]).includes(code)) out[code] = (out[code] ?? 0) + toMinor(line.amount);
  }
  return out;
}

/** Buk no publica el catálogo de conceptos: la prima se reconoce por código o nombre. */
export const isPrimaLine = (line: { code?: string | null; name: string; type: string }) =>
  line.type === "haber" && /prima/i.test(`${line.code ?? ""} ${line.name}`);

export const counterpartyRefOf = (employeeId: number) => `buk:employee:${employeeId}`;
export const employeeIdOf = (ref: string) => Number(ref.replace("buk:employee:", ""));

/** Fecha calendario en Bogotá (UTC-5, sin horario de verano) de un instante UTC. */
export const bogotaDate = (utc: string) => new Date(Date.parse(utc) - 5 * 3600_000).toISOString().slice(0, 10);

const overlaps = (licence: BukLicence, start: string, end: string) => licence.start_date <= end && (licence.end_date ?? licence.start_date) >= start;

/**
 * Estado del empleado derivado de Buk:
 *  - terminated: Buk `inactivo` o `pendiente` (finiquitado), o `active_until` ≤ fecha de asOf;
 *  - on_leave: una licencia o incapacidad que se cruza con el período;
 *  - active: en otro caso.
 */
export function employeeStatusOf(employee: BukEmployee, raw: BukRawBundle, asOf: string): EmployeeStatus {
  if (employee.status === "inactivo" || employee.status === "pendiente" || (employee.active_until && employee.active_until <= bogotaDate(asOf))) return "terminated";
  if (raw.licences.some((licence) => licence.employee_id === employee.id && overlaps(licence, raw.period.startDate, raw.period.endDate))) return "on_leave";
  return "active";
}

const findEmployee = (raw: BukRawBundle, id: number) => [...raw.activeEmployees, ...raw.employeeDetails].find((employee) => employee.id === id) ?? null;

/**
 * Webhooks de Buk que llegaron DESPUÉS de la instantánea de RR. HH. y no después de `asOf`: aún no están en lo leído.
 * Un webhook solo notifica: se trata como señal propuesta y solo puede aumentar la cautela.
 */
export function pendingSignals(raw: BukRawBundle, pacta: PactaData, employeeId: number, asOf: string, hrCapturedAt: string | null): ObligationSignalRef[] {
  return pacta.webhooks
    .filter((hook) => Date.parse(hook.receivedAt) <= Date.parse(asOf) && (!hrCapturedAt || Date.parse(hook.receivedAt) > Date.parse(hrCapturedAt)))
    .filter((hook) => {
      const data = hook.body.data;
      if ("employee_id" in data) return data.employee_id === employeeId;
      return raw.licences.some((licence) => licence.id === data.licence_id && licence.employee_id === employeeId);
    })
    .map((hook) => {
      const data = hook.body.data;
      const id = "employee_id" in data ? data.employee_id : data.licence_id;
      return { signalId: `buk-webhook:${data.event_type}:${id}:${hook.receivedAt}`, kind: "employment_event" as const, status: "proposed" as const };
    });
}

/** Instante en que Pacta leyó RR. HH. (la más antigua de empleados y nómina). */
export const hrCapturedAtOf = (raw: BukRawBundle): string | null =>
  [...raw.evidence.employees, ...raw.evidence.payroll].map((snapshot) => snapshot.capturedAt).sort()[0] ?? null;

/** Prima esperada del mes según el calendario del escenario. Fórmula simplificada y ficticia, no cálculo laboral. */
function expectedPrimaMinor(employee: BukEmployee, raw: BukRawBundle, calendar: BenefitCalendar): number | null {
  if (!calendar.primaMonths.includes(raw.period.month.slice(5))) return null;
  const wageMinor = employee.current_job?.wage != null ? toMinor(employee.current_job.wage) : null;
  if (wageMinor === null) return null;
  const aux = wageMinor <= 2 * calendar.smmlvMinor ? calendar.auxTransporteMinor : 0;
  return Math.round((wageMinor + aux) / 2 / 100) * 100;
}

const sumsTo = (components: { amountMinor: number }[] | undefined, amountMinor: number): components is { code: string; amountMinor: number }[] =>
  components !== undefined && components.length > 0 && components.every((component) => component.amountMinor > 0) && components.reduce((total, component) => total + component.amountMinor, 0) === amountMinor;

const positiveOrNull = (value: number | null | undefined) => (value != null && value > 0 ? value : null);

/**
 * Dataset configurado (platform-core §6) a partir de lo leído en Buk. Un empleado sin salario base no entra al dataset:
 * su línea no encuentra hechos y escala (fail-closed).
 */
export function buildPayrollDataset(
  raw: BukRawBundle,
  pacta: PactaData,
  org: { organizationId: string; currency: string },
  capturedAt: string,
  asOf: string,
): PayrollDataset {
  const seen = new Set<number>();
  const employees: PayrollEmployee[] = [];
  for (const employee of [...raw.activeEmployees, ...raw.employeeDetails]) {
    if (seen.has(employee.id)) continue;
    seen.add(employee.id);
    const baseSalaryMinor = positiveOrNull(employee.current_job?.wage != null ? toMinor(employee.current_job.wage) : null);
    if (baseSalaryMinor === null) continue;
    const ref = counterpartyRefOf(employee.id);
    const last = pacta.lastConfirmed(ref);
    employees.push({
      counterpartyRef: ref,
      displayName: employee.full_name,
      status: employeeStatusOf(employee, raw, asOf),
      baseSalaryMinor,
      beneficiaryAccountReference: maskAccount(employee.account_number),
      lastConfirmedBeneficiaryReference: last?.beneficiaryReference ?? null,
      lastConfirmedAmountMinor: positiveOrNull(last?.amountMinor),
    });
  }
  const benefits = raw.activeEmployees.flatMap((employee) => {
    const expectedAmountMinor = positiveOrNull(expectedPrimaMinor(employee, raw, pacta.benefitCalendar));
    return expectedAmountMinor === null
      ? []
      : [{ counterpartyRef: counterpartyRefOf(employee.id), lineType: "bonus" as const, periodStart: raw.period.startDate, expectedAmountMinor }];
  });
  const { fundsAvailableMinor, fundsReservedMinor } = pacta.treasury;
  if (fundsAvailableMinor === null || fundsReservedMinor === null) throw new Error("La tesorería del escenario no declara fondos: no se inventa un 0");
  return {
    schemaVersion: 1,
    kind: "payroll",
    organizationId: org.organizationId,
    currency: org.currency,
    capturedAt,
    dataOrigin: "fixture",
    fundsAvailableMinor,
    fundsReservedMinor,
    employees,
    benefits,
  };
}

/**
 * Líneas de pago de la corrida. Una liquidación de Buk se parte en una línea `salary` (neto sin prima) y una `bonus` (prima);
 * la liquidación final de un retiro es `final_settlement`. El importe es el neto a transferir (`liquid_reach`).
 */
export function buildLines(raw: BukRawBundle, pacta: PactaData, template: ObligationTemplate, period: ObligationPeriod, asOf: string): ObligationContext[] {
  const occurrenceId = `${template.obligationId}:${period.periodStart}`;
  const hrCaptured = hrCapturedAtOf(raw);
  const lines: ObligationContext[] = [];

  const push = (input: {
    employeeId: number;
    suffix: string;
    lineType: ObligationLineType;
    amountMinor: number | null;
    componentCode: string;
    /** Componentes por concepto; deben sumar el importe, si no se usa un solo componente. */
    components?: { code: string; amountMinor: number }[];
    evidence: EvidenceSnapshotRef[];
  }) => {
    const employee = findEmployee(raw, input.employeeId);
    const ref = counterpartyRefOf(input.employeeId);
    const last = pacta.lastConfirmed(ref);
    const beneficiary = employee ? maskAccount(employee.account_number) : null;
    const amountMinor = positiveOrNull(input.amountMinor);
    const lastConfirmedAmountMinor = input.lineType === "salary" ? positiveOrNull(last?.amountMinor) : null;
    const currency = amountMinor === null ? null : (employee?.payment_currency ?? template.currency);
    const warnings: ObligationContext["warnings"] = [];
    if (!employee) warnings.push({ code: "counterparty_unresolved", message: `Buk no devolvió el colaborador ${input.employeeId}`, field: "displayName" });
    if (employee?.account_number && !/^\*{4}\d{4}$/.test(employee.account_number)) {
      warnings.push({ code: "account_masked_on_receipt", message: "Número de cuenta completo recibido de Buk: enmascarado por el adaptador", field: "beneficiaryAccountReference" });
    }
    const amounts = {
      beneficiaryAccountReference: beneficiary,
      lastConfirmedBeneficiaryReference: last?.beneficiaryReference ?? null,
      amountMinor,
      currency,
      lastConfirmedAmountMinor,
    };
    lines.push(
      ObligationContextSchema.parse({
        schemaVersion: 1,
        lineId: `${occurrenceId}:${input.suffix}`,
        occurrenceId,
        obligationId: template.obligationId,
        obligationVersion: template.version,
        organizationId: template.organizationId,
        kind: template.kind,
        asOf,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        dueDate: period.dueDate,
        counterpartyRef: ref,
        displayName: employee?.full_name ?? `Colaborador Buk ${input.employeeId}`,
        lineType: input.lineType,
        ...amounts,
        components: amountMinor === null ? [] : sumsTo(input.components, amountMinor) ? input.components : [{ code: input.componentCode, amountMinor }],
        evidence: input.evidence,
        signals: pendingSignals(raw, pacta, input.employeeId, asOf, hrCaptured),
        missingFields: obligationMissingFields(amounts),
        warnings,
      }),
    );
  };

  for (const settlement of raw.payrollCurrent) {
    const primaMinor = settlement.lines_settlement.filter(isPrimaLine).reduce((total, line) => total + toMinor(line.amount), 0);
    const evidence = [...raw.evidence.payroll, ...raw.evidence.employees];
    const salaryMinor = toMinor(settlement.liquid_reach) - primaMinor;
    const concepts = Object.entries(trackedConcepts(settlement)).map(([code, amountMinor]) => ({ code, amountMinor }));
    const base = salaryMinor - concepts.reduce((total, concept) => total + concept.amountMinor, 0);
    push({
      employeeId: settlement.employee_id,
      suffix: `buk-liquidacion-${settlement.liquidacion_id}:salary`,
      lineType: "salary",
      amountMinor: salaryMinor,
      componentCode: "net_pay",
      components: concepts.length > 0 && base > 0 ? [{ code: "net_base", amountMinor: base }, ...concepts] : undefined,
      evidence,
    });
    if (primaMinor > 0) {
      push({ employeeId: settlement.employee_id, suffix: `buk-liquidacion-${settlement.liquidacion_id}:bonus`, lineType: "bonus", amountMinor: primaMinor, componentCode: "prima_servicios", evidence });
    }
  }
  for (const { jobId, finiquito } of raw.finiquitos) {
    const job = raw.terminations.find((termination) => termination.id === jobId);
    if (!job) continue;
    push({
      employeeId: job.employee_id,
      suffix: `buk-finiquito-${finiquito.id}:final_settlement`,
      lineType: "final_settlement",
      amountMinor: toMinor(finiquito.monto),
      componentCode: "final_settlement",
      evidence: [...raw.evidence.terminations, ...raw.evidence.employees],
    });
  }
  return lines;
}
