/**
 * Purpose: deterministic engine for fiscal obligations (platform-core §7.2 and §7.2.1).
 *   Each tax line of a run goes through eleven rules in fixed order, then three run rules
 *   (total vs. free funds, vs. the template cap and vs. the organization's provision).
 *   Also computes the provision plan and the T-7 / T-3 alerts.
 *   Pacta never calculates taxes: it compares the accounting draft with the confirmed
 *   settlement and the organization's control rules. `approved` = simulated payment.
 * Runs in: server and tests (pure, no I/O, no AI, no clock: `asOf` comes from the caller).
 * Triggered by: tests today; later the obligations cron and the demo clock.
 * Receives → Returns: decideFiscalRun(FiscalRunInput) → { lines: FiscalLineDecision[], held };
 *   fiscalProvision(...) → FiscalProvision; fiscalAlerts(FiscalAlertInput) → FiscalAlert[].
 * Talks to: @/features/obligations/fiscal/schemas (types), @/features/contracts/money#formatMinor.
 */
import { formatMinor } from "@/features/contracts/money";
import {
  periodKey,
  type AccountingItem,
  type AccountingSnapshot,
  type FiscalEvidenceReference,
  type FiscalLineDecision,
  type FiscalOutcome,
  type FiscalReasonCode,
  type FiscalRuleEvaluation,
  type FiscalRunContext,
  type FiscalTemplate,
  type FiscalType,
  type Settlement,
} from "@/features/obligations/fiscal/schemas";

const DAY_MS = 86_400_000;

// Resultado interno. `hardBlock` marca un bloqueo absoluto: periodo ya pagado o sin fondos.
type RuleOutcome = FiscalRuleEvaluation & { hardBlock: boolean; evidence: FiscalEvidenceReference[] };

export type FiscalRunInput = {
  template: FiscalTemplate;
  snapshot: AccountingSnapshot;
  settlements: readonly Settlement[];
  run: FiscalRunContext;
  asOf: string; // instante UTC; el motor no lee el reloj (CLAUDE.md §6.13)
};

export type FiscalRunResult = {
  lines: FiscalLineDecision[];
  held: boolean; // una regla de corrida bloqueó las líneas aprobables
};

type LineInput = Omit<FiscalRunInput, "settlements"> & { item: AccountingItem; settlement: Settlement | null };

function pass(ruleId: string, explanation: string, evidence: FiscalEvidenceReference[] = []): RuleOutcome {
  return { ruleId, result: "pass", reasonCode: null, explanation, hardBlock: false, evidence };
}

function fail(
  ruleId: string,
  reasonCode: FiscalReasonCode,
  explanation: string,
  evidence: FiscalEvidenceReference[] = [],
  hardBlock = false,
): RuleOutcome {
  return { ruleId, result: "fail", reasonCode, explanation, hardBlock, evidence };
}

function unknown(ruleId: string, reasonCode: FiscalReasonCode, explanation: string): RuleOutcome {
  return { ruleId, result: "unknown", reasonCode, explanation, hardBlock: false, evidence: [] };
}

const freeFunds = (run: FiscalRunContext) => run.fundsAvailableMinor - run.fundsReservedMinor;

const templateRef = (template: FiscalTemplate): FiscalEvidenceReference => ({ type: "obligation_template", id: template.obligationId });
const snapshotRef = (snapshot: AccountingSnapshot): FiscalEvidenceReference => ({ type: "accounting_snapshot", id: snapshot.snapshotId });
const settlementRef = (settlement: Settlement): FiscalEvidenceReference => ({ type: "settlement", id: settlement.settlementId });

// ---------------------------------------------------------------------------
// Reglas por línea, en orden fijo
// ---------------------------------------------------------------------------

// 1. La plantilla está activa, vigila este impuesto y coincide en organización y moneda.
function obligationAuthorized({ template, snapshot, item }: LineInput): RuleOutcome {
  const ruleId = "obligacion_autorizada";
  if (template.status !== "active") {
    return fail(ruleId, "OBLIGATION_NOT_AUTHORIZED", `La plantilla de impuestos está en estado ${template.status}; solo una plantilla activa opera en automático.`, [templateRef(template)]);
  }
  if (template.organizationId !== snapshot.organizationId) {
    return fail(ruleId, "OBLIGATION_NOT_AUTHORIZED", "La contabilidad pertenece a otra organización.", [templateRef(template)]);
  }
  if (template.currency !== snapshot.currency) {
    return fail(ruleId, "OBLIGATION_NOT_AUTHORIZED", `La plantilla es en ${template.currency} y la contabilidad en ${snapshot.currency}; no se convierte moneda.`, [templateRef(template)]);
  }
  if (!template.taxes.some((tax) => tax.fiscalType === item.fiscalType)) {
    return fail(ruleId, "OBLIGATION_NOT_AUTHORIZED", `${item.displayName} no está entre los impuestos que la plantilla autoriza.`, [templateRef(template)]);
  }
  return pass(ruleId, `Plantilla activa versión ${template.version}.`, [templateRef(template)]);
}

// 2. El borrador tiene monto y referencia de pago.
function fieldsPresent({ item }: LineInput): RuleOutcome {
  const ruleId = "datos_completos";
  const missing = [item.draftAmountMinor === null ? "monto del borrador" : null, item.paymentReference === null ? "referencia de pago" : null].filter(
    (field) => field !== null,
  );
  if (missing.length > 0) {
    return unknown(ruleId, "INSUFFICIENT_DATA", `Falta en la contabilidad: ${missing.join(", ")}.`);
  }
  return pass(ruleId, "El borrador trae monto y referencia de pago.");
}

// 3. La instantánea contable no es posterior a asOf ni más vieja que el máximo.
function evidenceFresh({ template, snapshot, asOf }: LineInput): RuleOutcome {
  const ruleId = "evidencia_vigente";
  const ageMs = Date.parse(asOf) - Date.parse(snapshot.capturedAt);
  if (ageMs < 0) {
    return unknown(ruleId, "STALE_EVIDENCE", "La instantánea contable es posterior a la fecha de evaluación.");
  }
  const ageDays = Math.floor(ageMs / DAY_MS);
  if (ageDays > template.evidenceMaxAgeDays) {
    return fail(ruleId, "STALE_EVIDENCE", `La instantánea contable tiene ${ageDays} días; el máximo es ${template.evidenceMaxAgeDays}.`, [snapshotRef(snapshot)]);
  }
  return pass(ruleId, `Instantánea contable de hace ${ageDays} días.`, [snapshotRef(snapshot)]);
}

// 4. El mes contable está cerrado: el borrador ya no cambia.
function accountingPeriodClosed({ snapshot, item }: LineInput): RuleOutcome {
  const ruleId = "periodo_contable_cerrado";
  if (!item.accountingPeriodClosed) {
    return fail(ruleId, "STALE_EVIDENCE", `El periodo contable de ${item.displayName} sigue abierto; el borrador puede cambiar.`, [snapshotRef(snapshot)]);
  }
  return pass(ruleId, "Periodo contable cerrado.", [snapshotRef(snapshot)]);
}

// 5. Hay una liquidación confirmada por una persona. Nunca se paga sobre un borrador.
function settlementConfirmed({ settlement, item }: LineInput): RuleOutcome {
  const ruleId = "liquidacion_confirmada";
  if (settlement === null) {
    return fail(ruleId, "SETTLEMENT_UNCONFIRMED", `${item.displayName} solo tiene el borrador contable; nadie confirmó la liquidación.`);
  }
  if (settlement.status !== "confirmed") {
    const origin = settlement.source === "inbox" ? "llegó por correo" : "fue cargada";
    return fail(ruleId, "SETTLEMENT_UNCONFIRMED", `La liquidación de ${item.displayName} ${origin} y sigue propuesta; falta que una persona la confirme.`, [settlementRef(settlement)]);
  }
  return pass(ruleId, `Liquidación confirmada por ${settlement.confirmedBy}.`, [settlementRef(settlement)]);
}

// 6. El borrador coincide exactamente con la liquidación confirmada.
function amountMatchesSettlement({ settlement, item, snapshot }: LineInput): RuleOutcome {
  const ruleId = "monto_coincide_con_liquidacion";
  if (settlement === null || settlement.status !== "confirmed") {
    return unknown(ruleId, "SETTLEMENT_UNCONFIRMED", "Sin liquidación confirmada no hay con qué comparar el borrador.");
  }
  if (item.draftAmountMinor === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Sin borrador no hay monto que comparar.");
  }
  if (item.draftAmountMinor !== settlement.amountMinor) {
    return fail(
      ruleId,
      "SETTLEMENT_AMOUNT_MISMATCH",
      `El borrador (${formatMinor(item.draftAmountMinor, snapshot.currency)}) no coincide con la liquidación confirmada (${formatMinor(settlement.amountMinor, snapshot.currency)}).`,
      [settlementRef(settlement), snapshotRef(snapshot)],
    );
  }
  return pass(ruleId, "El borrador coincide con la liquidación confirmada.", [settlementRef(settlement), snapshotRef(snapshot)]);
}

// 7. El borrador no se aleja del último periodo confirmado más que la tolerancia.
function varianceWithinTolerance({ template, item, snapshot }: LineInput): RuleOutcome {
  const ruleId = "variacion_vs_periodos_previos";
  if (item.previousConfirmedAmountMinor === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", `${item.displayName} no tiene un periodo anterior confirmado con qué comparar.`);
  }
  if (item.draftAmountMinor === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Sin borrador no hay variación que medir.");
  }
  const previous = item.previousConfirmedAmountMinor;
  const delta = Math.abs(item.draftAmountMinor - previous);
  // Enteros: delta / previous > bps / 10000  ⇔  delta * 10000 > previous * bps.
  if (delta * 10_000 > previous * template.varianceToleranceBps) {
    return fail(
      ruleId,
      "VARIANCE_EXCEEDED",
      `${item.displayName}: ${formatMinor(item.draftAmountMinor, snapshot.currency)} frente a ${formatMinor(previous, snapshot.currency)} del periodo anterior supera la tolerancia de ${template.varianceToleranceBps / 100} %.`,
      [snapshotRef(snapshot)],
    );
  }
  return pass(ruleId, "Variación dentro de la tolerancia.", [snapshotRef(snapshot)]);
}

// 8. La referencia de pago es la que la organización autorizó para este impuesto.
function paymentReferenceStable({ template, item }: LineInput): RuleOutcome {
  const ruleId = "referencia_pago_estable";
  const authorized = template.taxes.find((tax) => tax.fiscalType === item.fiscalType)?.authorizedPaymentReference ?? null;
  if (authorized === null || item.paymentReference === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "No hay referencia autorizada o de borrador con qué comparar.");
  }
  if (authorized !== item.paymentReference) {
    return fail(ruleId, "BENEFICIARY_CHANGED", `La referencia de pago ${item.paymentReference} no es la autorizada (${authorized}). Un cambio de referencia nunca se aprueba solo.`, [templateRef(template)]);
  }
  return pass(ruleId, `Referencia de pago autorizada ${authorized}.`, [templateRef(template)]);
}

// 9. Bloqueo absoluto: el periodo no se pagó ya.
function periodNotPaid({ run, item }: LineInput): RuleOutcome {
  const ruleId = "periodo_no_pagado";
  const paid = run.paidPeriods.some((p) => periodKey(p.fiscalType, p.periodStart) === periodKey(item.fiscalType, item.periodStart));
  if (paid) {
    return fail(ruleId, "DUPLICATE_LINE", `${item.displayName} ya se pagó para el periodo que empieza el ${item.periodStart}.`, [], true);
  }
  return pass(ruleId, "El periodo no tiene un pago registrado.");
}

// 10. asOf no es posterior al vencimiento. Los intereses los decide una persona.
function withinDeadline({ item, asOf }: LineInput): RuleOutcome {
  const ruleId = "dentro_de_plazo";
  if (asOf.slice(0, 10) > item.dueDate) {
    return fail(ruleId, "DEADLINE_PASSED", `${item.displayName} venció el ${item.dueDate}; una persona decide cómo pagar con mora.`);
  }
  return pass(ruleId, `Vence el ${item.dueDate}.`);
}

// 11. Bloqueo absoluto: la caja libre cubre esta línea.
function fundsCoverLine({ run, item, snapshot }: LineInput): RuleOutcome {
  const ruleId = "fondos_suficientes";
  if (item.draftAmountMinor === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Sin monto no se pueden comparar los fondos.");
  }
  const free = freeFunds(run);
  if (item.draftAmountMinor > free) {
    return fail(
      ruleId,
      "FUNDS_INSUFFICIENT",
      `Fondos libres ${formatMinor(Math.max(free, 0), snapshot.currency)} no cubren ${formatMinor(item.draftAmountMinor, snapshot.currency)}.`,
      [],
      true,
    );
  }
  return pass(ruleId, "Fondos libres suficientes para la línea.");
}

const LINE_RULES = [
  obligationAuthorized,
  fieldsPresent,
  evidenceFresh,
  accountingPeriodClosed,
  settlementConfirmed,
  amountMatchesSettlement,
  varianceWithinTolerance,
  paymentReferenceStable,
  periodNotPaid,
  withinDeadline,
  fundsCoverLine,
];

export const FISCAL_LINE_RULE_IDS = [
  "obligacion_autorizada",
  "datos_completos",
  "evidencia_vigente",
  "periodo_contable_cerrado",
  "liquidacion_confirmada",
  "monto_coincide_con_liquidacion",
  "variacion_vs_periodos_previos",
  "referencia_pago_estable",
  "periodo_no_pagado",
  "dentro_de_plazo",
  "fondos_suficientes",
] as const;

// ---------------------------------------------------------------------------
// Combinación
// ---------------------------------------------------------------------------

function combine(outcomes: readonly RuleOutcome[]): FiscalOutcome {
  if (outcomes.some((o) => o.result === "fail" && o.hardBlock)) return "blocked";
  if (outcomes.length === 0 || outcomes.some((o) => o.result !== "pass")) return "requires_approval";
  return "approved";
}

function reasonCodes(decision: FiscalOutcome, outcomes: readonly RuleOutcome[]): FiscalReasonCode[] {
  if (decision === "approved") return ["AUTO_APPROVAL_RULES_PASSED"];
  const codes = new Set<FiscalReasonCode>();
  for (const outcome of outcomes) {
    if (outcome.result !== "pass" && outcome.reasonCode !== null) codes.add(outcome.reasonCode);
  }
  if (decision === "requires_approval") codes.add("HUMAN_APPROVAL_REQUIRED");
  return [...codes];
}

function explanation(decision: FiscalOutcome, outcomes: readonly RuleOutcome[]): string {
  if (decision === "approved") {
    return `Se cumplieron las ${outcomes.length} reglas. Aprobada para pago simulado; no se mueve dinero.`;
  }
  const problems = outcomes.filter((o) => o.result !== "pass").map((o) => o.explanation);
  const prefix = decision === "blocked" ? "Bloqueada" : "Requiere aprobación humana";
  return `${prefix}: ${problems.join(" ")}`;
}

function toDecision(input: LineInput, outcomes: readonly RuleOutcome[]): FiscalLineDecision {
  const { template, snapshot, item, asOf } = input;
  const decision = combine(outcomes);
  const evidence = new Map<string, FiscalEvidenceReference>();
  for (const ref of [templateRef(template), snapshotRef(snapshot), ...outcomes.flatMap((o) => o.evidence)]) {
    evidence.set(`${ref.type}:${ref.id}`, ref);
  }
  return {
    lineId: `${template.obligationId}:${item.periodStart}:${item.fiscalType}`,
    organizationId: template.organizationId,
    obligationId: template.obligationId,
    obligationVersion: template.version,
    fiscalType: item.fiscalType,
    periodStart: item.periodStart,
    dueDate: item.dueDate,
    amountMinor: item.draftAmountMinor,
    currency: snapshot.currency,
    asOf,
    decision,
    reasonCodes: reasonCodes(decision, outcomes),
    explanation: explanation(decision, outcomes),
    rulesEvaluated: outcomes.map(({ ruleId, result, reasonCode, explanation: text }) => ({ ruleId, result, reasonCode, explanation: text })),
    evidenceReferences: [...evidence.values()],
    dataOrigin: "fixture",
    isSimulated: true,
  };
}

// ---------------------------------------------------------------------------
// Corrida
// ---------------------------------------------------------------------------

export function decideFiscalRun(input: FiscalRunInput): FiscalRunResult {
  const settlements = new Map(input.settlements.map((s) => [periodKey(s.fiscalType, s.periodStart), s]));
  const lines = input.snapshot.items.map((item) => {
    const lineInput: LineInput = { ...input, item, settlement: settlements.get(periodKey(item.fiscalType, item.periodStart)) ?? null };
    return { lineInput, outcomes: LINE_RULES.map((rule) => rule(lineInput)) };
  });

  // Reglas de corrida: solo miran las líneas que quedarían aprobadas.
  const approvable = lines.filter((line) => combine(line.outcomes) === "approved");
  const total = approvable.reduce((sum, line) => sum + (line.lineInput.item.draftAmountMinor ?? 0), 0);
  const currency = input.snapshot.currency;
  const free = freeFunds(input.run);
  const held = approvable.length > 0 && total > free;
  const overCap = approvable.length > 0 && total > input.template.runCapMinor;

  const provision = fiscalProvision(input);

  for (const line of approvable) {
    line.outcomes.push(
      held
        ? fail("fondos_corrida", "FUNDS_INSUFFICIENT", `El total aprobable ${formatMinor(total, currency)} supera los fondos libres ${formatMinor(Math.max(free, 0), currency)}; la corrida queda retenida.`, [], true)
        : pass("fondos_corrida", `Fondos libres cubren el total aprobable ${formatMinor(total, currency)}.`),
      overCap
        ? fail("tope_corrida", "OBLIGATION_NOT_AUTHORIZED", `El total aprobable ${formatMinor(total, currency)} supera el tope de la plantilla ${formatMinor(input.template.runCapMinor, currency)}.`, [templateRef(input.template)])
        : pass("tope_corrida", "Total dentro del tope de la plantilla.", [templateRef(input.template)]),
      provisionRule(input, provision, total),
    );
  }

  return { lines: lines.map((line) => toDecision(line.lineInput, line.outcomes)), held };
}

// La provisión de la organización solo puede escalar: un total por encima de lo reservado
// pide una persona. Nunca habilita un pago ni fija su monto.
function provisionRule(input: FiscalRunInput, provision: FiscalProvision, total: number): RuleOutcome {
  const ruleId = "provision_suficiente";
  const currency = input.snapshot.currency;
  if (provision.provisionBps === null) {
    return pass(ruleId, "La organización no definió una provisión para impuestos.");
  }
  if (provision.reserveMinor === null) {
    return unknown(ruleId, "INSUFFICIENT_DATA", "Hay regla de provisión pero la contabilidad no reporta ingresos.");
  }
  if (total > provision.reserveMinor) {
    return fail(
      ruleId,
      "PROVISION_EXCEEDED",
      `El total aprobable ${formatMinor(total, currency)} supera la provisión de ${provision.provisionBps / 100} % de los ingresos (${formatMinor(provision.reserveMinor, currency)}).`,
      [templateRef(input.template), snapshotRef(input.snapshot)],
    );
  }
  return pass(ruleId, `Dentro de la provisión de ${formatMinor(provision.reserveMinor, currency)}.`, [templateRef(input.template), snapshotRef(input.snapshot)]);
}

// ---------------------------------------------------------------------------
// Provisión: cuánto reservar según la regla de la organización (plan de caja)
// ---------------------------------------------------------------------------

export type FiscalProvision = {
  incomeMinor: number | null; // ingresos del último mes cerrado según la contabilidad
  provisionBps: number | null; // regla de la organización; null = sin regla
  reserveMinor: number | null; // ingresos × provisión; null si falta cualquiera de los dos
  totalDraftMinor: number | null; // borradores vigilados y no pagados; null si alguno falta
  gapMinor: number | null; // lo que el total supera a la reserva (0 si alcanza)
};

export function fiscalProvision({ template, snapshot, run }: Omit<FiscalRunInput, "settlements" | "asOf">): FiscalProvision {
  const watched = new Set(template.taxes.map((tax) => tax.fiscalType));
  const paid = new Set(run.paidPeriods.map((p) => periodKey(p.fiscalType, p.periodStart)));
  const items = snapshot.items.filter((item) => watched.has(item.fiscalType) && !paid.has(periodKey(item.fiscalType, item.periodStart)));
  const totalDraftMinor = items.some((item) => item.draftAmountMinor === null)
    ? null
    : items.reduce((sum, item) => sum + (item.draftAmountMinor as number), 0);
  const incomeMinor = snapshot.income?.amountMinor ?? null;
  const provisionBps = template.provisionBps;
  // Enteros: ingresos × bps / 10000, redondeado hacia abajo (la reserva nunca se infla).
  const reserveMinor = incomeMinor === null || provisionBps === null ? null : Math.floor((incomeMinor * provisionBps) / 10_000);
  const gapMinor = reserveMinor === null || totalDraftMinor === null ? null : Math.max(totalDraftMinor - reserveMinor, 0);
  return { incomeMinor, provisionBps, reserveMinor, totalDraftMinor, gapMinor };
}

// ---------------------------------------------------------------------------
// Avisos T-7 / T-3: informan, no deciden
// ---------------------------------------------------------------------------

export type FiscalAlertInput = Omit<FiscalRunInput, "settlements">;

export type FiscalAlert = {
  fiscalType: FiscalType;
  displayName: string;
  periodStart: string;
  dueDate: string;
  daysUntilDue: number;
  level: "early" | "urgent";
  amountMinor: number | null; // borrador contable; null si la contabilidad no lo tiene
  currency: string;
  freeFundsMinor: number;
  fundsGapMinor: number | null; // lo que falta para cubrir este y los vencimientos anteriores
  reasonCodes: FiscalReasonCode[];
  message: string;
  dataOrigin: "fixture";
};

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY_MS);
}

export function fiscalAlerts({ template, snapshot, run, asOf }: FiscalAlertInput): FiscalAlert[] {
  const today = asOf.slice(0, 10);
  const watched = new Set(template.taxes.map((tax) => tax.fiscalType));
  const paid = new Set(run.paidPeriods.map((p) => periodKey(p.fiscalType, p.periodStart)));
  const free = freeFunds(run);
  const currency = snapshot.currency;

  const due = snapshot.items
    .filter((item) => watched.has(item.fiscalType) && !paid.has(periodKey(item.fiscalType, item.periodStart)))
    .map((item) => ({ item, daysUntilDue: daysBetween(today, item.dueDate) }))
    .filter(({ daysUntilDue }) => daysUntilDue >= 0 && daysUntilDue <= template.earlyAlertDays)
    .sort((a, b) => a.item.dueDate.localeCompare(b.item.dueDate) || a.item.fiscalType.localeCompare(b.item.fiscalType));

  // Brecha: todo lo que vence hasta esa fecha (incluida) frente a la caja libre.
  // Un monto desconocido deja la brecha desconocida.
  const dueUpTo = (dueDate: string): number | null => {
    let sum = 0;
    for (const { item } of due) {
      if (item.dueDate > dueDate) continue;
      if (item.draftAmountMinor === null) return null;
      sum += item.draftAmountMinor;
    }
    return sum;
  };
  return due.map(({ item, daysUntilDue }) => {
    const cumulative = dueUpTo(item.dueDate);
    const gap = cumulative === null ? null : Math.max(cumulative - Math.max(free, 0), 0);
    const level = daysUntilDue <= template.urgentAlertDays ? "urgent" : "early";
    const atRisk = level === "urgent" && (gap === null || gap > 0);
    const amountText = item.draftAmountMinor === null ? "monto desconocido" : `≈ ${formatMinor(item.draftAmountMinor, currency)}`;
    const fundsText =
      gap === null
        ? "No se puede calcular la brecha de fondos."
        : gap > 0
          ? `Fondos libres ${formatMinor(Math.max(free, 0), currency)}: faltan ${formatMinor(gap, currency)}.`
          : `Fondos libres ${formatMinor(Math.max(free, 0), currency)}: alcanzan.`;
    return {
      fiscalType: item.fiscalType,
      displayName: item.displayName,
      periodStart: item.periodStart,
      dueDate: item.dueDate,
      daysUntilDue,
      level,
      amountMinor: item.draftAmountMinor,
      currency,
      freeFundsMinor: free,
      fundsGapMinor: gap,
      reasonCodes: atRisk ? ["DEADLINE_AT_RISK"] : [],
      message: `${item.displayName} ${amountText} según tu contabilidad (simulada), vence el ${item.dueDate}. ${fundsText}`,
      dataOrigin: "fixture",
    };
  });
}
