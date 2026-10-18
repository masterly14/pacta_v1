/**
 * Purpose: the ten deterministic payment rules, in fixed order (RULES).
 * Runs in: server and tests (pure, no I/O, no AI).
 * Triggered by: decide(), which runs every rule for each invoice.
 * Receives → Returns: (InvoiceContext, EngineFacts) → RuleOutcome (pass | fail | unknown,
 *   reason code, explanation, evidence, hardBlock flag).
 * Talks to: ./facts.ts and the shared Zod schemas (types only).
 */
import type { InvoiceContext } from "@/shared/schemas/invoice-context";
import type { DecisionEvidenceReference, RuleEvaluation } from "@/shared/schemas/payment-decision";
import type { EngineAuthorization, EngineFacts, EnginePriorDecision } from "./facts";

// Resultado interno de una regla. `hardBlock` marca un bloqueo absoluto (duplicado
// confirmado, presupuesto insuficiente) y no se publica en PaymentDecision.
export type RuleOutcome = RuleEvaluation & { hardBlock: boolean };

type Rule = (invoice: InvoiceContext, facts: EngineFacts) => RuleOutcome;

const P0_CURRENCY = "USD";

function pass(ruleId: string, explanation: string, evidenceReferences: DecisionEvidenceReference[] = []): RuleOutcome {
  return { ruleId, result: "cumple", reasonCode: null, explanation, evidenceReferences, hardBlock: false };
}

function fail(
  ruleId: string,
  reasonCode: NonNullable<RuleEvaluation["reasonCode"]>,
  explanation: string,
  evidenceReferences: DecisionEvidenceReference[] = [],
  hardBlock = false,
): RuleOutcome {
  return { ruleId, result: "incumple", reasonCode, explanation, evidenceReferences, hardBlock };
}

function unknown(
  ruleId: string,
  reasonCode: NonNullable<RuleEvaluation["reasonCode"]>,
  explanation: string,
): RuleOutcome {
  return { ruleId, result: "desconocido", reasonCode, explanation, evidenceReferences: [], hardBlock: false };
}

// Formato solo para explicaciones; sin floats. Fuera de USD se muestran unidades menores.
export function formatAmount(amountMinor: number, currency: string): string {
  if (currency !== "USD") {
    return `${amountMinor} minor units ${currency}`;
  }
  const cents = String(amountMinor % 100).padStart(2, "0");
  return `${Math.trunc(amountMinor / 100)}.${cents} USD`;
}

function today(facts: EngineFacts): string {
  return facts.now.slice(0, 10); // `now` es UTC con sufijo Z
}

// "VER-2026-10", "ver 2026 10" y "VER_2026_10" son el mismo número.
export function normalizeInvoiceNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Decisiones son solo inserción: una factura puede tener varias filas. Vale la más reciente.
export function latestDecisionPerInvoice(priors: readonly EnginePriorDecision[]): EnginePriorDecision[] {
  const latest = new Map<string, EnginePriorDecision>();
  for (const prior of priors) {
    const current = latest.get(prior.invoiceId);
    if (current === undefined || Date.parse(prior.evaluatedAt) >= Date.parse(current.evaluatedAt)) {
      latest.set(prior.invoiceId, prior);
    }
  }
  return [...latest.values()];
}

// Única definición de "autorización aplicable". Cada etapa añade una dimensión, de modo
// que las reglas 4, 5 y 6 siempre hablan de la misma autorización.
export type AuthorizationMatch = {
  valid: EngineAuthorization[]; // activa, del proveedor, vigente hoy y en la fecha de factura
  available: EngineAuthorization[]; // además, sin usar en su periodo actual
  sameAccount: EngineAuthorization[]; // además, misma cuenta beneficiaria
  sameCurrency: EngineAuthorization[]; // además, misma moneda
};

export function matchAuthorizations(invoice: InvoiceContext, facts: EngineFacts): AuthorizationMatch {
  if (invoice.supplierId === null) {
    return { valid: [], available: [], sameAccount: [], sameCurrency: [] };
  }
  const dates = invoice.invoiceDate === null ? [today(facts)] : [today(facts), invoice.invoiceDate];
  const valid = facts.authorizations.filter(
    (auth) =>
      auth.status === "active" &&
      auth.supplierId === invoice.supplierId &&
      dates.every((date) => auth.validFrom <= date && date <= auth.validUntil),
  );
  const available = valid.filter((auth) => auth.approvalsInCurrentPeriod === 0);
  const sameAccount =
    invoice.beneficiaryAccountReference === null
      ? []
      : available.filter((auth) => auth.beneficiaryAccountRef === invoice.beneficiaryAccountReference);
  const sameCurrency = sameAccount.filter((auth) => auth.currency === invoice.currency);
  return { valid, available, sameAccount, sameCurrency };
}

const authorizationRef = (auth: EngineAuthorization): DecisionEvidenceReference => ({
  type: "payment_authorization",
  id: auth.authorizationId,
  description: null,
});

const priorRef = (prior: EnginePriorDecision): DecisionEvidenceReference => ({
  type: "payment_decision",
  id: prior.decisionId,
  description: `invoice ${prior.invoiceId}`,
});

// 1. Campos esenciales: proveedor confirmado, monto, moneda, número y cuenta beneficiaria.
const essentialFieldsPresent: Rule = (invoice) => {
  const ruleId = "campos_esenciales_presentes";
  const missing: string[] = [];
  if (invoice.supplierMatchStatus !== "matched" || invoice.supplierId === null) missing.push("confirmed supplier");
  if (invoice.amountMinor === null) missing.push("amount");
  if (invoice.currency === null) missing.push("currency");
  if (invoice.invoiceNumber === null) missing.push("invoice number");
  if (invoice.beneficiaryAccountReference === null) missing.push("beneficiary account");
  if (missing.length > 0) {
    return fail(ruleId, "DATOS_INSUFICIENTES", `Missing essential data: ${missing.join(", ")}.`);
  }
  return pass(ruleId, "Supplier, amount, currency, invoice number and beneficiary account are present.");
};

// 2. Una extracción con advertencias es dato dudoso: nunca se aprueba sola.
const noExtractionWarnings: Rule = (invoice) => {
  const ruleId = "sin_advertencias_extraccion";
  if (invoice.extractionWarnings.length > 0) {
    const codes = invoice.extractionWarnings.map((w) => w.code).join(", ");
    return fail(ruleId, "DATOS_INSUFICIENTES", `Extraction reported warnings (${codes}); the data needs human review.`);
  }
  return pass(ruleId, "Extraction reported no warnings.");
};

// 3. Solo USD en P0; no se inventan tasas de cambio.
const currencySupported: Rule = (invoice) => {
  const ruleId = "moneda_soportada";
  if (invoice.currency === null) {
    return unknown(ruleId, "DATOS_INSUFICIENTES", "Invoice currency is unknown.");
  }
  if (invoice.currency !== P0_CURRENCY) {
    return fail(ruleId, "MONEDA_NO_SOPORTADA", `Currency ${invoice.currency} is not supported for automatic approval (USD only).`);
  }
  return pass(ruleId, "Invoice currency is USD.");
};

// 4. Duplicados: confirmado bloquea; reenvío de una bloqueada, sospechoso o no determinable escala.
const notDuplicate: Rule = (invoice, facts) => {
  const ruleId = "no_es_duplicada";
  const sameFile = facts.documentDuplicateInvoiceIds.filter((id) => id !== invoice.invoiceId);
  if (sameFile.length > 0) {
    return fail(
      ruleId,
      "FACTURA_DUPLICADA",
      `The same document was already submitted as invoice ${sameFile.join(", ")}.`,
      sameFile.map((id) => ({ type: "invoice", id, description: "same document fingerprint" })),
      true,
    );
  }
  if (invoice.supplierId === null || invoice.invoiceNumber === null) {
    return unknown(ruleId, "DATOS_INSUFICIENTES", "Duplicate check needs a confirmed supplier and an invoice number.");
  }

  const number = normalizeInvoiceNumber(invoice.invoiceNumber);
  const others = latestDecisionPerInvoice(facts.priorDecisions).filter(
    (prior) => prior.invoiceId !== invoice.invoiceId && prior.supplierId === invoice.supplierId,
  );
  const sameNumber = others.filter(
    (prior) => prior.invoiceNumber !== null && normalizeInvoiceNumber(prior.invoiceNumber) === number,
  );

  const confirmed = sameNumber.filter((prior) => prior.decision !== "bloqueada");
  if (confirmed.length > 0) {
    return fail(
      ruleId,
      "FACTURA_DUPLICADA",
      `Invoice number ${invoice.invoiceNumber} from this supplier was already processed.`,
      confirmed.map(priorRef),
      true,
    );
  }
  if (sameNumber.length > 0) {
    return fail(
      ruleId,
      "FACTURA_DUPLICADA",
      `Invoice number ${invoice.invoiceNumber} was previously blocked or rejected; a person must confirm this resubmission.`,
      sameNumber.map(priorRef),
    );
  }
  const suspected = others.filter(
    (prior) =>
      prior.decision !== "bloqueada" &&
      invoice.amountMinor !== null &&
      invoice.invoiceDate !== null &&
      prior.amountMinor === invoice.amountMinor &&
      prior.invoiceDate === invoice.invoiceDate,
  );
  if (suspected.length > 0) {
    return fail(
      ruleId,
      "FACTURA_DUPLICADA",
      "Another invoice from this supplier has the same amount and date with a different number (suspected duplicate).",
      suspected.map(priorRef),
    );
  }
  return pass(ruleId, "No previous invoice matches this supplier and invoice number or document.");
};

// 5. Debe existir una autorización explícita vigente y sin usar en su periodo.
//    Contrato e historial no autorizan.
const supplierAuthorized: Rule = (invoice, facts) => {
  const ruleId = "proveedor_autorizado";
  if (invoice.supplierId === null) {
    return unknown(ruleId, "DATOS_INSUFICIENTES", "Supplier is not confirmed, so authorizations cannot be checked.");
  }
  const match = matchAuthorizations(invoice, facts);
  if (match.valid.length === 0) {
    if (facts.recurrenceSuggested) {
      return fail(
        ruleId,
        "RECURRENCIA_NO_AUTORIZADA",
        "Payment history shows recurring payments to this supplier, but there is no explicit authorization. History is not authorization.",
      );
    }
    return fail(
      ruleId,
      "PROVEEDOR_NO_AUTORIZADO",
      "There is no active authorization for this supplier covering today and the invoice date.",
    );
  }
  if (match.available.length === 0) {
    return fail(
      ruleId,
      "PROVEEDOR_NO_AUTORIZADO",
      "This supplier's authorization already covered an invoice in its current period.",
      match.valid.map(authorizationRef),
    );
  }
  return pass(ruleId, "An active, unused authorization exists for this supplier.", match.available.map(authorizationRef));
};

// 6. La cuenta beneficiaria debe ser la de una autorización aplicable; no se transfiere.
const beneficiaryMatchesAuthorization: Rule = (invoice, facts) => {
  const ruleId = "beneficiario_coincide_con_autorizacion";
  if (invoice.beneficiaryAccountReference === null) {
    return unknown(ruleId, "DATOS_INSUFICIENTES", "Beneficiary account is unknown.");
  }
  const match = matchAuthorizations(invoice, facts);
  if (match.available.length === 0) {
    return unknown(ruleId, "PROVEEDOR_NO_AUTORIZADO", "No applicable authorization to compare the beneficiary account against.");
  }
  if (match.sameAccount.length === 0) {
    return fail(
      ruleId,
      "BENEFICIARIO_CAMBIADO",
      `Beneficiary account ${invoice.beneficiaryAccountReference} does not match any authorized account for this supplier.`,
      match.available.map(authorizationRef),
    );
  }
  return pass(ruleId, "Beneficiary account matches an authorized account.", match.sameAccount.map(authorizationRef));
};

// 7. El monto no supera el máximo de la autorización aplicable (misma cuenta y moneda).
const withinAuthorizationLimit: Rule = (invoice, facts) => {
  const ruleId = "dentro_limite_autorizacion";
  if (invoice.amountMinor === null || invoice.currency === null || invoice.beneficiaryAccountReference === null) {
    return unknown(ruleId, "DATOS_INSUFICIENTES", "Amount, currency or beneficiary account is unknown.");
  }
  const match = matchAuthorizations(invoice, facts);
  if (match.available.length === 0) {
    return unknown(ruleId, "PROVEEDOR_NO_AUTORIZADO", "No applicable authorization to compare the amount against.");
  }
  if (match.sameAccount.length === 0) {
    return unknown(ruleId, "BENEFICIARIO_CAMBIADO", "No authorization for this beneficiary account to compare the amount against.");
  }
  if (match.sameCurrency.length === 0) {
    return fail(
      ruleId,
      "MONEDA_NO_SOPORTADA",
      `No authorization for this account covers currency ${invoice.currency}.`,
      match.sameAccount.map(authorizationRef),
    );
  }
  const amount = invoice.amountMinor;
  const covering = match.sameCurrency.find((auth) => amount <= auth.maxAmountMinor);
  if (covering === undefined) {
    const highest = Math.max(...match.sameCurrency.map((auth) => auth.maxAmountMinor));
    return fail(
      ruleId,
      "MONTO_EXCEDE_LIMITE",
      `Amount ${formatAmount(amount, invoice.currency)} exceeds the authorized maximum of ${formatAmount(highest, invoice.currency)}.`,
      match.sameCurrency.map(authorizationRef),
    );
  }
  return pass(
    ruleId,
    `Amount ${formatAmount(amount, invoice.currency)} is within the authorized maximum of ${formatAmount(covering.maxAmountMinor, invoice.currency)}.`,
    [authorizationRef(covering)],
  );
};

// 8. El monto no supera el límite de aprobación automática de la política vigente.
const withinPolicyAutoLimit: Rule = (invoice, facts) => {
  const ruleId = "dentro_limite_politica_auto";
  const policy = facts.policy;
  if (policy === null) {
    return unknown(ruleId, "DATOS_INSUFICIENTES", "Payment policy could not be loaded.");
  }
  if (invoice.amountMinor === null || invoice.currency === null) {
    return unknown(ruleId, "DATOS_INSUFICIENTES", "Amount or currency is unknown.");
  }
  const ref: DecisionEvidenceReference = { type: "payment_policy", id: policy.policyId, description: `version ${policy.version}` };
  if (invoice.currency !== policy.currency) {
    return unknown(ruleId, "MONEDA_NO_SOPORTADA", `Policy limits are in ${policy.currency}; invoice is in ${invoice.currency}.`);
  }
  if (invoice.amountMinor > policy.autoApprovalLimitMinor) {
    return fail(
      ruleId,
      "MONTO_EXCEDE_LIMITE",
      `Amount ${formatAmount(invoice.amountMinor, invoice.currency)} exceeds the automatic approval limit of ${formatAmount(policy.autoApprovalLimitMinor, policy.currency)}.`,
      [ref],
    );
  }
  return pass(
    ruleId,
    `Amount is within the automatic approval limit of ${formatAmount(policy.autoApprovalLimitMinor, policy.currency)}.`,
    [ref],
  );
};

// 9. El contrato no es obligatorio, pero si contradice o es ambiguo, escala.
const contractConsistent: Rule = (invoice) => {
  const ruleId = "contrato_consistente";
  const match = invoice.contractMatch;
  if (match === null || match.matchStatus === "not_found") {
    return pass(ruleId, "No contract applies; the explicit authorization governs this payment.");
  }
  const ref: DecisionEvidenceReference[] =
    match.contractId === null ? [] : [{ type: "contract", id: match.contractId, description: null }];
  if (match.matchStatus === "ambiguous") {
    return fail(ruleId, "CONTRATO_NO_COINCIDE", "It is ambiguous which contract applies to this invoice.", ref);
  }
  if (match.matchStatus === "mismatch") {
    const details = match.discrepancies.map((d) => d.description).join("; ");
    return fail(ruleId, "CONTRATO_NO_COINCIDE", `Invoice contradicts its contract: ${details}`, ref);
  }
  return pass(ruleId, "Invoice is consistent with its contract.", ref);
};

// 10. Presupuesto mensual disponible. Si no alcanza, bloquea; si no es calculable, escala.
const budgetAvailable: Rule = (invoice, facts) => {
  const ruleId = "presupuesto_disponible";
  const policy = facts.policy;
  if (policy === null) {
    return unknown(ruleId, "DATOS_INSUFICIENTES", "Payment policy could not be loaded, so the budget is unknown.");
  }
  if (facts.budgetUsedMinor === null) {
    return unknown(ruleId, "DATOS_INSUFICIENTES", "Budget used this month could not be calculated.");
  }
  if (invoice.amountMinor === null || invoice.currency === null) {
    return unknown(ruleId, "DATOS_INSUFICIENTES", "Amount or currency is unknown.");
  }
  if (invoice.currency !== policy.currency) {
    return unknown(ruleId, "MONEDA_NO_SOPORTADA", `Budget is in ${policy.currency}; invoice is in ${invoice.currency}.`);
  }
  const ref: DecisionEvidenceReference[] = [
    { type: "payment_policy", id: policy.policyId, description: `version ${policy.version}` },
    { type: "budget_snapshot", id: today(facts).slice(0, 7), description: `used ${formatAmount(facts.budgetUsedMinor, policy.currency)}` },
  ];
  const remaining = policy.monthlyBudgetMinor - facts.budgetUsedMinor;
  if (invoice.amountMinor > remaining) {
    return fail(
      ruleId,
      "PRESUPUESTO_INSUFICIENTE",
      `Amount ${formatAmount(invoice.amountMinor, invoice.currency)} exceeds the remaining monthly budget of ${formatAmount(Math.max(remaining, 0), policy.currency)}.`,
      ref,
      true,
    );
  }
  return pass(ruleId, `Remaining monthly budget of ${formatAmount(remaining, policy.currency)} covers this invoice.`, ref);
};

// Orden fijo: también es el orden en que se muestran en el dashboard.
export const RULES: readonly Rule[] = [
  essentialFieldsPresent,
  noExtractionWarnings,
  currencySupported,
  notDuplicate,
  supplierAuthorized,
  beneficiaryMatchesAuthorization,
  withinAuthorizationLimit,
  withinPolicyAutoLimit,
  contractConsistent,
  budgetAvailable,
];
