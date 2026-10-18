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
    return `${amountMinor} unidades menores ${currency}`;
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
  description: `factura ${prior.invoiceId}`,
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
    return fail(ruleId, "INSUFFICIENT_DATA", `Faltan datos esenciales: ${missing.join(", ")}.`);
  }
  return pass(ruleId, "Proveedor, monto, moneda, número de factura y cuenta beneficiaria están presentes.");
};

// 2. Una extracción con advertencias es dato dudoso: nunca se aprueba sola.
const noExtractionWarnings: Rule = (invoice) => {
  const ruleId = "no_extraction_warnings";
  if (invoice.extractionWarnings.length > 0) {
    const codes = invoice.extractionWarnings.map((w) => w.code).join(", ");
    return fail(ruleId, "INSUFFICIENT_DATA", `La lectura reportó advertencias (${codes}); los datos necesitan revisión humana.`);
  }
  return pass(ruleId, "La lectura no reportó advertencias.");
};

// 3. Solo USD en P0; no se inventan tasas de cambio.
const currencySupported: Rule = (invoice) => {
  const ruleId = "currency_supported";
  if (invoice.currency === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Se desconoce la moneda de la factura.");
  }
  if (invoice.currency !== P0_CURRENCY) {
    return fail(ruleId, "CURRENCY_NOT_SUPPORTED", `La moneda ${invoice.currency} no admite aprobación automática (solo USD).`);
  }
  return pass(ruleId, "La factura está en USD.");
};

// 4. Duplicados: confirmado bloquea; reenvío de una bloqueada, sospechoso o no determinable escala.
const notDuplicate: Rule = (invoice, facts) => {
  const ruleId = "not_duplicate";
  const sameFile = facts.documentDuplicateInvoiceIds.filter((id) => id !== invoice.invoiceId);
  if (sameFile.length > 0) {
    return fail(
      ruleId,
      "DUPLICATE_INVOICE",
      `El mismo documento ya se recibió como la factura ${sameFile.join(", ")}.`,
      sameFile.map((id) => ({ type: "invoice", id, description: "misma huella del documento" })),
      true,
    );
  }
  if (invoice.supplierId === null || invoice.invoiceNumber === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Para revisar duplicados se necesita un proveedor confirmado y un número de factura.");
  }

  const number = normalizeInvoiceNumber(invoice.invoiceNumber);
  const others = latestDecisionPerInvoice(facts.priorDecisions).filter(
    (prior) => prior.invoiceId !== invoice.invoiceId && prior.supplierId === invoice.supplierId,
  );
  const sameNumber = others.filter(
    (prior) => prior.invoiceNumber !== null && normalizeInvoiceNumber(prior.invoiceNumber) === number,
  );

  const confirmed = sameNumber.filter((prior) => prior.decision !== "blocked");
  if (confirmed.length > 0) {
    return fail(
      ruleId,
      "DUPLICATE_INVOICE",
      `La factura ${invoice.invoiceNumber} de este proveedor ya se procesó.`,
      confirmed.map(priorRef),
      true,
    );
  }
  if (sameNumber.length > 0) {
    return fail(
      ruleId,
      "DUPLICATE_INVOICE",
      `La factura ${invoice.invoiceNumber} se bloqueó o rechazó antes; una persona debe confirmar este reenvío.`,
      sameNumber.map(priorRef),
    );
  }
  const suspected = others.filter(
    (prior) =>
      prior.decision !== "blocked" &&
      invoice.amountMinor !== null &&
      invoice.invoiceDate !== null &&
      prior.amountMinor === invoice.amountMinor &&
      prior.invoiceDate === invoice.invoiceDate,
  );
  if (suspected.length > 0) {
    return fail(
      ruleId,
      "DUPLICATE_INVOICE",
      "Otra factura de este proveedor tiene el mismo monto y fecha con otro número (posible duplicado).",
      suspected.map(priorRef),
    );
  }
  return pass(ruleId, "Ninguna factura anterior coincide con este proveedor y número de factura o documento.");
};

// 5. Debe existir una autorización explícita vigente y sin usar en su periodo.
//    Contrato e historial no autorizan.
const supplierAuthorized: Rule = (invoice, facts) => {
  const ruleId = "supplier_authorized";
  if (invoice.supplierId === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "El proveedor no está confirmado, así que no se pueden revisar autorizaciones.");
  }
  const match = matchAuthorizations(invoice, facts);
  if (match.valid.length === 0) {
    if (facts.recurrenceSuggested) {
      return fail(
        ruleId,
        "RECURRENCE_NOT_AUTHORIZED",
        "El historial muestra pagos recurrentes a este proveedor, pero no hay una autorización explícita. El historial no es una autorización.",
      );
    }
    return fail(
      ruleId,
      "SUPPLIER_NOT_AUTHORIZED",
      "No hay una autorización activa para este proveedor que cubra hoy y la fecha de la factura.",
    );
  }
  if (match.available.length === 0) {
    return fail(
      ruleId,
      "SUPPLIER_NOT_AUTHORIZED",
      "La autorización de este proveedor ya cubrió una factura en su periodo actual.",
      match.valid.map(authorizationRef),
    );
  }
  return pass(ruleId, "Existe una autorización activa y sin usar para este proveedor.", match.available.map(authorizationRef));
};

// 6. La cuenta beneficiaria debe ser la de una autorización aplicable; no se transfiere.
const beneficiaryMatchesAuthorization: Rule = (invoice, facts) => {
  const ruleId = "beneficiary_matches_authorization";
  if (invoice.beneficiaryAccountReference === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Se desconoce la cuenta beneficiaria.");
  }
  const match = matchAuthorizations(invoice, facts);
  if (match.available.length === 0) {
    return unknown(ruleId, "SUPPLIER_NOT_AUTHORIZED", "No hay una autorización aplicable con la cual comparar la cuenta beneficiaria.");
  }
  if (match.sameAccount.length === 0) {
    return fail(
      ruleId,
      "BENEFICIARY_CHANGED",
      `La cuenta beneficiaria ${invoice.beneficiaryAccountReference} no coincide con ninguna cuenta autorizada de este proveedor.`,
      match.available.map(authorizationRef),
    );
  }
  return pass(ruleId, "La cuenta beneficiaria coincide con una cuenta autorizada.", match.sameAccount.map(authorizationRef));
};

// 7. El monto no supera el máximo de la autorización aplicable (misma cuenta y moneda).
const withinAuthorizationLimit: Rule = (invoice, facts) => {
  const ruleId = "within_authorization_limit";
  if (invoice.amountMinor === null || invoice.currency === null || invoice.beneficiaryAccountReference === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Se desconoce el monto, la moneda o la cuenta beneficiaria.");
  }
  const match = matchAuthorizations(invoice, facts);
  if (match.available.length === 0) {
    return unknown(ruleId, "SUPPLIER_NOT_AUTHORIZED", "No hay una autorización aplicable con la cual comparar el monto.");
  }
  if (match.sameAccount.length === 0) {
    return unknown(ruleId, "BENEFICIARY_CHANGED", "No hay una autorización para esta cuenta beneficiaria con la cual comparar el monto.");
  }
  if (match.sameCurrency.length === 0) {
    return fail(
      ruleId,
      "CURRENCY_NOT_SUPPORTED",
      `Ninguna autorización de esta cuenta cubre la moneda ${invoice.currency}.`,
      match.sameAccount.map(authorizationRef),
    );
  }
  const amount = invoice.amountMinor;
  const covering = match.sameCurrency.find((auth) => amount <= auth.maxAmountMinor);
  if (covering === undefined) {
    const highest = Math.max(...match.sameCurrency.map((auth) => auth.maxAmountMinor));
    return fail(
      ruleId,
      "AMOUNT_LIMIT_EXCEEDED",
      `El monto ${formatAmount(amount, invoice.currency)} supera el máximo autorizado de ${formatAmount(highest, invoice.currency)}.`,
      match.sameCurrency.map(authorizationRef),
    );
  }
  return pass(
    ruleId,
    `El monto ${formatAmount(amount, invoice.currency)} está dentro del máximo autorizado de ${formatAmount(covering.maxAmountMinor, invoice.currency)}.`,
    [authorizationRef(covering)],
  );
};

// 8. El monto no supera el límite de aprobación automática de la política vigente.
const withinPolicyAutoLimit: Rule = (invoice, facts) => {
  const ruleId = "within_policy_auto_limit";
  const policy = facts.policy;
  if (policy === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "No se pudo cargar la política de pagos.");
  }
  if (invoice.amountMinor === null || invoice.currency === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Se desconoce el monto o la moneda.");
  }
  const ref: DecisionEvidenceReference = { type: "payment_policy", id: policy.policyId, description: `versión ${policy.version}` };
  if (invoice.currency !== policy.currency) {
    return unknown(ruleId, "CURRENCY_NOT_SUPPORTED", `Los límites de la política están en ${policy.currency}; la factura está en ${invoice.currency}.`);
  }
  if (invoice.amountMinor > policy.autoApprovalLimitMinor) {
    return fail(
      ruleId,
      "AMOUNT_LIMIT_EXCEEDED",
      `El monto ${formatAmount(invoice.amountMinor, invoice.currency)} supera el límite de aprobación automática de ${formatAmount(policy.autoApprovalLimitMinor, policy.currency)}.`,
      [ref],
    );
  }
  return pass(
    ruleId,
    `El monto está dentro del límite de aprobación automática de ${formatAmount(policy.autoApprovalLimitMinor, policy.currency)}.`,
    [ref],
  );
};

// 9. El contrato no es obligatorio, pero si contradice o es ambiguo, escala.
const contractConsistent: Rule = (invoice) => {
  const ruleId = "contract_consistent";
  const match = invoice.contractMatch;
  if (match === null || match.matchStatus === "not_found") {
    return pass(ruleId, "No aplica ningún contrato; la autorización explícita rige este pago.");
  }
  const ref: DecisionEvidenceReference[] =
    match.contractId === null ? [] : [{ type: "contract", id: match.contractId, description: null }];
  if (match.matchStatus === "ambiguous") {
    return fail(ruleId, "CONTRACT_MISMATCH", "No está claro qué contrato aplica a esta factura.", ref);
  }
  if (match.matchStatus === "mismatch") {
    const details = match.discrepancies.map((d) => d.description).join("; ");
    return fail(ruleId, "CONTRACT_MISMATCH", `La factura contradice su contrato: ${details}`, ref);
  }
  return pass(ruleId, "La factura es coherente con su contrato.", ref);
};

// 10. Presupuesto mensual disponible. Si no alcanza, bloquea; si no es calculable, escala.
const budgetAvailable: Rule = (invoice, facts) => {
  const ruleId = "budget_available";
  const policy = facts.policy;
  if (policy === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "No se pudo cargar la política de pagos, así que se desconoce el presupuesto.");
  }
  if (facts.budgetUsedMinor === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "No se pudo calcular el presupuesto usado este mes.");
  }
  if (invoice.amountMinor === null || invoice.currency === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Se desconoce el monto o la moneda.");
  }
  if (invoice.currency !== policy.currency) {
    return unknown(ruleId, "CURRENCY_NOT_SUPPORTED", `El presupuesto está en ${policy.currency}; la factura está en ${invoice.currency}.`);
  }
  const ref: DecisionEvidenceReference[] = [
    { type: "payment_policy", id: policy.policyId, description: `versión ${policy.version}` },
    { type: "budget_snapshot", id: today(facts).slice(0, 7), description: `usado ${formatAmount(facts.budgetUsedMinor, policy.currency)}` },
  ];
  const remaining = policy.monthlyBudgetMinor - facts.budgetUsedMinor;
  if (invoice.amountMinor > remaining) {
    return fail(
      ruleId,
      "BUDGET_INSUFFICIENT",
      `El monto ${formatAmount(invoice.amountMinor, invoice.currency)} supera el presupuesto mensual restante de ${formatAmount(Math.max(remaining, 0), policy.currency)}.`,
      ref,
      true,
    );
  }
  return pass(ruleId, `El presupuesto mensual restante de ${formatAmount(remaining, policy.currency)} cubre esta factura.`, ref);
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
