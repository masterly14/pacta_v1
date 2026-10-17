import { checkCanManagePolicies, type PolicyActor } from "../../policies/permissions";
import { normalizeSupplierName } from "../../policies/normalize";
import { RECURRENCE_MAX_ROWS } from "../config";
import {
  AssociateRequestSchema,
  AssociationReportSchema,
  ConfirmSuggestionRequestSchema,
  SupplierAssociationAuditEventSchema,
  type AssociateRequest,
  type AssociationReport,
  type ConfirmSuggestionRequest,
  type SupplierAssociationAuditEvent,
} from "../schemas/supplier-association";
import { extractCounterpartyKey } from "./counterparty-key";
import { planAssociation, type MatchSupplier, type MatchTransaction } from "./supplier-matching";

// Orquesta la asociación movimiento ↔ proveedor sobre un puerto de almacenamiento (testeable con un fake).
// Garantías: toda consulta lleva organizationId; solo se vincula lo que no tiene proveedor; el servicio NO
// puede crear ni modificar autorizaciones (el puerto no ofrece nada de eso); crear proveedores desde el
// banco es opcional (`autoCreate`) o una confirmación humana, y siempre deja auditoría.

export type SupplierRow = MatchSupplier & { normalizedName: string };

export interface SupplierAssociationStore {
  // Ejecuta `work` de forma atómica; el store recibido dentro es el transaccional.
  withTransaction<T>(work: (store: SupplierAssociationStore) => Promise<T>): Promise<T>;
  listUnlinkedTransactions(
    organizationId: string,
    filter: { importBatchId?: string; limit: number },
  ): Promise<{ transactions: MatchTransaction[]; truncated: boolean }>;
  listSuppliers(organizationId: string): Promise<SupplierRow[]>;
  findSupplier(organizationId: string, supplierId: string): Promise<SupplierRow | null>;
  // Crea el proveedor; si ya existe uno con ese normalizedName, devuelve el existente con created=false (sin error).
  createSupplier(
    organizationId: string,
    input: { name: string; normalizedName: string },
  ): Promise<{ supplier: SupplierRow; created: boolean }>;
  // Vincula solo movimientos de la organización que siguen SIN proveedor; devuelve cuántos vinculó.
  linkTransactions(organizationId: string, supplierId: string, transactionIds: string[]): Promise<number>;
  appendAuditEvents(organizationId: string, events: SupplierAssociationAuditEvent[]): Promise<void>;
}

export type AssociationContext = {
  organizationId: string;
  // null = proceso del sistema (p. ej. justo después de importar): solo puede vincular coincidencias exactas.
  actor: PolicyActor | null;
};

export type ServiceResult<T> = ({ ok: true } & T) | { ok: false; error: string };

function denied(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function assertSameOrganization(context: AssociationContext) {
  if (context.actor !== null && context.actor.organizationId !== context.organizationId) {
    return denied("El actor no pertenece a la organización.");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Asociación automática (exactos) + auto-creación opcional
// ---------------------------------------------------------------------------

export async function associateTransactions(
  store: SupplierAssociationStore,
  context: AssociationContext,
  rawRequest: AssociateRequest | unknown,
): Promise<ServiceResult<{ report: AssociationReport }>> {
  const parsed = AssociateRequestSchema.safeParse(rawRequest);
  if (!parsed.success) return denied("Petición inválida.");
  const request = parsed.data;

  const mismatch = assertSameOrganization(context);
  if (mismatch) return mismatch;

  if (request.autoCreate) {
    // Crear proveedores es poder de gestionar el catálogo: nunca lo hace un proceso anónimo.
    if (context.actor === null) return denied("Crear proveedores automáticamente requiere una persona autorizada.");
    const denial = checkCanManagePolicies(context.actor);
    if (denial !== null) return denied(denial);
  }

  const { organizationId, actor } = context;
  const importBatchId = request.importBatchId ?? null;

  return store.withTransaction(async (tx) => {
    const { transactions, truncated } = await tx.listUnlinkedTransactions(organizationId, {
      importBatchId: request.importBatchId,
      limit: RECURRENCE_MAX_ROWS,
    });
    // Fail-closed: con datos incompletos no se informa una asociación parcial como si fuera completa.
    if (truncated) return denied("Demasiados movimientos sin proveedor; acota la operación a un lote de importación.");

    const suppliers = await tx.listSuppliers(organizationId);
    const plan = planAssociation(transactions, suppliers);

    const report: AssociationReport = { linked: [], created: [], suggestions: [], skipped: plan.skipped };
    const events: SupplierAssociationAuditEvent[] = [];

    for (const link of plan.exact) {
      const count = await tx.linkTransactions(organizationId, link.supplierId, link.transactionIds);
      if (count === 0) continue; // otro proceso ya los vinculó: idempotente
      report.linked.push({ supplierId: link.supplierId, key: link.key, count, method: "exact" });
      events.push({
        entityType: "supplier",
        entityId: link.supplierId,
        actorId: actor?.userId ?? null,
        eventType: "bank_transactions.linked",
        payload: { key: link.key, count, method: "exact", importBatchId },
      });
    }

    for (const suggestion of plan.suggestions) {
      if (!(request.autoCreate && actor !== null && suggestion.kind === "create_new" && suggestion.autoCreateEligible)) {
        report.suggestions.push(suggestion);
        continue;
      }

      const name = suggestion.proposedName;
      const normalizedName = normalizeSupplierName(name);
      if (normalizedName === "") {
        report.suggestions.push(suggestion);
        continue;
      }

      const { supplier, created } = await tx.createSupplier(organizationId, { name, normalizedName });
      const count = await tx.linkTransactions(organizationId, supplier.id, suggestion.transactionIds);
      if (created) {
        report.created.push({ supplierId: supplier.id, name: supplier.name, key: suggestion.key, transactionCount: count });
        // actorId null: lo creó el sistema; `requestedBy` registra a quien activó la opción.
        events.push({
          entityType: "supplier",
          entityId: supplier.id,
          actorId: null,
          eventType: "supplier.auto_created",
          payload: { name: supplier.name, normalizedName, key: suggestion.key, transactionCount: Math.max(count, 1), requestedBy: actor.userId, importBatchId },
        });
      }
      if (count > 0) {
        report.linked.push({ supplierId: supplier.id, key: suggestion.key, count, method: "auto_created" });
        events.push({
          entityType: "supplier",
          entityId: supplier.id,
          actorId: null,
          eventType: "bank_transactions.linked",
          payload: { key: suggestion.key, count, method: "auto_created", importBatchId },
        });
      }
    }

    // Todo evento y el informe se validan antes de escribirse/devolverse.
    const validEvents = events.map((event) => SupplierAssociationAuditEventSchema.parse(event));
    if (validEvents.length > 0) await tx.appendAuditEvents(organizationId, validEvents);
    return { ok: true as const, report: AssociationReportSchema.parse(report) };
  });
}

// ---------------------------------------------------------------------------
// Confirmación humana de una sugerencia
// ---------------------------------------------------------------------------

export async function confirmSuggestion(
  store: SupplierAssociationStore,
  context: AssociationContext,
  rawRequest: ConfirmSuggestionRequest | unknown,
): Promise<ServiceResult<{ supplierId: string; linkedCount: number; createdSupplier: boolean }>> {
  const parsed = ConfirmSuggestionRequestSchema.safeParse(rawRequest);
  if (!parsed.success) return denied("Petición inválida.");
  const request = parsed.data;

  const { organizationId, actor } = context;
  if (actor === null) return denied("Confirmar una sugerencia requiere una persona autorizada.");
  const mismatch = assertSameOrganization(context);
  if (mismatch) return mismatch;
  const denial = checkCanManagePolicies(actor);
  if (denial !== null) return denied(denial);

  return store.withTransaction(async (tx) => {
    const { transactions, truncated } = await tx.listUnlinkedTransactions(organizationId, { limit: RECURRENCE_MAX_ROWS });
    if (truncated) return denied("Demasiados movimientos sin proveedor para resolver la sugerencia.");

    // Solo salidas sin proveedor cuya contraparte coincide con la clave confirmada.
    const ids = transactions
      .filter((transaction) => transaction.amountMinor < 0 && extractCounterpartyKey(transaction.description) === request.key)
      .map((transaction) => transaction.id);
    if (ids.length === 0) return denied("La sugerencia ya no está vigente: no quedan movimientos sin proveedor con esa contraparte.");

    const events: SupplierAssociationAuditEvent[] = [];
    let supplier: SupplierRow;
    let createdSupplier = false;

    if (request.action === "link_existing") {
      // El proveedor debe pertenecer a ESTA organización (findSupplier siempre filtra por organizationId).
      const found = await tx.findSupplier(organizationId, request.supplierId);
      if (found === null) return denied("Proveedor no encontrado.");
      supplier = found;
    } else {
      const normalizedName = normalizeSupplierName(request.name);
      if (normalizedName === "") return denied("El nombre no contiene letras ni números.");
      const result = await tx.createSupplier(organizationId, { name: request.name, normalizedName });
      supplier = result.supplier;
      createdSupplier = result.created;
    }

    const linkedCount = await tx.linkTransactions(organizationId, supplier.id, ids);
    if (createdSupplier) {
      events.push({
        entityType: "supplier",
        entityId: supplier.id,
        actorId: actor.userId,
        eventType: "supplier.created_from_bank",
        payload: { name: supplier.name, normalizedName: supplier.normalizedName, key: request.key, transactionCount: Math.max(linkedCount, 1) },
      });
    }
    if (linkedCount > 0) {
      events.push({
        entityType: "supplier",
        entityId: supplier.id,
        actorId: actor.userId,
        eventType: "bank_transactions.linked",
        payload: { key: request.key, count: linkedCount, method: "confirmed", importBatchId: null },
      });
    }
    const validEvents = events.map((event) => SupplierAssociationAuditEventSchema.parse(event));
    if (validEvents.length > 0) await tx.appendAuditEvents(organizationId, validEvents);

    return { ok: true as const, supplierId: supplier.id, linkedCount, createdSupplier };
  });
}
