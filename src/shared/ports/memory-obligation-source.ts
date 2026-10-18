import { createHash } from "node:crypto";
import { UtcInstantSchema } from "../schemas/invoice-context";
import {
  ConfiguredObligationSourceSchema,
  type FiscalDataset,
  type FiscalItem,
  type FiscalObligationType,
  type ObligationLineType,
  type ObligationTemplate,
  type PayrollDataset,
  type PayrollEmployee,
} from "../schemas/obligation-config";
import {
  ObligationContextSchema,
  ObligationPeriodSchema,
  OccurrenceContextSchema,
  obligationMissingFields,
  occurrenceMissingFields,
  type ObligationContext,
  type ObligationPeriod,
  type OccurrenceContext,
} from "../schemas/obligation-context";
import type { ConfiguredCounterpartyFact, ObligationSource } from "./obligation-source";

// Adaptador en memoria de la fuente configurada. No abre Gmail.
// Si la instantánea es posterior a `asOf`, no hay hechos: fail-closed.

export type MemoryObligationInput = {
  payroll?: { template: ObligationTemplate; dataset: PayrollDataset };
  fiscal?: { template: ObligationTemplate; dataset: FiscalDataset };
};

export function createMemoryObligationSource(configured: MemoryObligationInput): ObligationSource {
  const stored = [
    configured.payroll ? ConfiguredObligationSourceSchema.parse(configured.payroll) : null,
    configured.fiscal ? ConfiguredObligationSourceSchema.parse(configured.fiscal) : null,
  ].filter((source) => source !== null);

  return {
    generateLines(template, dataset, period, asOf) {
      const source = ConfiguredObligationSourceSchema.parse({ template, dataset });
      const window = ObligationPeriodSchema.parse(period);
      const instant = UtcInstantSchema.parse(asOf);
      if (Date.parse(source.dataset.capturedAt) > Date.parse(instant)) return [];
      if (source.dataset.kind === "payroll") return payrollLines(source.template, source.dataset, window, instant);
      return fiscalLines(source.template, source.dataset, window, instant);
    },
    getFacts(counterpartyRef, asOf) {
      const instant = UtcInstantSchema.parse(asOf);
      const hits: ConfiguredCounterpartyFact[] = [];
      for (const source of stored) {
        if (Date.parse(source.dataset.capturedAt) > Date.parse(instant)) continue;
        if (source.dataset.kind === "payroll") {
          const employee = source.dataset.employees.find((row) => row.counterpartyRef === counterpartyRef);
          if (employee) hits.push({ kind: "payroll", employee });
        } else {
          const item = source.dataset.items.find((row) => row.counterpartyRef === counterpartyRef);
          if (item) hits.push({ kind: "fiscal", item });
        }
      }
      return hits.length === 1 ? hits[0] : null;
    },
  };
}

function payrollLines(template: ObligationTemplate, dataset: PayrollDataset, period: ObligationPeriod, asOf: string): ObligationContext[] {
  const evidence = [snapshot(dataset, "payroll_roster")];
  const lines: ObligationContext[] = dataset.employees.map((employee) =>
    toLine({
      template,
      period,
      asOf,
      counterpartyRef: employee.counterpartyRef,
      displayName: employee.displayName,
      lineType: "salary",
      amountMinor: employee.baseSalaryMinor,
      currency: dataset.currency,
      beneficiaryAccountReference: employee.beneficiaryAccountReference,
      lastConfirmedBeneficiaryReference: employee.lastConfirmedBeneficiaryReference,
      lastConfirmedAmountMinor: employee.lastConfirmedAmountMinor,
      evidence,
    }),
  );
  for (const benefit of dataset.benefits) {
    if (benefit.periodStart < period.periodStart || benefit.periodStart > period.periodEnd) continue;
    const employee = dataset.employees.find((row) => row.counterpartyRef === benefit.counterpartyRef);
    lines.push(
      toLine({
        template,
        period,
        asOf,
        counterpartyRef: benefit.counterpartyRef,
        displayName: employee?.displayName ?? benefit.counterpartyRef,
        lineType: benefit.lineType,
        amountMinor: benefit.expectedAmountMinor,
        currency: dataset.currency,
        beneficiaryAccountReference: employee?.beneficiaryAccountReference ?? null,
        lastConfirmedBeneficiaryReference: employee?.lastConfirmedBeneficiaryReference ?? null,
        lastConfirmedAmountMinor: null,
        evidence,
        warnings:
          employee === undefined
            ? [{ code: "counterparty_unresolved", message: "El beneficio no está en la planilla", field: "displayName" }]
            : [],
      }),
    );
  }
  return lines;
}

function fiscalLines(template: ObligationTemplate, dataset: FiscalDataset, period: ObligationPeriod, asOf: string): ObligationContext[] {
  const evidence = [snapshot(dataset, "fiscal_calendar")];
  return dataset.items
    .filter((item) => item.periodStart === period.periodStart && item.periodEnd === period.periodEnd)
    .map((item) =>
      toLine({
        template,
        period,
        asOf,
        counterpartyRef: item.counterpartyRef,
        displayName: item.displayName,
        lineType: fiscalLineType(item.fiscalType),
        amountMinor: item.settlementAmountMinor,
        currency: item.settlementAmountMinor === null ? null : dataset.currency,
        beneficiaryAccountReference: item.beneficiaryAccountReference,
        lastConfirmedBeneficiaryReference: item.authorizedPaymentReference,
        lastConfirmedAmountMinor: item.settlementStatus === "confirmed" ? item.settlementAmountMinor : null,
        evidence,
        dueDate: item.dueDate,
      }),
    );
}

function fiscalLineType(fiscalType: FiscalObligationType): ObligationLineType {
  if (fiscalType === "social_security") return "social_security";
  if (fiscalType === "parafiscal") return "parafiscal";
  return "tax";
}

function toLine(input: {
  template: ObligationTemplate;
  period: ObligationPeriod;
  asOf: string;
  counterpartyRef: string;
  displayName: string;
  lineType: ObligationLineType;
  amountMinor: number | null;
  currency: string | null;
  beneficiaryAccountReference: string | null;
  lastConfirmedBeneficiaryReference: string | null;
  lastConfirmedAmountMinor: number | null;
  evidence: ObligationContext["evidence"];
  dueDate?: string;
  warnings?: ObligationContext["warnings"];
}): ObligationContext {
  const occurrenceId = `${input.template.obligationId}:${input.period.periodStart}`;
  const amounts = {
    beneficiaryAccountReference: input.beneficiaryAccountReference,
    lastConfirmedBeneficiaryReference: input.lastConfirmedBeneficiaryReference,
    amountMinor: input.amountMinor,
    currency: input.currency,
    lastConfirmedAmountMinor: input.lastConfirmedAmountMinor,
  };
  return ObligationContextSchema.parse({
    schemaVersion: 1,
    lineId: `${occurrenceId}:${input.counterpartyRef}:${input.lineType}`,
    occurrenceId,
    obligationId: input.template.obligationId,
    obligationVersion: input.template.version,
    organizationId: input.template.organizationId,
    kind: input.template.kind,
    asOf: input.asOf,
    periodStart: input.period.periodStart,
    periodEnd: input.period.periodEnd,
    dueDate: input.dueDate ?? input.period.dueDate,
    counterpartyRef: input.counterpartyRef,
    displayName: input.displayName,
    lineType: input.lineType,
    ...amounts,
    components: [],
    evidence: input.evidence,
    signals: [],
    missingFields: obligationMissingFields(amounts),
    warnings: input.warnings ?? [],
  });
}

function snapshot(dataset: PayrollDataset | FiscalDataset, kind: "payroll_roster" | "fiscal_calendar"): ObligationContext["evidence"][number] {
  const sha256 = createHash("sha256").update(JSON.stringify(dataset)).digest("hex");
  return {
    snapshotId: `snap_${sha256.slice(0, 16)}`,
    source: "configured",
    kind,
    capturedAt: dataset.capturedAt,
    sha256,
  };
}

export function describeOccurrence(input: {
  template: ObligationTemplate;
  dataset: PayrollDataset | FiscalDataset;
  period: ObligationPeriod;
  asOf: string;
  lines: readonly ObligationContext[];
}): OccurrenceContext {
  const source = ConfiguredObligationSourceSchema.parse({ template: input.template, dataset: input.dataset });
  const period = ObligationPeriodSchema.parse(input.period);
  const asOf = UtcInstantSchema.parse(input.asOf);
  const usable = Date.parse(source.dataset.capturedAt) <= Date.parse(asOf);
  const occurrenceId = `${source.template.obligationId}:${period.periodStart}`;
  for (const line of input.lines) {
    if (line.occurrenceId !== occurrenceId || line.organizationId !== source.template.organizationId || line.kind !== source.template.kind) {
      throw new Error("La línea no pertenece a esta corrida");
    }
  }
  const expectedCounterparties =
    source.dataset.kind === "payroll"
      ? activePayrollCounterparties(source.dataset).map((employee) => employee.counterpartyRef)
      : fiscalItemsInPeriod(source.dataset, period).map((item) => item.counterpartyRef);
  const funds = {
    fundsAvailableMinor: usable ? source.dataset.fundsAvailableMinor : null,
    fundsReservedMinor: usable ? source.dataset.fundsReservedMinor : null,
    evidenceCapturedAt: usable ? source.dataset.capturedAt : null,
  };
  return OccurrenceContextSchema.parse({
    schemaVersion: 1,
    occurrenceId,
    obligationId: source.template.obligationId,
    obligationVersion: source.template.version,
    organizationId: source.template.organizationId,
    kind: source.template.kind,
    asOf,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    dueDate: period.dueDate,
    expectedCounterparties,
    lines: input.lines.map((line) => ({
      lineId: line.lineId,
      counterpartyRef: line.counterpartyRef,
      lineType: line.lineType,
      amountMinor: line.amountMinor,
      currency: line.currency,
    })),
    ...funds,
    missingFields: occurrenceMissingFields(funds),
  });
}

export function activePayrollCounterparties(dataset: PayrollDataset): PayrollEmployee[] {
  return dataset.employees.filter((employee) => employee.status === "active");
}

export function fiscalItemsInPeriod(dataset: FiscalDataset, period: ObligationPeriod): FiscalItem[] {
  return dataset.items.filter((item) => item.periodStart === period.periodStart && item.periodEnd === period.periodEnd);
}
