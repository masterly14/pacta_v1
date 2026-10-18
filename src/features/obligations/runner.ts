/**
 * Purpose: servicio de una ocurrencia de nómina: evaluar con evidencia fresca, guardar las decisiones, avisar y ejecutar
 *   (en simulación). Es el único lugar donde las reglas de seguridad de la ejecución viven:
 *   - se REEVALÚA justo antes de pagar (una novedad posterior revierte una aprobación);
 *   - una aprobación humana vale solo para los motivos que la persona vio y los términos que aprobó (monto, moneda,
 *     cuenta); un motivo nuevo o un término distinto exige otra aprobación;
 *   - con la plantilla pausada o en borrador (releída dentro de la transacción) no se paga nada;
 *   - un bloqueo absoluto prevalece sobre cualquier aprobación humana;
 *   - a lo sumo un pago simulado por línea (único en BD) y nunca sin importe ni moneda.
 * Runs in: servidor y pruebas (el almacén es un puerto).
 * Receives → Returns: contexto { organización, obligación, periodo, asOf, almacén, fuente } → resumen de la corrida.
 * Talks to: engine/obligations/payroll, sources/buk, learning (hallazgos), store.ts.
 */
import { createHash } from "node:crypto";
import { decidePayrollRun, type PayrollLineDecision, type PayrollRunResult } from "@/features/decisions/engine/obligations/payroll";
import type { ObligationContext, ObligationPeriod } from "@/shared/schemas/obligation-context";
import type { LearnedFinding } from "./learning/types";
import { LiveEvidenceStore } from "./live-evidence";
import { FileTransport } from "./fixtures/buk/scenario";
import { BukPayrollReader, createBukObligationSource } from "./sources/buk/source";
import type { ObligationStore, OccurrenceRow, StoredObligation } from "./store";
import type { ScheduledDue } from "./schedule/dates";

/** Lo que el runner necesita de la fuente de RR. HH. (el mock de Buk en la demo). */
export type PayrollFacts = { lines: ObligationContext[]; occurrence: import("@/shared/schemas/obligation-context").OccurrenceContext; dataset: import("@/shared/schemas/obligation-config").PayrollDataset };

export type PayrollFactsOpener = (input: {
  obligation: StoredObligation;
  due: ScheduledDue;
  asOf: string;
  confirmed: Awaited<ReturnType<ObligationStore["confirmations"]>>;
}) => Promise<PayrollFacts>;

/** Fuente de la demo: el escenario de Buk guardado en la obligación, leído de los payloads del repositorio. */
export const openFixturePayroll: PayrollFactsOpener = async ({ obligation, due, asOf, confirmed }) => {
  const month = due.periodStart.slice(0, 7);
  const store = new LiveEvidenceStore(asOf, confirmed);
  const reader = new BukPayrollReader(new FileTransport(obligation.settings.source.scenario), store);
  const raw = await reader.load(month);
  const source = createBukObligationSource(raw, store, { organizationId: obligation.organizationId, currency: obligation.template.currency });
  const period: ObligationPeriod = { periodStart: due.periodStart, periodEnd: due.periodEnd, dueDate: due.dueDate };
  const built = source.occurrence(obligation.template, asOf, period);
  return { lines: built.lines, occurrence: built.occurrence, dataset: built.dataset };
};

/** Hallazgos aprendidos por línea (F2/F4). Opcional: sin él rigen solo las reglas fijas. */
export type LearnedProvider = (input: { obligation: StoredObligation; facts: PayrollFacts; month: string }) => Promise<ReadonlyMap<string, readonly LearnedFinding[]>>;

export type RunDeps = {
  store: ObligationStore;
  openFacts: PayrollFactsOpener;
  learned?: LearnedProvider;
};

export type Evaluation = { result: PayrollRunResult; facts: PayrollFacts; evidenceShaByLine: Map<string, string> };

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Evalúa la ocurrencia con la evidencia vigente en `asOf`. No escribe nada. */
export async function evaluateOccurrence(deps: RunDeps, obligation: StoredObligation, due: ScheduledDue, asOf: string): Promise<Evaluation> {
  const confirmed = await deps.store.confirmations(obligation.organizationId, obligation.obligationId);
  const facts = await deps.openFacts({ obligation, due, asOf, confirmed });
  const learned = deps.learned ? await deps.learned({ obligation, facts, month: due.periodStart.slice(0, 7) }) : undefined;
  const result = decidePayrollRun({ template: obligation.template, occurrence: facts.occurrence, lines: facts.lines, dataset: facts.dataset, learned });

  // La clave de una decisión depende de TODO lo que la determina: evidencia congelada, último monto/cuenta confirmados,
  // novedades, versión de la plantilla, día de la evaluación y el resultado. Misma evidencia → misma clave → una sola fila.
  const evidenceShaByLine = new Map<string, string>();
  for (const line of facts.lines) {
    const decision = result.lines.find((candidate) => candidate.lineId === line.lineId)!;
    evidenceShaByLine.set(
      line.lineId,
      sha({
        evidence: line.evidence.map((snapshot) => snapshot.sha256).sort(),
        confirmed: [line.lastConfirmedAmountMinor, line.lastConfirmedBeneficiaryReference],
        signals: line.signals.map((signal) => `${signal.signalId}:${signal.status}`).sort(),
        template: [obligation.version, obligation.template.status],
        day: asOf.slice(0, 10),
        decision: [decision.decision, [...decision.reasonCodes].sort()],
      }),
    );
  }
  return { result, facts, evidenceShaByLine };
}

const occurrenceStatusOf = (status: PayrollRunResult["status"]): OccurrenceRow["status"] => status;

/**
 * Términos que una persona aprueba: a quién, qué concepto, cuánto, en qué moneda y a qué cuenta. Se guardan como
 * `evidenceSha` de la decisión humana; si al pagar cualquiera cambió, la aprobación ya no cubre la línea.
 */
export function approvedTermsSha(line: Pick<PayrollLineDecision, "lineId" | "counterpartyRef" | "lineType" | "amountMinor" | "currency">, beneficiaryAccountReference: string | null): string {
  return sha({ approvedTerms: [line.lineId, line.counterpartyRef, line.lineType, line.amountMinor, line.currency, beneficiaryAccountReference] });
}

/** Términos de una línea fresca, con la cuenta que trae la evidencia vigente. */
export function freshTermsSha(evaluation: Evaluation, line: PayrollLineDecision): string {
  const source = evaluation.facts.lines.find((candidate) => candidate.lineId === line.lineId);
  return approvedTermsSha(line, source?.beneficiaryAccountReference ?? null);
}

/** Una plantilla pausada o en borrador no paga, ni siquiera por una aprobación humana anterior. */
export const isObligationActive = (obligation: StoredObligation) => obligation.status === "active" && obligation.template.status === "active";

/**
 * ¿La aprobación humana vigente sigue cubriendo lo que dice la evaluación fresca? Solo si no hay bloqueo, no apareció un
 * motivo que la persona no vio y los términos (monto, moneda, cuenta) son los mismos que aprobó.
 */
export function humanApprovalStillCovers(human: { decision: string; reasonCodes: string[]; evidenceSha: string } | null, fresh: PayrollLineDecision, termsSha: string): boolean {
  if (!human || human.decision !== "approved") return false;
  if (fresh.decision === "blocked") return false; // un bloqueo absoluto prevalece
  if (human.evidenceSha !== termsSha) return false; // otro monto, moneda o cuenta exige otra aprobación
  return fresh.reasonCodes.every((code) => human.reasonCodes.includes(code));
}

/** Guarda la ocurrencia y las decisiones de una evaluación. Idempotente: la misma evidencia no duplica filas. */
export async function persistEvaluation(deps: RunDeps, obligation: StoredObligation, due: ScheduledDue, asOf: string, evaluation: Evaluation) {
  const { store } = deps;
  const { result } = evaluation;
  const existing = await store.getOccurrence(obligation.organizationId, obligation.obligationId, due.periodStart);
  const evidenceSha = sha([...evaluation.evidenceShaByLine.entries()].sort());
  const occurrence = await store.upsertOccurrence({
    organizationId: obligation.organizationId,
    obligationId: obligation.obligationId,
    obligationVersion: obligation.version,
    periodStart: due.periodStart,
    periodEnd: due.periodEnd,
    dueDate: due.dueDate,
    // una corrida ya pagada no vuelve atrás por reevaluar; el estado lo recalcula la ejecución
    status: existing?.status === "simulated_executed" ? "simulated_executed" : occurrenceStatusOf(result.status),
    asOf,
    evidenceSha,
    evaluation: { counts: result.counts, runFindings: result.runFindings, status: result.status, asOf },
  });

  const latest = new Map((await store.latestDecisions(obligation.organizationId, occurrence.id)).map((row) => [row.lineId, row]));
  for (const line of result.lines) {
    const current = latest.get(line.lineId) ?? null;
    // No pisa una aprobación humana que sigue cubriendo la evaluación fresca; un motivo nuevo o un bloqueo sí la reemplazan.
    if (current?.decisionSource === "human" && humanApprovalStillCovers(current, line, freshTermsSha(evaluation, line))) continue;
    // Una persona que rechazó la línea cierra su historia: reevaluar no la reabre.
    if (current?.decisionSource === "human" && current.decision === "blocked") continue;
    const key = `${occurrence.id}:${line.lineId}:${evaluation.evidenceShaByLine.get(line.lineId)}`;
    const { row, created } = await store.insertDecision({
      organizationId: obligation.organizationId,
      occurrenceId: occurrence.id,
      lineId: line.lineId,
      counterpartyRef: line.counterpartyRef,
      displayName: line.displayName,
      lineType: line.lineType,
      amountMinor: line.amountMinor,
      currency: line.currency,
      decision: line.decision,
      decisionSource: "automatic",
      reasonCodes: line.reasonCodes,
      rules: line.rules,
      decisionKey: key,
      evidenceSha: evaluation.evidenceShaByLine.get(line.lineId)!,
      actorId: null,
      comment: null,
      evaluatedAt: asOf,
    });
    if (line.decision === "requires_approval" && (created || current?.decision !== "requires_approval")) {
      await store.insertRequest({ organizationId: obligation.organizationId, occurrenceId: occurrence.id, lineId: line.lineId, decisionId: row.id, at: asOf });
    }
  }
  return occurrence;
}

export type PrepareSummary = { occurrenceId: string; status: OccurrenceRow["status"]; counts: PayrollRunResult["counts"]; pending: number };

/** Fase `prepare`: lee RR. HH., evalúa, guarda y abre las solicitudes humanas. */
export async function prepareOccurrence(deps: RunDeps, obligation: StoredObligation, due: ScheduledDue, asOf: string): Promise<PrepareSummary> {
  const evaluation = await evaluateOccurrence(deps, obligation, due, asOf);
  const occurrence = await persistEvaluation(deps, obligation, due, asOf, evaluation);
  await deps.store.audit({
    organizationId: obligation.organizationId,
    entityType: "obligation_occurrence",
    entityId: occurrence.id,
    eventType: "obligation_run.prepared",
    actorId: null,
    payload: { obligationId: obligation.obligationId, periodStart: due.periodStart, asOf, counts: evaluation.result.counts, status: evaluation.result.status, dataOrigin: "fixture" },
  });
  return { occurrenceId: occurrence.id, status: occurrence.status, counts: evaluation.result.counts, pending: evaluation.result.counts.requires_approval };
}

/** Fases `alert_early` y `alert_urgent`: resumen de lo que sigue pendiente. Solo informa; no decide ni paga. */
export async function alertOccurrence(deps: RunDeps, obligation: StoredObligation, due: ScheduledDue, asOf: string, phase: "alert_early" | "alert_urgent") {
  const occurrence = await deps.store.getOccurrence(obligation.organizationId, obligation.obligationId, due.periodStart);
  const decisions = occurrence ? await deps.store.latestDecisions(obligation.organizationId, occurrence.id) : [];
  const pending = decisions.filter((d) => d.decision === "requires_approval").length;
  const blocked = decisions.filter((d) => d.decision === "blocked").length;
  await deps.store.audit({
    organizationId: obligation.organizationId,
    entityType: "obligation_occurrence",
    entityId: occurrence?.id ?? `${obligation.obligationId}:${due.periodStart}`,
    eventType: `obligation_run.${phase}`,
    actorId: null,
    payload: { obligationId: obligation.obligationId, dueDate: due.dueDate, asOf, pending, blocked, urgent: phase === "alert_urgent" && pending > 0 },
  });
  return { pending, blocked };
}

export type ExecuteSummary = { occurrenceId: string; status: OccurrenceRow["status"]; paid: number; pending: number; blocked: number };

/**
 * Ejecución SIMULADA. Reevalúa con evidencia vigente y paga solo lo que sigue siendo pagable:
 * aprobada por las reglas, o aprobada por una persona y todavía cubierta por esa aprobación. No mueve dinero.
 */
export async function executeOccurrence(deps: RunDeps, given: StoredObligation, due: ScheduledDue, asOf: string): Promise<ExecuteSummary> {
  const { store } = deps;
  // Se relee la plantilla dentro de la transacción: una pausa que entró después de leerla fuera del bloqueo debe valer.
  const obligation = (await store.getObligation(given.organizationId, given.obligationId, given.version)) ?? given;
  const active = isObligationActive(obligation);
  const evaluation = await evaluateOccurrence(deps, obligation, due, asOf);
  const occurrence = await persistEvaluation(deps, obligation, due, asOf, evaluation);
  const latest = new Map((await store.latestDecisions(obligation.organizationId, occurrence.id)).map((row) => [row.lineId, row]));

  let paid = 0;
  let pending = 0;
  let blocked = 0;
  for (const line of evaluation.result.lines) {
    const current = latest.get(line.lineId)!;
    const humanRejected = current.decisionSource === "human" && current.decision === "blocked";
    if (humanRejected) {
      blocked++;
      continue;
    }
    const payable =
      active && (line.decision === "approved" || humanApprovalStillCovers(current.decisionSource === "human" ? current : null, line, freshTermsSha(evaluation, line)));
    if (!payable || line.amountMinor === null || line.currency === null) {
      if (line.decision === "blocked") blocked++;
      else pending++;
      continue;
    }
    const registered = await store.recordPayment({
      organizationId: obligation.organizationId,
      occurrenceId: occurrence.id,
      lineId: line.lineId,
      decisionId: current.id,
      amountMinor: line.amountMinor,
      currency: line.currency,
      executedAt: asOf,
    });
    paid++;
    if (!registered) continue; // ya estaba pagada: idempotente
    const source = evaluation.facts.lines.find((candidate) => candidate.lineId === line.lineId)!;
    if (line.lineType === "salary") {
      await store.upsertConfirmation({
        organizationId: obligation.organizationId,
        obligationId: obligation.obligationId,
        counterpartyRef: line.counterpartyRef,
        beneficiaryReference: source.beneficiaryAccountReference,
        amountMinor: line.amountMinor,
        confirmedPeriod: due.periodStart,
      });
    }
    await store.audit({
      organizationId: obligation.organizationId,
      entityType: "obligation_occurrence",
      entityId: occurrence.id,
      eventType: "simulated_payment.registered",
      actorId: current.actorId,
      payload: { lineId: line.lineId, counterpartyRef: line.counterpartyRef, amountMinor: line.amountMinor, currency: line.currency, decisionId: current.id, simulated: true },
    });
  }

  const totalPaid = (await store.listPayments(obligation.organizationId, occurrence.id)).length;
  const status: OccurrenceRow["status"] =
    evaluation.result.status === "held" ? "held" : pending > 0 ? "in_approval" : totalPaid > 0 || evaluation.result.lines.every((l) => l.decision === "blocked") ? "simulated_executed" : "ready_to_execute";
  await store.upsertOccurrence({ ...occurrence, status, asOf });
  await store.audit({
    organizationId: obligation.organizationId,
    entityType: "obligation_occurrence",
    entityId: occurrence.id,
    eventType: "obligation_run.executed",
    actorId: null,
    payload: { obligationId: obligation.obligationId, periodStart: due.periodStart, asOf, paid, pending, blocked, status, simulated: true },
  });
  return { occurrenceId: occurrence.id, status, paid, pending, blocked };
}
