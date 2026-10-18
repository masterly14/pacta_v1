import { z } from "zod";
import { EntityIdSchema, UtcInstantSchema } from "./invoice-context.ts";

// Salida del motor determinístico de B (PLAN.md §6.2). `approved` = aprobado para pago SIMULADO.
// schemaVersion 1 sigue siendo la forma que escribe el motor de facturas.
// schemaVersion 2 añade `subject` para una línea de obligación sin dejar de leer decisiones viejas.

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const DecisionOutcomeSchema = z.enum(["approved", "blocked", "requires_approval"]);

export const DecisionSourceSchema = z.enum(["automatic", "human"]);

export const RuleResultSchema = z.enum(["pass", "fail", "unknown"]);

export const ReasonCodeSchema = z.enum([
  "SUPPLIER_NOT_AUTHORIZED",
  "DUPLICATE_INVOICE",
  "AMOUNT_LIMIT_EXCEEDED",
  "BUDGET_INSUFFICIENT",
  "CONTRACT_NOT_FOUND",
  "CONTRACT_MISMATCH",
  "INSUFFICIENT_DATA",
  "HUMAN_APPROVAL_REQUIRED",
  "RECURRENCE_NOT_AUTHORIZED",
  "AUTO_APPROVAL_RULES_PASSED",
  "BENEFICIARY_CHANGED",
  "CURRENCY_NOT_SUPPORTED",
  // Core proactivo. BUDGET_INSUFFICIENT es el presupuesto mensual de facturas;
  // FUNDS_INSUFFICIENT es la caja libre de una corrida.
  "EMPLOYEE_TERMINATED", // EMPLEADO_DESVINCULADO
  "EMPLOYEE_NOT_FOUND", // EMPLEADO_NO_ENCONTRADO
  "PAYROLL_OMISSION", // NOMINA_OMISION
  "VARIANCE_EXCEEDED", // VARIACION_EXCEDIDA
  "BENEFIT_MISMATCH", // BENEFICIO_NO_COINCIDE
  "DUPLICATE_LINE", // LINEA_DUPLICADA
  "FUNDS_INSUFFICIENT", // FONDOS_INSUFICIENTES
  "OBLIGATION_NOT_AUTHORIZED", // OBLIGACION_NO_AUTORIZADA
  "SETTLEMENT_UNCONFIRMED", // LIQUIDACION_NO_CONFIRMADA
  "SETTLEMENT_AMOUNT_MISMATCH", // MONTO_NO_COINCIDE_LIQUIDACION
  "DEADLINE_PASSED", // PLAZO_VENCIDO
  "DEADLINE_AT_RISK", // PLAZO_EN_RIESGO
  "STALE_EVIDENCE", // EVIDENCIA_DESACTUALIZADA
  "SIGNAL_PENDING_REVIEW", // SENAL_PENDIENTE_REVISION
]);

// factura | linea_nomina | pago_fiscal
export const DecisionSubjectTypeSchema = z.enum(["invoice", "payroll_line", "fiscal_payment"]);

export const DecisionSubjectSchema = z.strictObject({
  type: DecisionSubjectTypeSchema,
  id: EntityIdSchema,
});

// ---------------------------------------------------------------------------
// Evidencia consultada por el motor
// ---------------------------------------------------------------------------

export const DecisionEvidenceReferenceSchema = z.strictObject({
  type: z.enum([
    "invoice",
    "document",
    "invoice_evidence",
    "contract",
    "payment_policy",
    "payment_authorization",
    "bank_transaction",
    "payment_decision",
    "approval_request",
    "budget_snapshot",
    "obligation",
    "obligation_line",
    "evidence_snapshot",
    "inbox_signal",
  ]),
  id: EntityIdSchema,
  description: z.string().min(1).nullable(),
});

export const RuleEvaluationSchema = z.strictObject({
  ruleId: z.string().min(1),
  result: RuleResultSchema,
  reasonCode: ReasonCodeSchema.nullable(), // motivo asociado cuando el resultado no es 'pass'
  explanation: z.string().min(1),
  evidenceReferences: z.array(DecisionEvidenceReferenceSchema),
});

// ---------------------------------------------------------------------------
// PaymentDecision
// ---------------------------------------------------------------------------

const decisionCore = {
  decisionId: EntityIdSchema,
  organizationId: EntityIdSchema,
  evaluatedAt: UtcInstantSchema,
  policyVersion: z.int().positive().nullable(), // null solo si la política no pudo cargarse (fail-closed)
  decision: DecisionOutcomeSchema,
  reasonCodes: z.array(ReasonCodeSchema).min(1),
  explanation: z.string().min(1),
  rulesEvaluated: z.array(RuleEvaluationSchema),
  matchedPolicyIds: z.array(EntityIdSchema),
  evidenceReferences: z.array(DecisionEvidenceReferenceSchema),
  traceId: z.string().min(1).nullable(),
  approvalRequestId: EntityIdSchema.nullable(),
  approvedBy: EntityIdSchema.nullable(),
  decisionSource: DecisionSourceSchema,
  isSimulated: z.literal(true),
};

type DecisionCore = {
  decision: z.infer<typeof DecisionOutcomeSchema>;
  reasonCodes: z.infer<typeof ReasonCodeSchema>[];
  policyVersion: number | null;
  rulesEvaluated: z.infer<typeof RuleEvaluationSchema>[];
  decisionSource: z.infer<typeof DecisionSourceSchema>;
  approvedBy: string | null;
  approvalRequestId: string | null;
};

type IssueCtx = {
  addIssue: (issue: { code: "custom"; path: (string | number)[]; message: string }) => void;
};

function refinePaymentDecision(d: DecisionCore, ctx: IssueCtx) {
  const codes = new Set(d.reasonCodes);
  if (codes.size !== d.reasonCodes.length) {
    ctx.addIssue({ code: "custom", path: ["reasonCodes"], message: "reasonCodes contiene duplicados" });
  }

  if (d.decision === "approved") {
    if (d.policyVersion === null) {
      ctx.addIssue({ code: "custom", path: ["policyVersion"], message: "Una aprobación requiere versión de política" });
    }
    if (d.rulesEvaluated.length === 0) {
      ctx.addIssue({ code: "custom", path: ["rulesEvaluated"], message: "Una aprobación requiere reglas evaluadas" });
    }
  } else if (codes.has("AUTO_APPROVAL_RULES_PASSED")) {
    ctx.addIssue({ code: "custom", path: ["reasonCodes"], message: "AUTO_APPROVAL_RULES_PASSED solo es válido con 'approved'" });
  }

  if (d.decisionSource === "automatic") {
    if (d.approvedBy !== null) {
      ctx.addIssue({ code: "custom", path: ["approvedBy"], message: "Una decisión automática no tiene actor humano" });
    }
    if (d.decision === "approved") {
      // Desconocido/ambiguo nunca se aprueba automáticamente
      if (d.rulesEvaluated.some((rule) => rule.result !== "pass")) {
        ctx.addIssue({ code: "custom", path: ["rulesEvaluated"], message: "La aprobación automática exige que todas las reglas pasen" });
      }
      if (d.reasonCodes.length !== 1 || !codes.has("AUTO_APPROVAL_RULES_PASSED")) {
        ctx.addIssue({ code: "custom", path: ["reasonCodes"], message: "La aprobación automática solo admite AUTO_APPROVAL_RULES_PASSED" });
      }
    }
  }

  if (d.decisionSource === "human") {
    if (d.approvedBy === null) {
      ctx.addIssue({ code: "custom", path: ["approvedBy"], message: "Una decisión humana requiere actor" });
    }
    if (d.approvalRequestId === null) {
      ctx.addIssue({ code: "custom", path: ["approvalRequestId"], message: "Una decisión humana debe resolver una solicitud de aprobación" });
    }
    if (d.decision === "requires_approval") {
      ctx.addIssue({ code: "custom", path: ["decision"], message: "Una resolución humana debe ser 'approved' o 'blocked'" });
    }
    if (codes.has("AUTO_APPROVAL_RULES_PASSED")) {
      ctx.addIssue({ code: "custom", path: ["reasonCodes"], message: "AUTO_APPROVAL_RULES_PASSED no aplica a decisiones humanas" });
    }
  }

  for (const [index, rule] of d.rulesEvaluated.entries()) {
    if (rule.result !== "pass" && rule.reasonCode === null) {
      ctx.addIssue({ code: "custom", path: ["rulesEvaluated", index, "reasonCode"], message: "Una regla no superada requiere reasonCode" });
    }
  }
}

export const PaymentDecisionV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    invoiceId: EntityIdSchema,
    ...decisionCore,
  })
  .superRefine(refinePaymentDecision);

// Los escritores de facturas siguen usando la v1.
export const PaymentDecisionSchema = PaymentDecisionV1Schema;

export const PaymentDecisionV2Schema = z
  .strictObject({
    schemaVersion: z.literal(2),
    subject: DecisionSubjectSchema,
    invoiceId: EntityIdSchema.nullable(),
    ...decisionCore,
  })
  .superRefine((decision, ctx) => {
    refinePaymentDecision(decision, ctx);
    if (decision.subject.type === "invoice") {
      if (decision.invoiceId !== decision.subject.id) {
        ctx.addIssue({ code: "custom", path: ["invoiceId"], message: "En una factura invoiceId coincide con subject.id" });
      }
    } else if (decision.invoiceId !== null) {
      ctx.addIssue({ code: "custom", path: ["invoiceId"], message: "Una línea de obligación no lleva invoiceId" });
    }
  });

export function normalizeLegacyDecisionPayload(payload: unknown): PaymentDecisionV2 {
  const legacy = PaymentDecisionV1Schema.parse(payload);
  return PaymentDecisionV2Schema.parse({
    ...legacy,
    schemaVersion: 2,
    subject: { type: "invoice", id: legacy.invoiceId },
  });
}

export function parsePaymentDecision(input: unknown): PaymentDecisionV2 {
  if (isSchemaVersion(input, 1)) return normalizeLegacyDecisionPayload(input);
  return PaymentDecisionV2Schema.parse(input);
}

function isSchemaVersion(input: unknown, version: number): boolean {
  return typeof input === "object" && input !== null && "schemaVersion" in input && input.schemaVersion === version;
}

export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;
export type RuleEvaluation = z.infer<typeof RuleEvaluationSchema>;
export type DecisionEvidenceReference = z.infer<typeof DecisionEvidenceReferenceSchema>;
export type DecisionSubject = z.infer<typeof DecisionSubjectSchema>;
export type PaymentDecision = z.infer<typeof PaymentDecisionSchema>;
export type PaymentDecisionV2 = z.infer<typeof PaymentDecisionV2Schema>;
