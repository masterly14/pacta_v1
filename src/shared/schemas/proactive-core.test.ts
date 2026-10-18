import { describe, expect, it } from "vitest";
import { ANOMALY_CATALOG, VERIFIED_TERMINATION_EFFECT, failureOutcome, isAbsoluteBlock, rulesFor } from "../obligations/anomaly-catalog";
import { createDemoClock } from "../ports/clock";
import { createMemoryInboxSignals } from "../ports/memory-inbox-signals";
import { createMemoryObligationSource, describeOccurrence } from "../ports/memory-obligation-source";
import {
  AttachableInboxSignalSchema,
  InboundMailClassSchema,
  InboxSignalSchema,
} from "./inbox-signal";
import {
  ConfiguredObligationSourceSchema,
  ObligationTemplateSchema,
  PayrollDatasetSchema,
  PayrollEmployeeSchema,
  type FiscalDataset,
  type ObligationTemplate,
  type PayrollDataset,
} from "./obligation-config";
import { ObligationContextSchema, OccurrenceContextSchema, decisionKey } from "./obligation-context";
import { normalizeLegacyDecisionPayload, parsePaymentDecision, PaymentDecisionV2Schema } from "./payment-decision";

const ORG = "org_andina";
const SHA = "a".repeat(64);

function rawTemplate(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    obligationId: "obl_nomina",
    organizationId: ORG,
    kind: "payroll",
    calendar: { kind: "payroll", frequency: "monthly", anchor: "month_end" },
    currency: "COP",
    runCapMinor: 80_000_000,
    version: 1,
    status: "active",
    activatedBy: "user_admin",
    activatedAt: "2026-10-01T12:00:00Z",
    dataOrigin: "fixture",
    ...overrides,
  };
}

function template(overrides: Record<string, unknown> = {}): ObligationTemplate {
  return ObligationTemplateSchema.parse(rawTemplate(overrides));
}

function employee(overrides: Record<string, unknown> = {}) {
  return {
    counterpartyRef: "emp_laura",
    displayName: "Laura Gómez",
    status: "active",
    baseSalaryMinor: 4_000_000,
    beneficiaryAccountReference: "****1234",
    lastConfirmedBeneficiaryReference: "****1234",
    lastConfirmedAmountMinor: 4_000_000,
    ...overrides,
  };
}

function rawPayrollDataset(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    kind: "payroll",
    organizationId: ORG,
    currency: "COP",
    capturedAt: "2026-10-17T12:00:00Z",
    dataOrigin: "fixture",
    fundsAvailableMinor: 90_000_000,
    fundsReservedMinor: 0,
    employees: [employee(), employee({ counterpartyRef: "emp_andres", displayName: "Andrés Pérez", status: "terminated" })],
    benefits: [
      { counterpartyRef: "emp_laura", lineType: "bonus", periodStart: "2026-10-01", expectedAmountMinor: 2_000_000 },
      { counterpartyRef: "emp_laura", lineType: "bonus", periodStart: "2026-06-01", expectedAmountMinor: 2_000_000 },
    ],
    ...overrides,
  };
}

function payrollDataset(overrides: Record<string, unknown> = {}): PayrollDataset {
  return PayrollDatasetSchema.parse(rawPayrollDataset(overrides));
}

function period() {
  return { periodStart: "2026-10-01", periodEnd: "2026-10-31", dueDate: "2026-10-31" };
}

function line(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    lineId: "line_laura_salary",
    occurrenceId: "occ_oct",
    obligationId: "obl_nomina",
    obligationVersion: 1,
    organizationId: ORG,
    kind: "payroll",
    asOf: "2026-10-31T23:00:00Z",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    dueDate: "2026-10-31",
    counterpartyRef: "emp_laura",
    displayName: "Laura Gómez",
    beneficiaryAccountReference: "****1234",
    lastConfirmedBeneficiaryReference: "****1234",
    lineType: "salary",
    amountMinor: 4_000_000,
    currency: "COP",
    components: [],
    lastConfirmedAmountMinor: 4_000_000,
    evidence: [{ snapshotId: "snap_1", source: "configured", kind: "payroll_roster", capturedAt: "2026-10-17T12:00:00Z", sha256: SHA }],
    signals: [],
    missingFields: [],
    warnings: [],
    ...overrides,
  };
}

function signal(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    signalId: "sig_1",
    organizationId: ORG,
    gmailInboundMessageId: "gim_1",
    kind: "employment_event",
    subtype: "termination",
    subjectRef: { type: "counterparty", id: "emp_laura" },
    payload: { counterpartyHint: "Laura Gómez" },
    status: "proposed",
    evidence: { excerpt: "Laura Gómez deja de laborar", gmailInboundMessageId: "gim_1" },
    reviewedBy: null,
    reviewedAt: null,
    ...overrides,
  };
}

function legacyDecision() {
  return {
    schemaVersion: 1,
    decisionId: "dec_1",
    invoiceId: "inv_1",
    organizationId: ORG,
    evaluatedAt: "2026-10-17T16:00:00Z",
    policyVersion: null,
    decision: "requires_approval",
    reasonCodes: ["INSUFFICIENT_DATA"],
    explanation: "Faltan datos de la factura",
    rulesEvaluated: [
      {
        ruleId: "datos_suficientes",
        result: "unknown",
        reasonCode: "INSUFFICIENT_DATA",
        explanation: "Faltan datos de la factura",
        evidenceReferences: [],
      },
    ],
    matchedPolicyIds: [],
    evidenceReferences: [{ type: "invoice", id: "inv_1", description: null }],
    traceId: null,
    approvalRequestId: null,
    approvedBy: null,
    decisionSource: "automatic",
    isSimulated: true,
  };
}

describe("obligación configurada", () => {
  it("acepta una plantilla activa y aplica la tolerancia por defecto", () => {
    const parsed = ObligationTemplateSchema.parse(template());
    expect(parsed.varianceToleranceBps).toBe(1000);
    expect(parsed.evidenceMaxAgeDays).toBe(7);
    expect(parsed.earlyAlertDays).toBe(7);
    expect(parsed.urgentAlertDays).toBe(3);
  });

  it("rechaza una plantilla activa sin quien la activó", () => {
    expect(ObligationTemplateSchema.safeParse(rawTemplate({ activatedBy: null, activatedAt: null })).success).toBe(false);
  });

  it("rechaza un borrador que ya trae activación", () => {
    expect(ObligationTemplateSchema.safeParse(rawTemplate({ status: "draft" })).success).toBe(false);
  });

  it("rechaza una cuenta sin enmascarar", () => {
    expect(PayrollEmployeeSchema.safeParse(employee({ beneficiaryAccountReference: "1234567890" })).success).toBe(false);
  });

  it("rechaza un dataset cuya moneda no es la de la plantilla", () => {
    const result = ConfiguredObligationSourceSchema.safeParse({
      template: rawTemplate(),
      dataset: rawPayrollDataset({ currency: "USD" }),
    });
    expect(result.success).toBe(false);
  });

  it("acepta la fuente configurada cuando plantilla y dataset coinciden", () => {
    const parsed = ConfiguredObligationSourceSchema.parse({ template: template(), dataset: payrollDataset() });
    expect(parsed.dataset.kind).toBe("payroll");
  });
});

describe("ObligationContext", () => {
  it("acepta una línea de nómina con evidencia configurada", () => {
    const parsed = ObligationContextSchema.parse(line());
    expect(parsed.evidence[0]?.source).toBe("configured");
  });

  it("rechaza 0 como sustituto de un importe desconocido", () => {
    expect(ObligationContextSchema.safeParse(line({ amountMinor: 0 })).success).toBe(false);
  });

  it("rechaza un importe sin moneda", () => {
    expect(ObligationContextSchema.safeParse(line({ currency: null, missingFields: ["currency"] })).success).toBe(false);
  });

  it("exige que un null figure en missingFields", () => {
    expect(ObligationContextSchema.safeParse(line({ lastConfirmedAmountMinor: null })).success).toBe(false);
    const parsed = ObligationContextSchema.parse(line({ lastConfirmedAmountMinor: null, missingFields: ["lastConfirmedAmountMinor"] }));
    expect(parsed.missingFields).toEqual(["lastConfirmedAmountMinor"]);
  });

  it("rechaza una cuenta sin enmascarar en la línea", () => {
    expect(ObligationContextSchema.safeParse(line({ beneficiaryAccountReference: "1234567890" })).success).toBe(false);
  });

  it("rechaza un impuesto dentro de una obligación de nómina", () => {
    expect(ObligationContextSchema.safeParse(line({ lineType: "tax" })).success).toBe(false);
  });

  it("arma la clave de idempotencia y rechaza un hash que no es sha256", () => {
    expect(decisionKey("occ_oct", "line_laura_salary", SHA)).toEqual({
      occurrenceId: "occ_oct",
      lineId: "line_laura_salary",
      evidenceSha256: SHA,
    });
    expect(() => decisionKey("occ_oct", "line_laura_salary", "no-es-hash")).toThrow();
  });
});

describe("OccurrenceContext", () => {
  it("rechaza un periodo invertido", () => {
    const occurrence = {
      schemaVersion: 1,
      occurrenceId: "occ_oct",
      obligationId: "obl_nomina",
      obligationVersion: 1,
      organizationId: ORG,
      kind: "payroll",
      asOf: "2026-10-31T23:00:00Z",
      periodStart: "2026-10-31",
      periodEnd: "2026-10-01",
      dueDate: "2026-10-31",
      expectedCounterparties: ["emp_laura"],
      lines: [],
      fundsAvailableMinor: 90_000_000,
      fundsReservedMinor: 0,
      evidenceCapturedAt: "2026-10-17T12:00:00Z",
      missingFields: [],
    };
    expect(OccurrenceContextSchema.safeParse(occurrence).success).toBe(false);
  });
});

describe("InboxSignal", () => {
  it("acepta una señal propuesta sin contraparte resuelta", () => {
    const parsed = InboxSignalSchema.parse(signal({ subjectRef: null }));
    expect(parsed.status).toBe("proposed");
    expect(AttachableInboxSignalSchema.safeParse(signal({ subjectRef: null })).success).toBe(false);
  });

  it("rechaza un retiro verificado sin revisor", () => {
    const verified = signal({ status: "verified", reviewedBy: null, reviewedAt: null });
    expect(InboxSignalSchema.safeParse(verified).success).toBe(false);
  });

  it("acepta la verificación cuando hay actor y momento", () => {
    const parsed = InboxSignalSchema.parse(signal({ status: "verified", reviewedBy: "user_admin", reviewedAt: "2026-10-18T15:00:00Z" }));
    expect(parsed.status).toBe("verified");
    expect(AttachableInboxSignalSchema.safeParse(parsed).success).toBe(true);
  });

  it("deja la factura en su clase, sin señal", () => {
    expect(InboundMailClassSchema.parse({ class: "invoice" })).toEqual({ class: "invoice" });
  });

  it("rechaza una liquidación fiscal clasificada como novedad laboral", () => {
    const tax = {
      schemaVersion: 1,
      signalId: "sig_tax",
      organizationId: ORG,
      gmailInboundMessageId: "gim_2",
      kind: "tax_settlement",
      subjectRef: null,
      payload: {
        fiscalType: "vat",
        periodStart: "2026-10-01",
        periodEnd: "2026-10-31",
        amountMinor: 150_000,
        currency: "COP",
        paymentReference: "****9876",
      },
      status: "proposed",
      evidence: { excerpt: "Liquidación de IVA octubre", gmailInboundMessageId: "gim_2" },
      reviewedBy: null,
      reviewedAt: null,
    };
    expect(InboundMailClassSchema.safeParse({ class: "employment_event", signal: tax }).success).toBe(false);
    expect(InboundMailClassSchema.parse({ class: "tax_settlement", signal: tax }).class).toBe("tax_settlement");
  });

  it("rechaza un monto 0 dentro de la liquidación extraída del correo", () => {
    const tax = {
      schemaVersion: 1,
      signalId: "sig_tax_zero",
      organizationId: ORG,
      gmailInboundMessageId: "gim_3",
      kind: "tax_settlement",
      subjectRef: null,
      payload: {
        fiscalType: "vat",
        periodStart: null,
        periodEnd: null,
        amountMinor: 0,
        currency: "COP",
        paymentReference: null,
      },
      status: "proposed",
      evidence: { excerpt: "IVA en cero", gmailInboundMessageId: "gim_3" },
      reviewedBy: null,
      reviewedAt: null,
    };
    expect(InboxSignalSchema.safeParse(tax).success).toBe(false);
  });
});

describe("PaymentDecision v2", () => {
  it("normaliza una decisión v1 de factura a subject invoice", () => {
    const normalized = normalizeLegacyDecisionPayload(legacyDecision());
    expect(normalized.schemaVersion).toBe(2);
    expect(normalized.subject).toEqual({ type: "invoice", id: "inv_1" });
    expect(normalized.invoiceId).toBe("inv_1");
    expect(parsePaymentDecision(legacyDecision()).decisionId).toBe("dec_1");
  });

  it("acepta una línea de nómina sin invoiceId y rechaza uno puesto", () => {
    const base = { ...normalizeLegacyDecisionPayload(legacyDecision()), invoiceId: null, subject: { type: "payroll_line", id: "line_laura_salary" } };
    expect(PaymentDecisionV2Schema.parse(base).subject.type).toBe("payroll_line");
    expect(PaymentDecisionV2Schema.safeParse({ ...base, invoiceId: "inv_1" }).success).toBe(false);
  });
});

describe("catálogo de anomalías", () => {
  const payrollRules = [
    "obligacion_autorizada",
    "evidencia_vigente",
    "corrida_completa",
    "fondos_suficientes",
    "linea_esperada",
    "empleado_activo",
    "empleado_sin_licencia",
    "cuenta_estable",
    "variacion_aceptable",
    "beneficios_esperados",
    "sin_linea_duplicada",
    "sin_senales_pendientes",
  ];
  const fiscalRules = [
    "obligacion_autorizada",
    "liquidacion_confirmada",
    "monto_coincide_con_liquidacion",
    "referencia_pago_estable",
    "periodo_no_pagado",
    "dentro_de_plazo",
    "fondos_suficientes",
  ];

  it("cubre las reglas de nómina y fiscales, salvo consistente_con_nomina", () => {
    for (const ruleId of payrollRules) {
      expect(ANOMALY_CATALOG.some((rule) => rule.ruleId === ruleId && rule.appliesTo === "payroll")).toBe(true);
    }
    for (const ruleId of fiscalRules) {
      expect(ANOMALY_CATALOG.some((rule) => rule.ruleId === ruleId && rule.appliesTo === "fiscal")).toBe(true);
    }
    expect(ANOMALY_CATALOG.some((rule) => rule.ruleId === "consistente_con_nomina")).toBe(false);
  });

  it("no usa ningún código como camino hacia approved", () => {
    for (const rule of ANOMALY_CATALOG) {
      expect(rule.outcome === "requires_approval" || rule.outcome === "blocked").toBe(true);
      expect(rule.reasonCode).not.toBe("AUTO_APPROVAL_RULES_PASSED");
      for (const extra of rule.alsoReasonCodes ?? []) expect(extra).not.toBe("AUTO_APPROVAL_RULES_PASSED");
    }
    expect(VERIFIED_TERMINATION_EFFECT.outcome).toBe("blocked");
    expect(VERIFIED_TERMINATION_EFFECT.reasonCode).toBe("EMPLOYEE_TERMINATED");
  });

  it("bloquea al desvinculado en la línea ordinaria y escala la liquidación final", () => {
    const rule = rulesFor("payroll", "line").find((entry) => entry.ruleId === "empleado_activo");
    expect(rule).toBeDefined();
    if (!rule) return;
    expect(isAbsoluteBlock(rule, "salary")).toBe(true);
    expect(failureOutcome(rule, "salary")).toBe("blocked");
    expect(isAbsoluteBlock(rule, "final_settlement")).toBe(false);
    expect(failureOutcome(rule, "final_settlement")).toBe("requires_approval");
  });

  it("deja la omisión de nómina en la corrida", () => {
    expect(rulesFor("payroll", "run").some((rule) => rule.reasonCode === "PAYROLL_OMISSION")).toBe(true);
  });
});

describe("fuente configurada en memoria", () => {
  const source = createMemoryObligationSource({ payroll: { template: template(), dataset: payrollDataset() } });
  const asOf = "2026-10-31T23:00:00Z";

  it("genera el salario, la prima del mes y no la de otro mes", () => {
    const lines = source.generateLines(template(), payrollDataset(), period(), asOf);
    const types = lines.filter((row) => row.counterpartyRef === "emp_laura").map((row) => row.lineType);
    expect(types).toEqual(["salary", "bonus"]);
    expect(lines.some((row) => row.counterpartyRef === "emp_andres" && row.lineType === "salary")).toBe(true);
    expect(lines.every((row) => row.evidence[0]?.source === "configured")).toBe(true);
  });

  it("espera solo a los empleados activos en la corrida", () => {
    const lines = source.generateLines(template(), payrollDataset(), period(), asOf);
    const occurrence = describeOccurrence({ template: template(), dataset: payrollDataset(), period: period(), asOf, lines });
    expect(occurrence.expectedCounterparties).toEqual(["emp_laura"]);
    expect(occurrence.lines.some((row) => row.counterpartyRef === "emp_andres")).toBe(true);
  });

  it("devuelve el hecho de la contraparte y calla si la evidencia es futura", () => {
    expect(source.getFacts("emp_andres", asOf)).toMatchObject({ kind: "payroll", employee: { status: "terminated" } });
    expect(source.generateLines(template(), payrollDataset(), period(), "2026-10-01T00:00:00Z")).toEqual([]);
    expect(source.getFacts("emp_laura", "2026-10-01T00:00:00Z")).toBeNull();
  });

  it("devuelve null cuando la misma referencia está en nómina y en fiscal", () => {
    const fiscal: FiscalDataset = {
      schemaVersion: 1,
      kind: "fiscal",
      organizationId: ORG,
      currency: "COP",
      capturedAt: "2026-10-17T12:00:00Z",
      dataOrigin: "fixture",
      fundsAvailableMinor: 10_000,
      fundsReservedMinor: 0,
      items: [
        {
          counterpartyRef: "emp_laura",
          displayName: "DIAN IVA",
          fiscalType: "vat",
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
          dueDate: "2026-11-12",
          settlementStatus: "confirmed",
          settlementAmountMinor: 150_000,
          authorizedPaymentReference: "****9876",
          beneficiaryAccountReference: "****9876",
        },
      ],
    };
    const mixed = createMemoryObligationSource({
      payroll: { template: template(), dataset: payrollDataset() },
      fiscal: {
        template: template({
          obligationId: "obl_fiscal",
          kind: "fiscal",
          calendar: { kind: "fiscal", frequency: "monthly" },
        }),
        dataset: fiscal,
      },
    });
    expect(mixed.getFacts("emp_laura", asOf)).toBeNull();
  });
});

describe("InboxSignals en memoria", () => {
  const port = createMemoryInboxSignals([
    signal(),
    signal({
      signalId: "sig_descartada",
      status: "dismissed",
      reviewedBy: "user_admin",
      reviewedAt: "2026-10-18T15:00:00Z",
    }),
  ]);

  it("entrega la señal propuesta y omite la descartada", () => {
    const listed = port.listForCounterparties(ORG, ["emp_laura"], period());
    expect(listed.map((row) => row.signalId)).toEqual(["sig_1"]);
  });
});

describe("reloj de demo", () => {
  it("avanza solo cuando alguien lo mueve", () => {
    const clock = createDemoClock(new Date("2026-10-01T00:00:00Z"));
    expect(clock.now().toISOString()).toBe("2026-10-01T00:00:00.000Z");
    clock.set(new Date("2026-10-31T23:00:00Z"));
    expect(clock.now().toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(clock.mode).toBe("demo");
  });
});

describe("dataset de nómina", () => {
  it("rechaza dos empleados con la misma referencia", () => {
    expect(PayrollDatasetSchema.safeParse(rawPayrollDataset({ employees: [employee(), employee()] })).success).toBe(false);
  });
});
