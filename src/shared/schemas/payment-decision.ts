import { z } from "zod";
import { EntityIdSchema, UtcInstantSchema } from "./invoice-context.ts";

// Salida del motor determinístico de B (PLAN.md §6.2). `approved` = aprobado para pago SIMULADO.

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
]);

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

export const PaymentDecisionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),

    // Identidad
    decisionId: EntityIdSchema,
    invoiceId: EntityIdSchema,
    organizationId: EntityIdSchema,
    evaluatedAt: UtcInstantSchema,
    policyVersion: z.int().positive().nullable(), // null solo si la política no pudo cargarse (fail-closed)

    // Resultado
    decision: DecisionOutcomeSchema,
    reasonCodes: z.array(ReasonCodeSchema).min(1),
    explanation: z.string().min(1),

    // Reglas
    rulesEvaluated: z.array(RuleEvaluationSchema),

    // Auditoría
    matchedPolicyIds: z.array(EntityIdSchema),
    evidenceReferences: z.array(DecisionEvidenceReferenceSchema),
    traceId: z.string().min(1).nullable(),

    // Intervención humana. `approvedBy` es el actor humano que resolvió (aprueba o bloquea).
    approvalRequestId: EntityIdSchema.nullable(),
    approvedBy: EntityIdSchema.nullable(),
    decisionSource: DecisionSourceSchema,

    // Simulación: siempre true en la hackathon
    isSimulated: z.literal(true),
  })
  .superRefine((d, ctx) => {
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
  });

export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;
export type RuleEvaluation = z.infer<typeof RuleEvaluationSchema>;
export type DecisionEvidenceReference = z.infer<typeof DecisionEvidenceReferenceSchema>;
export type PaymentDecision = z.infer<typeof PaymentDecisionSchema>;
