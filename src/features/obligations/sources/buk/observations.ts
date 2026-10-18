/**
 * Observaciones históricas de nómina a partir de lo leído en Buk. Puro, sin I/O.
 * Una observación por empleado y mes: el neto de la línea de salario (sin prima), la cuenta y los conceptos rastreados.
 * Es la única entrada del aprendizaje: no incluye decisiones ni etiquetas.
 */
import type { EmployeeStatus } from "@/shared/schemas/obligation-config";
import { counterpartyRefOf, employeeStatusOf, isPrimaLine, maskAccount, toMinor, trackedConcepts, type BukRawBundle } from "./mapper";
import type { BukPayrollReader } from "./source";

export type PayrollObservation = {
  month: string;
  counterpartyRef: string;
  /** Neto a transferir de la línea de salario, en unidades menores. */
  netMinor: number;
  beneficiaryReference: string | null;
  /** Haberes rastreables del mes (bonificación, recargos, incapacidad) por código. */
  concepts: Record<string, number>;
  status: EmployeeStatus;
};

export function observationsFromBundle(raw: BukRawBundle): PayrollObservation[] {
  const employees = [...raw.activeEmployees, ...raw.employeeDetails];
  const asOf = `${raw.period.endDate}T14:00:00Z`;
  const out: PayrollObservation[] = [];
  for (const settlement of raw.payrollCurrent) {
    const employee = employees.find((candidate) => candidate.id === settlement.employee_id);
    const prima = settlement.lines_settlement.filter(isPrimaLine).reduce((total, line) => total + toMinor(line.amount), 0);
    const netMinor = toMinor(settlement.liquid_reach) - prima;
    if (netMinor <= 0) continue;
    out.push({
      month: raw.period.month,
      counterpartyRef: counterpartyRefOf(settlement.employee_id),
      netMinor,
      beneficiaryReference: employee ? maskAccount(employee.account_number) : null,
      concepts: trackedConcepts(settlement),
      status: employee ? employeeStatusOf(employee, raw, asOf) : "terminated",
    });
  }
  return out;
}

/** Lee varios meses de Buk con el lector y devuelve sus observaciones, en orden de mes. */
export async function loadObservations(reader: BukPayrollReader, months: readonly string[]): Promise<PayrollObservation[]> {
  const out: PayrollObservation[] = [];
  for (const month of [...months].sort()) out.push(...observationsFromBundle(await reader.load(month)));
  return out;
}
