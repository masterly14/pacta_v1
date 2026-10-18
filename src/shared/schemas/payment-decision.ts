import { z } from "zod";
import { EntityIdSchema, UtcInstantSchema } from "./invoice-context.ts";

// Salida del motor determinístico de B (PLAN.md §6.2). `aprobada` = aprobado para pago SIMULADO.

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const DecisionOutcomeSchema = z.enum(["aprobada", "bloqueada", "requiere_aprobacion"]);

export const DecisionSourceSchema = z.enum(["automatica", "humana"]);

export const RuleResultSchema = z.enum(["cumple", "incumple", "desconocido"]);

export const ReasonCodeSchema = z.enum([
  "PROVEEDOR_NO_AUTORIZADO",
  "FACTURA_DUPLICADA",
  "MONTO_EXCEDE_LIMITE",
  "PRESUPUESTO_INSUFICIENTE",
  "CONTRATO_NO_ENCONTRADO",
  "CONTRATO_NO_COINCIDE",
  "DATOS_INSUFICIENTES",
  "REQUIERE_APROBACION_HUMANA",
  "RECURRENCIA_NO_AUTORIZADA",
  "REGLAS_AUTOAPROBACION_CUMPLIDAS",
  "BENEFICIARIO_CAMBIADO",
  "MONEDA_NO_SOPORTADA",
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
  reasonCode: ReasonCodeSchema.nullable(), // motivo asociado cuando el resultado no es 'cumple'
  explanation: z.string().min(1),
  evidenceReferences: z.array(DecisionEvidenceReferenceSchema),
});

// ---------------------------------------------------------------------------
// PaymentDecision
// ---------------------------------------------------------------------------

const CurrentPaymentDecisionSchema = z
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

    if (d.decision === "aprobada") {
      if (d.policyVersion === null) {
        ctx.addIssue({ code: "custom", path: ["policyVersion"], message: "Una aprobación requiere versión de política" });
      }
      if (d.rulesEvaluated.length === 0) {
        ctx.addIssue({ code: "custom", path: ["rulesEvaluated"], message: "Una aprobación requiere reglas evaluadas" });
      }
    } else if (codes.has("REGLAS_AUTOAPROBACION_CUMPLIDAS")) {
      ctx.addIssue({ code: "custom", path: ["reasonCodes"], message: "REGLAS_AUTOAPROBACION_CUMPLIDAS solo es válido con 'aprobada'" });
    }

    if (d.decisionSource === "automatica") {
      if (d.approvedBy !== null) {
        ctx.addIssue({ code: "custom", path: ["approvedBy"], message: "Una decisión automática no tiene actor humano" });
      }
      if (d.decision === "aprobada") {
        // Desconocido/ambiguo nunca se aprueba automáticamente
        if (d.rulesEvaluated.some((rule) => rule.result !== "cumple")) {
          ctx.addIssue({ code: "custom", path: ["rulesEvaluated"], message: "La aprobación automática exige que todas las reglas pasen" });
        }
        if (d.reasonCodes.length !== 1 || !codes.has("REGLAS_AUTOAPROBACION_CUMPLIDAS")) {
          ctx.addIssue({ code: "custom", path: ["reasonCodes"], message: "La aprobación automática solo admite REGLAS_AUTOAPROBACION_CUMPLIDAS" });
        }
      }
    }

    if (d.decisionSource === "humana") {
      if (d.approvedBy === null) {
        ctx.addIssue({ code: "custom", path: ["approvedBy"], message: "Una decisión humana requiere actor" });
      }
      if (d.approvalRequestId === null) {
        ctx.addIssue({ code: "custom", path: ["approvalRequestId"], message: "Una decisión humana debe resolver una solicitud de aprobación" });
      }
      if (d.decision === "requiere_aprobacion") {
        ctx.addIssue({ code: "custom", path: ["decision"], message: "Una resolución humana debe ser 'aprobada' o 'bloqueada'" });
      }
      if (codes.has("REGLAS_AUTOAPROBACION_CUMPLIDAS")) {
        ctx.addIssue({ code: "custom", path: ["reasonCodes"], message: "REGLAS_AUTOAPROBACION_CUMPLIDAS no aplica a decisiones humanas" });
      }
    }

    for (const [index, rule] of d.rulesEvaluated.entries()) {
      if (rule.result !== "cumple" && rule.reasonCode === null) {
        ctx.addIssue({ code: "custom", path: ["rulesEvaluated", index, "reasonCode"], message: "Una regla no superada requiere reasonCode" });
      }
    }
  });

// Decisiones guardadas antes de pasar los valores a español (tabla append-only: no se reescriben).
// Solo traduce valores conocidos de cadenas completas; cualquier otra cosa sigue al esquema estricto.
const LEGACY_VALUES: Record<string, string> = {
  approved: "aprobada", blocked: "bloqueada", requires_approval: "requiere_aprobacion",
  automatic: "automatica", human: "humana",
  pass: "cumple", fail: "incumple", unknown: "desconocido",
  SUPPLIER_NOT_AUTHORIZED: "PROVEEDOR_NO_AUTORIZADO", DUPLICATE_INVOICE: "FACTURA_DUPLICADA",
  AMOUNT_LIMIT_EXCEEDED: "MONTO_EXCEDE_LIMITE", BUDGET_INSUFFICIENT: "PRESUPUESTO_INSUFICIENTE",
  CONTRACT_NOT_FOUND: "CONTRATO_NO_ENCONTRADO", CONTRACT_MISMATCH: "CONTRATO_NO_COINCIDE",
  INSUFFICIENT_DATA: "DATOS_INSUFICIENTES", HUMAN_APPROVAL_REQUIRED: "REQUIERE_APROBACION_HUMANA",
  RECURRENCE_NOT_AUTHORIZED: "RECURRENCIA_NO_AUTORIZADA", AUTO_APPROVAL_RULES_PASSED: "REGLAS_AUTOAPROBACION_CUMPLIDAS",
  BENEFICIARY_CHANGED: "BENEFICIARIO_CAMBIADO", CURRENCY_NOT_SUPPORTED: "MONEDA_NO_SOPORTADA",
  essential_fields_present: "campos_esenciales_presentes", no_extraction_warnings: "sin_advertencias_extraccion",
  currency_supported: "moneda_soportada", not_duplicate: "no_es_duplicada", supplier_authorized: "proveedor_autorizado",
  beneficiary_matches_authorization: "beneficiario_coincide_con_autorizacion",
  within_authorization_limit: "dentro_limite_autorizacion", within_policy_auto_limit: "dentro_limite_politica_auto",
  contract_consistent: "contrato_consistente", budget_available: "presupuesto_disponible",
};

function legacyValue(value: unknown): unknown {
  return typeof value === "string" && Object.hasOwn(LEGACY_VALUES, value) ? LEGACY_VALUES[value] : value;
}

export function normalizeLegacyDecisionPayload(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const payload = raw as Record<string, unknown>;
  return {
    ...payload,
    decision: legacyValue(payload.decision),
    decisionSource: legacyValue(payload.decisionSource),
    reasonCodes: Array.isArray(payload.reasonCodes) ? payload.reasonCodes.map(legacyValue) : payload.reasonCodes,
    rulesEvaluated: Array.isArray(payload.rulesEvaluated)
      ? payload.rulesEvaluated.map((rule) =>
          typeof rule === "object" && rule !== null
            ? { ...rule, ruleId: legacyValue((rule as Record<string, unknown>).ruleId), result: legacyValue((rule as Record<string, unknown>).result), reasonCode: legacyValue((rule as Record<string, unknown>).reasonCode) }
            : rule,
        )
      : payload.rulesEvaluated,
  };
}

export const PaymentDecisionSchema = z.preprocess(normalizeLegacyDecisionPayload, CurrentPaymentDecisionSchema);

export type DecisionOutcome = z.infer<typeof DecisionOutcomeSchema>;
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;
export type RuleEvaluation = z.infer<typeof RuleEvaluationSchema>;
export type DecisionEvidenceReference = z.infer<typeof DecisionEvidenceReferenceSchema>;
export type PaymentDecision = z.infer<typeof PaymentDecisionSchema>;
