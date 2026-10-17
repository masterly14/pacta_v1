import type { InvoiceContext } from "@/shared/schemas/invoice-context";
import type { DecisionEvidenceReference, RuleEvaluation } from "@/shared/schemas/payment-decision";
import type { EngineAuthorization, EngineFacts } from "./facts";

// Resultado interno de una regla. `hardBlock` marca un bloqueo absoluto (duplicado
// confirmado, presupuesto insuficiente) y no se publica en PaymentDecision.
export type RuleOutcome = RuleEvaluation & { hardBlock: boolean };

type Rule = (invoice: InvoiceContext, facts: EngineFacts) => RuleOutcome;

const P0_CURRENCY = "USD";

function pass(ruleId: string, explanation: string, evidenceReferences: DecisionEvidenceReference[] = []): RuleOutcome {
  return { ruleId, result: "pass", reasonCode: null, explanation, evidenceReferences, hardBlock: false };
}

function fail(
  ruleId: string,
  reasonCode: NonNullable<RuleEvaluation["reasonCode"]>,
  explanation: string,
  evidenceReferences: DecisionEvidenceReference[] = [],
  hardBlock = false,
): RuleOutcome {
  return { ruleId, result: "fail", reasonCode, explanation, evidenceReferences, hardBlock };
}

function unknown(
  ruleId: string,
  reasonCode: NonNullable<RuleEvaluation["reasonCode"]>,
  explanation: string,
): RuleOutcome {
  return { ruleId, result: "unknown", reasonCode, explanation, evidenceReferences: [], hardBlock: false };
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

// Autorizaciones activas y vigentes hoy para el proveedor confirmado de la factura.
export function validAuthorizations(invoice: InvoiceContext, facts: EngineFacts): EngineAuthorization[] {
  if (invoice.supplierId === null) {
    return [];
  }
  const date = today(facts);
  return facts.authorizations.filter(
    (auth) =>
      auth.status === "active" &&
      auth.supplierId === invoice.supplierId &&
      auth.validFrom <= date &&
      date <= auth.validUntil,
  );
}

const authorizationRef = (auth: EngineAuthorization): DecisionEvidenceReference => ({
  type: "payment_authorization",
  id: auth.authorizationId,
  description: null,
});

// 1. Campos esenciales: proveedor confirmado, monto, moneda, número y cuenta beneficiaria.
const essentialFieldsPresent: Rule = (invoice) => {
  const ruleId = "essential_fields_present";
  const missing: string[] = [];
  if (invoice.supplierMatchStatus !== "matched" || invoice.supplierId === null) missing.push("confirmed supplier");
  if (invoice.amountMinor === null) missing.push("amount");
  if (invoice.currency === null) missing.push("currency");
  if (invoice.invoiceNumber === null) missing.push("invoice number");
  if (invoice.beneficiaryAccountReference === null) missing.push("beneficiary account");
  if (missing.length > 0) {
    return fail(ruleId, "INSUFFICIENT_DATA", `Missing essential data: ${missing.join(", ")}.`);
  }
  return pass(ruleId, "Supplier, amount, currency, invoice number and beneficiary account are present.");
};

// 2. Solo USD en P0; no se inventan tasas de cambio.
const currencySupported: Rule = (invoice) => {
  const ruleId = "currency_supported";
  if (invoice.currency === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Invoice currency is unknown.");
  }
  if (invoice.currency !== P0_CURRENCY) {
    return fail(ruleId, "CURRENCY_NOT_SUPPORTED", `Currency ${invoice.currency} is not supported for automatic approval (USD only).`);
  }
  return pass(ruleId, "Invoice currency is USD.");
};

// 3. Duplicados: confirmado bloquea; sospechoso o no determinable escala.
const notDuplicate: Rule = (invoice, facts) => {
  const ruleId = "not_duplicate";
  const sameFile = facts.documentDuplicateInvoiceIds.filter((id) => id !== invoice.invoiceId);
  if (sameFile.length > 0) {
    return fail(
      ruleId,
      "DUPLICATE_INVOICE",
      `The same document was already submitted as invoice ${sameFile.join(", ")}.`,
      sameFile.map((id) => ({ type: "invoice", id, description: "same document fingerprint" })),
      true,
    );
  }
  if (invoice.supplierId === null || invoice.invoiceNumber === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Duplicate check needs a confirmed supplier and an invoice number.");
  }

  const others = facts.priorDecisions.filter(
    (prior) => prior.invoiceId !== invoice.invoiceId && prior.decision !== "blocked" && prior.supplierId === invoice.supplierId,
  );
  const confirmed = others.filter((prior) => prior.invoiceNumber === invoice.invoiceNumber);
  if (confirmed.length > 0) {
    return fail(
      ruleId,
      "DUPLICATE_INVOICE",
      `Invoice number ${invoice.invoiceNumber} from this supplier was already processed.`,
      confirmed.map((prior) => ({ type: "payment_decision", id: prior.decisionId, description: `invoice ${prior.invoiceId}` })),
      true,
    );
  }
  const suspected = others.filter(
    (prior) =>
      invoice.amountMinor !== null &&
      invoice.invoiceDate !== null &&
      prior.amountMinor === invoice.amountMinor &&
      prior.invoiceDate === invoice.invoiceDate,
  );
  if (suspected.length > 0) {
    return fail(
      ruleId,
      "DUPLICATE_INVOICE",
      "Another invoice from this supplier has the same amount and date with a different number (suspected duplicate).",
      suspected.map((prior) => ({ type: "payment_decision", id: prior.decisionId, description: `invoice ${prior.invoiceId}` })),
    );
  }
  return pass(ruleId, "No previous invoice matches this supplier and invoice number or document.");
};

// 4. Debe existir una autorización explícita vigente. Contrato e historial no autorizan.
const supplierAuthorized: Rule = (invoice, facts) => {
  const ruleId = "supplier_authorized";
  if (invoice.supplierId === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Supplier is not confirmed, so authorizations cannot be checked.");
  }
  const valid = validAuthorizations(invoice, facts);
  if (valid.length === 0) {
    if (facts.recurrenceSuggested) {
      return fail(
        ruleId,
        "RECURRENCE_NOT_AUTHORIZED",
        "Payment history shows recurring payments to this supplier, but there is no explicit authorization. History is not authorization.",
      );
    }
    return fail(ruleId, "SUPPLIER_NOT_AUTHORIZED", "There is no active, valid authorization for this supplier.");
  }
  return pass(ruleId, "An active authorization exists for this supplier.", valid.map(authorizationRef));
};

// 5. La cuenta beneficiaria debe ser la de una autorización vigente; no se transfiere.
const beneficiaryMatchesAuthorization: Rule = (invoice, facts) => {
  const ruleId = "beneficiary_matches_authorization";
  if (invoice.beneficiaryAccountReference === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Beneficiary account is unknown.");
  }
  const valid = validAuthorizations(invoice, facts);
  if (valid.length === 0) {
    return unknown(ruleId, "SUPPLIER_NOT_AUTHORIZED", "No valid authorization to compare the beneficiary account against.");
  }
  const matching = valid.filter((auth) => auth.beneficiaryAccountRef === invoice.beneficiaryAccountReference);
  if (matching.length === 0) {
    return fail(
      ruleId,
      "BENEFICIARY_CHANGED",
      `Beneficiary account ${invoice.beneficiaryAccountReference} does not match any authorized account for this supplier.`,
      valid.map(authorizationRef),
    );
  }
  return pass(ruleId, "Beneficiary account matches an authorized account.", matching.map(authorizationRef));
};

// 6. El monto no supera el máximo de una autorización con la misma cuenta y moneda.
const withinAuthorizationLimit: Rule = (invoice, facts) => {
  const ruleId = "within_authorization_limit";
  if (invoice.amountMinor === null || invoice.currency === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Amount or currency is unknown.");
  }
  const sameAccount = validAuthorizations(invoice, facts).filter(
    (auth) => auth.beneficiaryAccountRef === invoice.beneficiaryAccountReference,
  );
  if (sameAccount.length === 0) {
    return unknown(ruleId, "SUPPLIER_NOT_AUTHORIZED", "No valid authorization for this account to compare the amount against.");
  }
  const sameCurrency = sameAccount.filter((auth) => auth.currency === invoice.currency);
  if (sameCurrency.length === 0) {
    return fail(
      ruleId,
      "CURRENCY_NOT_SUPPORTED",
      `No authorization for this account covers currency ${invoice.currency}.`,
      sameAccount.map(authorizationRef),
    );
  }
  const amount = invoice.amountMinor;
  const covering = sameCurrency.find((auth) => amount <= auth.maxAmountMinor);
  if (covering === undefined) {
    const highest = Math.max(...sameCurrency.map((auth) => auth.maxAmountMinor));
    return fail(
      ruleId,
      "AMOUNT_LIMIT_EXCEEDED",
      `Amount ${formatAmount(amount, invoice.currency)} exceeds the authorized maximum of ${formatAmount(highest, invoice.currency)}.`,
      sameCurrency.map(authorizationRef),
    );
  }
  return pass(
    ruleId,
    `Amount ${formatAmount(amount, invoice.currency)} is within the authorized maximum of ${formatAmount(covering.maxAmountMinor, invoice.currency)}.`,
    [authorizationRef(covering)],
  );
};

// 7. El monto no supera el límite de aprobación automática de la política vigente.
const withinPolicyAutoLimit: Rule = (invoice, facts) => {
  const ruleId = "within_policy_auto_limit";
  const policy = facts.policy;
  if (policy === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Payment policy could not be loaded.");
  }
  if (invoice.amountMinor === null || invoice.currency === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Amount or currency is unknown.");
  }
  const ref: DecisionEvidenceReference = { type: "payment_policy", id: policy.policyId, description: `version ${policy.version}` };
  if (invoice.currency !== policy.currency) {
    return unknown(ruleId, "CURRENCY_NOT_SUPPORTED", `Policy limits are in ${policy.currency}; invoice is in ${invoice.currency}.`);
  }
  if (invoice.amountMinor > policy.autoApprovalLimitMinor) {
    return fail(
      ruleId,
      "AMOUNT_LIMIT_EXCEEDED",
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

// 8. El contrato no es obligatorio, pero si contradice o es ambiguo, escala.
const contractConsistent: Rule = (invoice) => {
  const ruleId = "contract_consistent";
  const match = invoice.contractMatch;
  if (match === null || match.matchStatus === "not_found") {
    return pass(ruleId, "No contract applies; the explicit authorization governs this payment.");
  }
  const ref: DecisionEvidenceReference[] =
    match.contractId === null ? [] : [{ type: "contract", id: match.contractId, description: null }];
  if (match.matchStatus === "ambiguous") {
    return fail(ruleId, "CONTRACT_MISMATCH", "It is ambiguous which contract applies to this invoice.", ref);
  }
  if (match.matchStatus === "mismatch") {
    const details = match.discrepancies.map((d) => d.description).join("; ");
    return fail(ruleId, "CONTRACT_MISMATCH", `Invoice contradicts its contract: ${details}`, ref);
  }
  return pass(ruleId, "Invoice is consistent with its contract.", ref);
};

// 9. Presupuesto mensual disponible. Si no alcanza, bloquea; si no es calculable, escala.
const budgetAvailable: Rule = (invoice, facts) => {
  const ruleId = "budget_available";
  const policy = facts.policy;
  if (policy === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Payment policy could not be loaded, so the budget is unknown.");
  }
  if (facts.budgetUsedMinor === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Budget used this month could not be calculated.");
  }
  if (invoice.amountMinor === null || invoice.currency === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Amount or currency is unknown.");
  }
  if (invoice.currency !== policy.currency) {
    return unknown(ruleId, "CURRENCY_NOT_SUPPORTED", `Budget is in ${policy.currency}; invoice is in ${invoice.currency}.`);
  }
  const ref: DecisionEvidenceReference[] = [
    { type: "payment_policy", id: policy.policyId, description: `version ${policy.version}` },
    { type: "budget_snapshot", id: `${today(facts).slice(0, 7)}`, description: `used ${formatAmount(facts.budgetUsedMinor, policy.currency)}` },
  ];
  const remaining = policy.monthlyBudgetMinor - facts.budgetUsedMinor;
  if (invoice.amountMinor > remaining) {
    return fail(
      ruleId,
      "BUDGET_INSUFFICIENT",
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
  currencySupported,
  notDuplicate,
  supplierAuthorized,
  beneficiaryMatchesAuthorization,
  withinAuthorizationLimit,
  withinPolicyAutoLimit,
  contractConsistent,
  budgetAvailable,
];
