/**
 * Purpose: almacén del puerto `ObligationStore` sobre Postgres (Prisma). Traduce fechas de calendario (`YYYY-MM-DD`) y
 *   BigInt (importes) de ida y vuelta, valida con Zod lo que sale de las columnas Json y apoya las garantías de la BD
 *   (índices únicos, trigger de solo inserción) en lugar de repetirlas.
 * Runs in: servidor.
 * Receives → Returns: un cliente de Prisma (o una transacción) → ObligationStore / StoreRuntime.
 * Talks to: src/lib/db (Prisma), schemas compartidos de obligaciones, schedule/calendar, store.ts.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { ObligationTemplateSchema } from "@/shared/schemas/obligation-config";
import type { LastConfirmed } from "./sources/buk/evidence-store";
import {
  ObligationSettingsSchema,
  fromBigInt,
  toBigInt,
  type ApprovalRequestRow,
  type AuditInput,
  type DecisionRow,
  type ObligationStore,
  type OccurrenceRow,
  type Outcome,
  type Phase,
  type RequestStatus,
  type SimulatedPaymentRow,
  type StoreRuntime,
  type StoredObligation,
} from "./store";

type Client = PrismaClient | Prisma.TransactionClient;

const day = (value: Date) => value.toISOString().slice(0, 10);
const instant = (value: Date) => value.toISOString();
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const json = (value: unknown) => value as Prisma.InputJsonValue;

function obligationOf(row: Prisma.PaymentObligationGetPayload<object>): StoredObligation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    obligationId: row.obligationId,
    version: row.version,
    kind: row.kind,
    status: row.status,
    template: ObligationTemplateSchema.parse(row.template),
    settings: ObligationSettingsSchema.parse(row.schedule),
    createdBy: row.createdBy,
    createdAt: instant(row.createdAt),
    activatedBy: row.activatedBy,
    activatedAt: row.activatedAt ? instant(row.activatedAt) : null,
  };
}

function occurrenceOf(row: Prisma.ObligationOccurrenceGetPayload<object>): OccurrenceRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    obligationId: row.obligationId,
    obligationVersion: row.obligationVersion,
    periodStart: day(row.periodStart),
    periodEnd: day(row.periodEnd),
    dueDate: day(row.dueDate),
    status: row.status,
    asOf: row.asOf ? instant(row.asOf) : null,
    evidenceSha: row.evidenceSha,
    evaluation: row.evaluation,
  };
}

function decisionOf(row: Prisma.ObligationLineDecisionGetPayload<object>): DecisionRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    occurrenceId: row.occurrenceId,
    lineId: row.lineId,
    counterpartyRef: row.counterpartyRef,
    displayName: row.displayName,
    lineType: row.lineType,
    amountMinor: row.amountMinor === null ? null : fromBigInt(row.amountMinor),
    currency: row.currency,
    decision: row.decision as Outcome,
    decisionSource: row.decisionSource === "human" ? "human" : "automatic",
    reasonCodes: row.reasonCodes as string[],
    rules: row.rules as DecisionRow["rules"],
    decisionKey: row.decisionKey,
    evidenceSha: row.evidenceSha,
    actorId: row.actorId,
    comment: row.comment,
    evaluatedAt: instant(row.evaluatedAt),
    createdAt: instant(row.createdAt),
  };
}

function requestOf(row: Prisma.ObligationApprovalRequestGetPayload<object>): ApprovalRequestRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    occurrenceId: row.occurrenceId,
    lineId: row.lineId,
    decisionId: row.decisionId,
    status: row.status as RequestStatus,
    requestedAt: instant(row.requestedAt),
    resolvedAt: row.resolvedAt ? instant(row.resolvedAt) : null,
    resolvedBy: row.resolvedBy,
    comment: row.comment,
  };
}

function paymentOf(row: Prisma.ObligationSimulatedPaymentGetPayload<object>): SimulatedPaymentRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    occurrenceId: row.occurrenceId,
    lineId: row.lineId,
    decisionId: row.decisionId,
    amountMinor: fromBigInt(row.amountMinor),
    currency: row.currency,
    executedAt: instant(row.executedAt),
  };
}

export class PrismaObligationStore implements ObligationStore {
  constructor(private db: Client) {}

  async listObligations(organizationId: string) {
    const rows = await this.db.paymentObligation.findMany({ where: { organizationId }, orderBy: [{ obligationId: "asc" }, { version: "desc" }] });
    return rows.map(obligationOf);
  }

  async latestActive(organizationId: string) {
    const rows = await this.db.paymentObligation.findMany({ where: { organizationId, status: "active" }, orderBy: [{ obligationId: "asc" }, { version: "desc" }] });
    const seen = new Set<string>();
    return rows.filter((row) => (seen.has(row.obligationId) ? false : (seen.add(row.obligationId), true))).map(obligationOf);
  }

  async getObligation(organizationId: string, obligationId: string, version: number) {
    const row = await this.db.paymentObligation.findUnique({ where: { organizationId_obligationId_version: { organizationId, obligationId, version } } });
    return row ? obligationOf(row) : null;
  }

  async insertObligation(input: Parameters<ObligationStore["insertObligation"]>[0]) {
    const row = await this.db.paymentObligation.create({
      data: {
        organizationId: input.organizationId,
        obligationId: input.obligationId,
        version: input.version,
        kind: input.kind,
        status: input.status,
        template: json(input.template),
        schedule: json(input.settings),
        createdBy: input.createdBy,
        activatedBy: input.activatedBy ?? null,
        activatedAt: input.activatedAt ? new Date(input.activatedAt) : null,
      },
    });
    return obligationOf(row);
  }

  async setObligationStatus(organizationId: string, obligationId: string, version: number, change: { status: StoredObligation["status"]; actorId: string; at: string }) {
    const current = await this.db.paymentObligation.findUnique({ where: { organizationId_obligationId_version: { organizationId, obligationId, version } } });
    if (!current) return null;
    const activatedBy = current.activatedBy ?? (change.status === "draft" ? null : change.actorId);
    const activatedAt = current.activatedAt ?? (change.status === "draft" ? null : new Date(change.at));
    const template = ObligationTemplateSchema.parse({
      ...(current.template as object),
      status: change.status,
      activatedBy,
      activatedAt: activatedAt ? activatedAt.toISOString() : null,
    });
    const row = await this.db.paymentObligation.update({
      where: { id: current.id },
      data: { status: change.status, activatedBy, activatedAt, template: json(template) },
    });
    return obligationOf(row);
  }

  async claimPhase(input: { organizationId: string; obligationId: string; periodStart: string; phase: Phase; asOf: string }) {
    const result = await this.db.obligationScheduleEvent.createMany({
      data: [{ organizationId: input.organizationId, obligationId: input.obligationId, periodStart: toDate(input.periodStart), phase: input.phase, asOf: new Date(input.asOf) }],
      skipDuplicates: true,
    });
    return result.count === 1;
  }

  async listPhaseClaims(organizationId: string, obligationId: string) {
    const rows = await this.db.obligationScheduleEvent.findMany({ where: { organizationId, obligationId }, orderBy: [{ periodStart: "asc" }, { claimedAt: "asc" }] });
    return rows.map((row) => ({ periodStart: day(row.periodStart), phase: row.phase as Phase, asOf: instant(row.asOf), claimedAt: instant(row.claimedAt) }));
  }

  async getOccurrence(organizationId: string, obligationId: string, periodStart: string) {
    const row = await this.db.obligationOccurrence.findUnique({ where: { organizationId_obligationId_periodStart: { organizationId, obligationId, periodStart: toDate(periodStart) } } });
    return row ? occurrenceOf(row) : null;
  }

  async getOccurrenceById(organizationId: string, id: string) {
    const row = await this.db.obligationOccurrence.findFirst({ where: { organizationId, id } });
    return row ? occurrenceOf(row) : null;
  }

  async listOccurrences(organizationId: string, limit: number) {
    const rows = await this.db.obligationOccurrence.findMany({ where: { organizationId }, orderBy: { periodStart: "desc" }, take: limit });
    return rows.map(occurrenceOf);
  }

  async upsertOccurrence(input: Omit<OccurrenceRow, "id">) {
    const data = {
      obligationVersion: input.obligationVersion,
      periodEnd: toDate(input.periodEnd),
      dueDate: toDate(input.dueDate),
      status: input.status,
      asOf: input.asOf ? new Date(input.asOf) : null,
      evidenceSha: input.evidenceSha,
      evaluation: input.evaluation === null || input.evaluation === undefined ? undefined : json(input.evaluation),
    };
    const row = await this.db.obligationOccurrence.upsert({
      where: { organizationId_obligationId_periodStart: { organizationId: input.organizationId, obligationId: input.obligationId, periodStart: toDate(input.periodStart) } },
      create: { organizationId: input.organizationId, obligationId: input.obligationId, periodStart: toDate(input.periodStart), ...data },
      update: data,
    });
    return occurrenceOf(row);
  }

  async insertDecision(input: Omit<DecisionRow, "id" | "createdAt">) {
    if (input.decisionSource === "automatic") {
      const existing = await this.db.obligationLineDecision.findFirst({ where: { organizationId: input.organizationId, decisionKey: input.decisionKey, decisionSource: "automatic" } });
      if (existing) return { row: decisionOf(existing), created: false };
    }
    const row = await this.db.obligationLineDecision.create({
      data: {
        organizationId: input.organizationId,
        occurrenceId: input.occurrenceId,
        lineId: input.lineId,
        counterpartyRef: input.counterpartyRef,
        displayName: input.displayName,
        lineType: input.lineType,
        amountMinor: input.amountMinor === null ? null : toBigInt(input.amountMinor),
        currency: input.currency,
        decision: input.decision,
        decisionSource: input.decisionSource,
        reasonCodes: json(input.reasonCodes),
        rules: json(input.rules),
        decisionKey: input.decisionKey,
        evidenceSha: input.evidenceSha,
        actorId: input.actorId,
        comment: input.comment,
        evaluatedAt: new Date(input.evaluatedAt),
      },
    });
    return { row: decisionOf(row), created: true };
  }

  async latestDecisions(organizationId: string, occurrenceId: string) {
    const rows = await this.db.obligationLineDecision.findMany({ where: { organizationId, occurrenceId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const latest = new Map<string, DecisionRow>();
    for (const row of rows) latest.set(row.lineId, decisionOf(row));
    return [...latest.values()];
  }

  async decisionHistory(organizationId: string, occurrenceId: string, lineId: string) {
    const rows = await this.db.obligationLineDecision.findMany({ where: { organizationId, occurrenceId, lineId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return rows.map(decisionOf);
  }

  async getDecision(organizationId: string, id: string) {
    const row = await this.db.obligationLineDecision.findFirst({ where: { organizationId, id } });
    return row ? decisionOf(row) : null;
  }

  async insertRequest(input: { organizationId: string; occurrenceId: string; lineId: string; decisionId: string; at: string }) {
    // Se comprueba ANTES de insertar: en Postgres una violación de unicidad aborta la transacción entera aunque el código la
    // atrape. La org está bloqueada (FOR UPDATE) en la transacción, así que comprobar y luego insertar no compite con nadie.
    const existing = await this.db.obligationApprovalRequest.findFirst({
      where: { organizationId: input.organizationId, OR: [{ occurrenceId: input.occurrenceId, lineId: input.lineId, status: "pending" }, { decisionId: input.decisionId }] },
    });
    if (existing) return null;
    const row = await this.db.obligationApprovalRequest.create({
      data: { organizationId: input.organizationId, occurrenceId: input.occurrenceId, lineId: input.lineId, decisionId: input.decisionId, requestedAt: new Date(input.at) },
    });
    return requestOf(row);
  }

  async getRequest(organizationId: string, id: string) {
    const row = await this.db.obligationApprovalRequest.findFirst({ where: { organizationId, id } });
    return row ? requestOf(row) : null;
  }

  async listRequests(organizationId: string, status: RequestStatus | null, limit: number) {
    const rows = await this.db.obligationApprovalRequest.findMany({ where: { organizationId, ...(status ? { status } : {}) }, orderBy: { requestedAt: "desc" }, take: limit });
    return rows.map(requestOf);
  }

  async resolveRequest(organizationId: string, id: string, change: { status: Exclude<RequestStatus, "pending">; by: string; comment: string | null; at: string }) {
    const result = await this.db.obligationApprovalRequest.updateMany({
      where: { id, organizationId, status: "pending" },
      data: { status: change.status, resolvedBy: change.by, comment: change.comment, resolvedAt: new Date(change.at) },
    });
    if (result.count !== 1) return null;
    return this.getRequest(organizationId, id);
  }

  async recordPayment(input: Omit<SimulatedPaymentRow, "id">) {
    const result = await this.db.obligationSimulatedPayment.createMany({
      data: [
        {
          organizationId: input.organizationId,
          occurrenceId: input.occurrenceId,
          lineId: input.lineId,
          decisionId: input.decisionId,
          amountMinor: toBigInt(input.amountMinor),
          currency: input.currency,
          executedAt: new Date(input.executedAt),
        },
      ],
      skipDuplicates: true,
    });
    return result.count === 1;
  }

  async listPayments(organizationId: string, occurrenceId: string) {
    const rows = await this.db.obligationSimulatedPayment.findMany({ where: { organizationId, occurrenceId }, orderBy: { createdAt: "asc" } });
    return rows.map(paymentOf);
  }

  async confirmations(organizationId: string, obligationId: string) {
    const rows = await this.db.obligationConfirmation.findMany({ where: { organizationId, obligationId } });
    const out: Record<string, LastConfirmed> = {};
    for (const row of rows) out[row.counterpartyRef] = { beneficiaryReference: row.beneficiaryReference, amountMinor: fromBigInt(row.amountMinor) };
    return out;
  }

  async upsertConfirmation(input: { organizationId: string; obligationId: string; counterpartyRef: string; beneficiaryReference: string | null; amountMinor: number; confirmedPeriod: string }) {
    const data = { beneficiaryReference: input.beneficiaryReference, amountMinor: toBigInt(input.amountMinor), confirmedPeriod: toDate(input.confirmedPeriod) };
    await this.db.obligationConfirmation.upsert({
      where: { organizationId_obligationId_counterpartyRef: { organizationId: input.organizationId, obligationId: input.obligationId, counterpartyRef: input.counterpartyRef } },
      create: { organizationId: input.organizationId, obligationId: input.obligationId, counterpartyRef: input.counterpartyRef, ...data },
      update: data,
    });
  }

  async audit(input: AuditInput) {
    await this.db.auditEvent.create({
      data: { organizationId: input.organizationId, entityType: input.entityType, entityId: input.entityId, eventType: input.eventType, actorId: input.actorId, payload: json(input.payload) },
    });
  }

  async getDemoClock(organizationId: string) {
    const row = await this.db.demoClock.findUnique({ where: { organizationId } });
    return row ? instant(row.now) : null;
  }

  async setDemoClock(organizationId: string, now: string, by: string) {
    await this.db.demoClock.upsert({
      where: { organizationId },
      create: { organizationId, now: new Date(now), updatedBy: by },
      update: { now: new Date(now), updatedBy: by, updatedAt: new Date() },
    });
  }
}

/** Bloquea la fila de la organización: serializa decisiones, ticks y aprobaciones concurrentes sobre los mismos fondos. */
async function lockOrganization(tx: Prisma.TransactionClient, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
}

export function createPrismaRuntime(client: PrismaClient): StoreRuntime {
  return {
    store: new PrismaObligationStore(client),
    transaction: (organizationId, fn) =>
      client.$transaction(
        async (tx) => {
          await lockOrganization(tx, organizationId);
          return fn(new PrismaObligationStore(tx));
        },
        { maxWait: 10_000, timeout: 20_000 },
      ),
  };
}

/** Runtime sobre una transacción ya abierta (por ejemplo la de una prueba que se revierte al final). */
export function createRuntimeOverTransaction(tx: Prisma.TransactionClient): StoreRuntime {
  return {
    store: new PrismaObligationStore(tx),
    transaction: async (organizationId, fn) => {
      await lockOrganization(tx, organizationId);
      return fn(new PrismaObligationStore(tx));
    },
  };
}
