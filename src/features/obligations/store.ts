/**
 * Purpose: puerto de persistencia del Core proactivo (plantillas, ocurrencias, decisiones por línea, solicitudes, fases del
 *   calendario, pagos simulados, montos confirmados, reloj de demo). La lógica (tick, ejecución, aprobación) solo habla con
 *   este puerto: se prueba con el almacén en memoria y corre sobre Postgres con el almacén de Prisma.
 * Runs in: servidor y pruebas.
 * Receives → Returns: ver cada método. Importes en unidades menores como `number` (entero seguro); en BD son BigInt.
 * Seguridad: toda consulta lleva `organizationId`; las decisiones y los pagos son de solo inserción.
 */
import { z } from "zod";
import type { ObligationKind, ObligationStatus, ObligationTemplate } from "@/shared/schemas/obligation-config";
import type { OccurrenceStatus } from "@/shared/schemas/obligation-context";
import type { PayrollRuleEvaluation } from "@/features/decisions/engine/obligations/payroll";
import type { LastConfirmed } from "./sources/buk/evidence-store";
import { ScheduleSchema } from "./schedule/calendar";

/** Ajustes de una obligación que no son parte de la plantilla compartida: calendario y fuente de datos. */
export const ObligationSettingsSchema = z.strictObject({
  schedule: ScheduleSchema,
  /** De dónde salen los datos de RR. HH.: el mock de Buk con el escenario indicado. */
  source: z.strictObject({ provider: z.literal("buk_fixture"), scenario: z.string().regex(/^[a-z0-9-]+$/) }),
});
export type ObligationSettings = z.infer<typeof ObligationSettingsSchema>;

export type StoredObligation = {
  id: string;
  organizationId: string;
  obligationId: string;
  version: number;
  kind: ObligationKind;
  status: ObligationStatus;
  template: ObligationTemplate;
  settings: ObligationSettings;
  createdBy: string;
  createdAt: string;
  activatedBy: string | null;
  activatedAt: string | null;
};

export type OccurrenceRow = {
  id: string;
  organizationId: string;
  obligationId: string;
  obligationVersion: number;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: OccurrenceStatus;
  asOf: string | null;
  evidenceSha: string | null;
  evaluation: unknown;
};

export type Decider = "automatic" | "human";
export type Outcome = "approved" | "blocked" | "requires_approval";

export type DecisionRow = {
  id: string;
  organizationId: string;
  occurrenceId: string;
  lineId: string;
  counterpartyRef: string;
  displayName: string;
  lineType: string;
  amountMinor: number | null;
  currency: string | null;
  decision: Outcome;
  decisionSource: Decider;
  reasonCodes: string[];
  rules: PayrollRuleEvaluation[];
  decisionKey: string;
  evidenceSha: string;
  actorId: string | null;
  comment: string | null;
  evaluatedAt: string;
  createdAt: string;
};

export type NewDecision = Omit<DecisionRow, "id" | "createdAt">;

export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export type ApprovalRequestRow = {
  id: string;
  organizationId: string;
  occurrenceId: string;
  lineId: string;
  decisionId: string;
  status: RequestStatus;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  comment: string | null;
};

export type SimulatedPaymentRow = {
  id: string;
  organizationId: string;
  occurrenceId: string;
  lineId: string;
  decisionId: string;
  amountMinor: number;
  currency: string;
  executedAt: string;
};

export type AuditInput = { organizationId: string; entityType: string; entityId: string; eventType: string; actorId: string | null; payload: unknown };

export type Phase = "prepare" | "alert_early" | "alert_urgent" | "execute";

export interface ObligationStore {
  // Plantillas
  listObligations(organizationId: string): Promise<StoredObligation[]>;
  /** La última versión ACTIVA de cada obligación. */
  latestActive(organizationId: string): Promise<StoredObligation[]>;
  getObligation(organizationId: string, obligationId: string, version: number): Promise<StoredObligation | null>;
  insertObligation(input: Omit<StoredObligation, "id" | "createdAt" | "activatedBy" | "activatedAt"> & { activatedBy?: string | null; activatedAt?: string | null }): Promise<StoredObligation>;
  setObligationStatus(organizationId: string, obligationId: string, version: number, change: { status: ObligationStatus; actorId: string; at: string }): Promise<StoredObligation | null>;

  // Calendario: reclamar una fase es atómico y sucede una sola vez
  claimPhase(input: { organizationId: string; obligationId: string; periodStart: string; phase: Phase; asOf: string }): Promise<boolean>;
  listPhaseClaims(organizationId: string, obligationId: string): Promise<{ periodStart: string; phase: Phase; asOf: string; claimedAt: string }[]>;

  // Ocurrencias
  getOccurrence(organizationId: string, obligationId: string, periodStart: string): Promise<OccurrenceRow | null>;
  getOccurrenceById(organizationId: string, id: string): Promise<OccurrenceRow | null>;
  listOccurrences(organizationId: string, limit: number): Promise<OccurrenceRow[]>;
  upsertOccurrence(input: Omit<OccurrenceRow, "id">): Promise<OccurrenceRow>;

  // Decisiones (solo inserción)
  /** Idempotente para decisiones automáticas: la misma evidencia no crea otra fila. */
  insertDecision(input: NewDecision): Promise<{ row: DecisionRow; created: boolean }>;
  /** La última decisión de cada línea de la ocurrencia. */
  latestDecisions(organizationId: string, occurrenceId: string): Promise<DecisionRow[]>;
  decisionHistory(organizationId: string, occurrenceId: string, lineId: string): Promise<DecisionRow[]>;
  getDecision(organizationId: string, id: string): Promise<DecisionRow | null>;

  // Bandeja humana
  /** Crea la solicitud salvo que la línea ya tenga una pendiente. */
  insertRequest(input: { organizationId: string; occurrenceId: string; lineId: string; decisionId: string; at: string }): Promise<ApprovalRequestRow | null>;
  getRequest(organizationId: string, id: string): Promise<ApprovalRequestRow | null>;
  listRequests(organizationId: string, status: RequestStatus | null, limit: number): Promise<ApprovalRequestRow[]>;
  resolveRequest(organizationId: string, id: string, change: { status: Exclude<RequestStatus, "pending">; by: string; comment: string | null; at: string }): Promise<ApprovalRequestRow | null>;

  // Pagos simulados: a lo sumo uno por línea
  recordPayment(input: Omit<SimulatedPaymentRow, "id">): Promise<boolean>;
  listPayments(organizationId: string, occurrenceId: string): Promise<SimulatedPaymentRow[]>;

  // Montos confirmados
  confirmations(organizationId: string, obligationId: string): Promise<Record<string, LastConfirmed>>;
  upsertConfirmation(input: { organizationId: string; obligationId: string; counterpartyRef: string; beneficiaryReference: string | null; amountMinor: number; confirmedPeriod: string }): Promise<void>;

  // Auditoría y reloj de demo
  audit(input: AuditInput): Promise<void>;
  getDemoClock(organizationId: string): Promise<string | null>;
  setDemoClock(organizationId: string, now: string, by: string): Promise<void>;
}

/** Ejecuta `fn` con un almacén dentro de una transacción que serializa la organización. */
export interface StoreRuntime {
  readonly store: ObligationStore;
  transaction<T>(organizationId: string, fn: (store: ObligationStore) => Promise<T>): Promise<T>;
}

/** Importe en BD (BigInt) a `number`; falla si no es un entero seguro: no se redondea un monto. */
export function fromBigInt(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error("Importe fuera del rango entero seguro");
  return Number(value);
}

export function toBigInt(value: number): bigint {
  if (!Number.isSafeInteger(value)) throw new Error("El importe debe ser un entero seguro en unidades menores");
  return BigInt(value);
}
