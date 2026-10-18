/**
 * Purpose: the payment decision engine; combines the ten rules into approved, blocked
 *   or requires_approval with reasons and evidence.
 * Runs in: server only in the app (via evaluateInvoice(), pending) and in tests. Pure.
 * Triggered by: a call to decide(invoice, facts); never by the LLM or an incoming email.
 * Receives → Returns: (unknown InvoiceContext, unknown EngineFacts) → PaymentDecision,
 *   validated by PaymentDecisionSchema; throws if either input is invalid.
 * Talks to: ./rules.ts, ./facts.ts, src/shared/schemas/*. No database, network, AI or clock.
 */
import { InvoiceContextSchema } from "@/shared/schemas/invoice-context";
import {
  PaymentDecisionSchema,
  type DecisionEvidenceReference,
  type DecisionOutcome,
  type PaymentDecision,
  type ReasonCode,
} from "@/shared/schemas/payment-decision";
import { EngineFactsSchema } from "./facts";
import { RULES, type RuleOutcome } from "./rules";

// Motor determinístico: sin BD, IA, red ni reloj. Mismas entradas → misma decisión.
// Lanza si la factura o los hechos no cumplen su esquema: quien llama no debe aprobar.
export function decide(invoiceInput: unknown, factsInput: unknown): PaymentDecision {
  const invoice = InvoiceContextSchema.parse(invoiceInput);
  const facts = EngineFactsSchema.parse(factsInput);

  const outcomes = RULES.map((rule) => rule(invoice, facts));
  const decision = combine(outcomes);

  const result: PaymentDecision = {
    schemaVersion: 1,
    decisionId: facts.decisionId,
    invoiceId: invoice.invoiceId,
    organizationId: invoice.organizationId,
    evaluatedAt: facts.now,
    policyVersion: facts.policy?.version ?? null,
    decision,
    reasonCodes: reasonCodes(decision, outcomes),
    explanation: explanation(decision, outcomes),
    rulesEvaluated: outcomes.map(({ ruleId, result, reasonCode, explanation, evidenceReferences }) => ({
      ruleId,
      result,
      reasonCode,
      explanation,
      evidenceReferences,
    })),
    matchedPolicyIds: facts.policy === null ? [] : [facts.policy.policyId],
    evidenceReferences: evidence(invoice.invoiceId, invoice.documentId, outcomes),
    traceId: facts.traceId,
    approvalRequestId: null,
    approvedBy: null,
    decisionSource: "automatic",
    isSimulated: true,
  };

  // Última barrera: una aprobación automática inválida lanza en vez de devolverse.
  return PaymentDecisionSchema.parse(result);
}

export function combine(outcomes: readonly RuleOutcome[]): DecisionOutcome {
  if (outcomes.some((o) => o.result === "fail" && o.hardBlock)) {
    return "blocked";
  }
  if (outcomes.length === 0 || outcomes.some((o) => o.result !== "pass")) {
    return "requires_approval";
  }
  return "approved";
}

function reasonCodes(decision: DecisionOutcome, outcomes: readonly RuleOutcome[]): ReasonCode[] {
  if (decision === "approved") {
    return ["AUTO_APPROVAL_RULES_PASSED"];
  }
  const codes = new Set<ReasonCode>();
  for (const outcome of outcomes) {
    if (outcome.result !== "pass" && outcome.reasonCode !== null) {
      codes.add(outcome.reasonCode);
    }
  }
  if (decision === "requires_approval") {
    codes.add("HUMAN_APPROVAL_REQUIRED");
  }
  return [...codes];
}

function explanation(decision: DecisionOutcome, outcomes: readonly RuleOutcome[]): string {
  if (decision === "approved") {
    return `Se cumplieron las ${outcomes.length} reglas. Aprobada para pago simulado.`;
  }
  const problems = outcomes.filter((o) => o.result !== "pass").map((o) => o.explanation);
  const prefix = decision === "blocked" ? "Bloqueada" : "Requiere aprobación humana";
  return `${prefix}: ${problems.join(" ")}`;
}

function evidence(
  invoiceId: string,
  documentId: string | null,
  outcomes: readonly RuleOutcome[],
): DecisionEvidenceReference[] {
  const refs: DecisionEvidenceReference[] = [{ type: "invoice", id: invoiceId, description: null }];
  if (documentId !== null) {
    refs.push({ type: "document", id: documentId, description: null });
  }
  const seen = new Set(refs.map((r) => `${r.type}:${r.id}`));
  for (const ref of outcomes.flatMap((o) => o.evidenceReferences)) {
    const key = `${ref.type}:${ref.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push(ref);
    }
  }
  return refs;
}
