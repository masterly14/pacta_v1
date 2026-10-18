/**
 * Purpose: almacén en memoria del puerto `ObligationStore`. Reproduce las garantías de la BD que la lógica necesita
 *   (fases reclamadas una sola vez, decisión automática idempotente, una solicitud pendiente por línea, un pago por
 *   línea, solo inserción) para probar el tick y la aprobación sin una base de datos.
 * Runs in: pruebas y desarrollo local. No es una opción de producción: no persiste nada.
 */
import type { LastConfirmed } from "./sources/buk/evidence-store";
import type {
  ApprovalRequestRow,
  AuditInput,
  DecisionRow,
  ObligationStore,
  OccurrenceRow,
  Phase,
  SimulatedPaymentRow,
  StoreRuntime,
  StoredObligation,
} from "./store";

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${String(++counter).padStart(6, "0")}`;
const clone = <T>(value: T): T => structuredClone(value);

export class MemoryObligationStore implements ObligationStore {
  obligations: StoredObligation[] = [];
  claims: { organizationId: string; obligationId: string; periodStart: string; phase: Phase; asOf: string; claimedAt: string }[] = [];
  occurrences: OccurrenceRow[] = [];
  decisions: DecisionRow[] = [];
  requests: ApprovalRequestRow[] = [];
  payments: SimulatedPaymentRow[] = [];
  confirmed = new Map<string, LastConfirmed & { confirmedPeriod: string }>();
  audits: AuditInput[] = [];
  clocks = new Map<string, string>();
  /** Reloj lógico para `createdAt`: cada inserción avanza un milisegundo, así el orden de inserción es el orden de lectura. */
  private tick = 0;
  private stamp() {
    return new Date(Date.UTC(2026, 0, 1) + ++this.tick).toISOString();
  }

  async listObligations(organizationId: string) {
    return clone(this.obligations.filter((o) => o.organizationId === organizationId).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.version - a.version));
  }

  async latestActive(organizationId: string) {
    const byId = new Map<string, StoredObligation>();
    for (const o of this.obligations.filter((x) => x.organizationId === organizationId && x.status === "active")) {
      const current = byId.get(o.obligationId);
      if (!current || o.version > current.version) byId.set(o.obligationId, o);
    }
    return clone([...byId.values()]);
  }

  async getObligation(organizationId: string, obligationId: string, version: number) {
    const found = this.obligations.find((o) => o.organizationId === organizationId && o.obligationId === obligationId && o.version === version);
    return found ? clone(found) : null;
  }

  async insertObligation(input: Parameters<ObligationStore["insertObligation"]>[0]) {
    if (this.obligations.some((o) => o.organizationId === input.organizationId && o.obligationId === input.obligationId && o.version === input.version)) {
      throw new Error("La versión de la obligación ya existe");
    }
    const row: StoredObligation = { ...input, id: nextId("obl"), createdAt: this.stamp(), activatedBy: input.activatedBy ?? null, activatedAt: input.activatedAt ?? null };
    this.obligations.push(row);
    return clone(row);
  }

  async setObligationStatus(organizationId: string, obligationId: string, version: number, change: { status: StoredObligation["status"]; actorId: string; at: string }) {
    const row = this.obligations.find((o) => o.organizationId === organizationId && o.obligationId === obligationId && o.version === version);
    if (!row) return null;
    row.status = change.status;
    if (change.status !== "draft") {
      row.activatedBy = row.activatedBy ?? change.actorId;
      row.activatedAt = row.activatedAt ?? change.at;
      row.template = { ...row.template, status: change.status, activatedBy: row.activatedBy, activatedAt: row.activatedAt };
    }
    return clone(row);
  }

  async claimPhase(input: { organizationId: string; obligationId: string; periodStart: string; phase: Phase; asOf: string }) {
    const exists = this.claims.some((c) => c.organizationId === input.organizationId && c.obligationId === input.obligationId && c.periodStart === input.periodStart && c.phase === input.phase);
    if (exists) return false;
    this.claims.push({ ...input, claimedAt: this.stamp() });
    return true;
  }

  async listPhaseClaims(organizationId: string, obligationId: string) {
    return this.claims.filter((c) => c.organizationId === organizationId && c.obligationId === obligationId).map(({ periodStart, phase, asOf, claimedAt }) => ({ periodStart, phase, asOf, claimedAt }));
  }

  async getOccurrence(organizationId: string, obligationId: string, periodStart: string) {
    const found = this.occurrences.find((o) => o.organizationId === organizationId && o.obligationId === obligationId && o.periodStart === periodStart);
    return found ? clone(found) : null;
  }

  async getOccurrenceById(organizationId: string, id: string) {
    const found = this.occurrences.find((o) => o.organizationId === organizationId && o.id === id);
    return found ? clone(found) : null;
  }

  async listOccurrences(organizationId: string, limit: number) {
    return clone(this.occurrences.filter((o) => o.organizationId === organizationId).sort((a, b) => b.periodStart.localeCompare(a.periodStart)).slice(0, limit));
  }

  async upsertOccurrence(input: Omit<OccurrenceRow, "id">) {
    const found = this.occurrences.find((o) => o.organizationId === input.organizationId && o.obligationId === input.obligationId && o.periodStart === input.periodStart);
    if (found) {
      Object.assign(found, input);
      return clone(found);
    }
    const row: OccurrenceRow = { ...input, id: nextId("occ") };
    this.occurrences.push(row);
    return clone(row);
  }

  async insertDecision(input: Omit<DecisionRow, "id" | "createdAt">) {
    if (input.decisionSource === "automatic") {
      const existing = this.decisions.find((d) => d.organizationId === input.organizationId && d.decisionKey === input.decisionKey && d.decisionSource === "automatic");
      if (existing) return { row: clone(existing), created: false };
    }
    const row: DecisionRow = { ...clone(input), id: nextId("dec"), createdAt: this.stamp() };
    this.decisions.push(row);
    return { row: clone(row), created: true };
  }

  async latestDecisions(organizationId: string, occurrenceId: string) {
    const latest = new Map<string, DecisionRow>();
    for (const d of this.decisions.filter((x) => x.organizationId === organizationId && x.occurrenceId === occurrenceId)) latest.set(d.lineId, d); // el orden de inserción manda
    return clone([...latest.values()]);
  }

  async decisionHistory(organizationId: string, occurrenceId: string, lineId: string) {
    return clone(this.decisions.filter((d) => d.organizationId === organizationId && d.occurrenceId === occurrenceId && d.lineId === lineId));
  }

  async getDecision(organizationId: string, id: string) {
    const found = this.decisions.find((d) => d.organizationId === organizationId && d.id === id);
    return found ? clone(found) : null;
  }

  async insertRequest(input: { organizationId: string; occurrenceId: string; lineId: string; decisionId: string; at: string }) {
    if (this.requests.some((r) => r.occurrenceId === input.occurrenceId && r.lineId === input.lineId && r.status === "pending")) return null;
    const row: ApprovalRequestRow = {
      id: nextId("req"),
      organizationId: input.organizationId,
      occurrenceId: input.occurrenceId,
      lineId: input.lineId,
      decisionId: input.decisionId,
      status: "pending",
      requestedAt: input.at,
      resolvedAt: null,
      resolvedBy: null,
      comment: null,
    };
    this.requests.push(row);
    return clone(row);
  }

  async getRequest(organizationId: string, id: string) {
    const found = this.requests.find((r) => r.organizationId === organizationId && r.id === id);
    return found ? clone(found) : null;
  }

  async listRequests(organizationId: string, status: ApprovalRequestRow["status"] | null, limit: number) {
    return clone(this.requests.filter((r) => r.organizationId === organizationId && (status === null || r.status === status)).slice(-limit));
  }

  async resolveRequest(organizationId: string, id: string, change: { status: Exclude<ApprovalRequestRow["status"], "pending">; by: string; comment: string | null; at: string }) {
    const row = this.requests.find((r) => r.organizationId === organizationId && r.id === id && r.status === "pending");
    if (!row) return null;
    Object.assign(row, { status: change.status, resolvedBy: change.by, comment: change.comment, resolvedAt: change.at });
    return clone(row);
  }

  async recordPayment(input: Omit<SimulatedPaymentRow, "id">) {
    if (this.payments.some((p) => p.occurrenceId === input.occurrenceId && p.lineId === input.lineId)) return false;
    this.payments.push({ ...input, id: nextId("pay") });
    return true;
  }

  async listPayments(organizationId: string, occurrenceId: string) {
    return clone(this.payments.filter((p) => p.organizationId === organizationId && p.occurrenceId === occurrenceId));
  }

  async confirmations(organizationId: string, obligationId: string) {
    const out: Record<string, LastConfirmed> = {};
    for (const [key, value] of this.confirmed) {
      if (key.startsWith(`${organizationId}|${obligationId}|`)) out[key.split("|")[2]!] = { beneficiaryReference: value.beneficiaryReference, amountMinor: value.amountMinor };
    }
    return out;
  }

  async upsertConfirmation(input: { organizationId: string; obligationId: string; counterpartyRef: string; beneficiaryReference: string | null; amountMinor: number; confirmedPeriod: string }) {
    this.confirmed.set(`${input.organizationId}|${input.obligationId}|${input.counterpartyRef}`, {
      beneficiaryReference: input.beneficiaryReference,
      amountMinor: input.amountMinor,
      confirmedPeriod: input.confirmedPeriod,
    });
  }

  async audit(input: AuditInput) {
    this.audits.push(clone(input));
  }

  async getDemoClock(organizationId: string) {
    return this.clocks.get(organizationId) ?? null;
  }

  async setDemoClock(organizationId: string, now: string) {
    this.clocks.set(organizationId, now);
  }
}

/** Runtime en memoria: la transacción es la propia ejecución (una sola hebra) y revierte si `fn` lanza. */
export function createMemoryRuntime(store = new MemoryObligationStore()): StoreRuntime & { store: MemoryObligationStore } {
  return {
    store,
    async transaction(_organizationId, fn) {
      const snapshot = {
        obligations: clone(store.obligations),
        claims: clone(store.claims),
        occurrences: clone(store.occurrences),
        decisions: clone(store.decisions),
        requests: clone(store.requests),
        payments: clone(store.payments),
        confirmed: new Map(store.confirmed),
        audits: clone(store.audits),
        clocks: new Map(store.clocks),
      };
      try {
        return await fn(store);
      } catch (error) {
        Object.assign(store, snapshot);
        throw error;
      }
    },
  };
}
