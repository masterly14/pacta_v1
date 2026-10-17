import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { RecurrenceStore } from "../recurrence/recurrence-service";
import type { SupplierAssociationStore, SupplierRow } from "./association-service";

// Adaptadores Prisma de los puertos. Toda consulta lleva organizationId. Sin pruebas unitarias
// (necesitan base de datos): se verifican por tipos/lint y por los tests de los servicios con fakes.

type Client = PrismaClient | Prisma.TransactionClient;

const toCalendarDate = (date: Date): string => date.toISOString().slice(0, 10);

function createStore(client: Client, isTransaction: boolean): SupplierAssociationStore {
  const store: SupplierAssociationStore = {
    async withTransaction(work) {
      if (isTransaction) return work(store);
      return (client as PrismaClient).$transaction((tx) => work(createStore(tx, true)), { timeout: 30_000, maxWait: 5_000 });
    },

    async listUnlinkedTransactions(organizationId, filter) {
      const rows = await client.bankTransaction.findMany({
        where: { organizationId, supplierId: null, ...(filter.importBatchId ? { importBatchId: filter.importBatchId } : {}) },
        select: { id: true, postedOn: true, amountMinor: true, supplierId: true, description: true },
        orderBy: [{ postedOn: "asc" }, { id: "asc" }],
        take: filter.limit + 1,
      });
      return {
        truncated: rows.length > filter.limit,
        transactions: rows.slice(0, filter.limit).map((row) => ({ ...row, postedOn: toCalendarDate(row.postedOn) })),
      };
    },

    async listSuppliers(organizationId) {
      return client.supplier.findMany({
        where: { organizationId },
        select: { id: true, name: true, normalizedName: true },
        orderBy: { name: "asc" },
      });
    },

    async findSupplier(organizationId, supplierId) {
      return client.supplier.findFirst({
        where: { id: supplierId, organizationId },
        select: { id: true, name: true, normalizedName: true },
      });
    },

    // createMany + skipDuplicates (ON CONFLICT DO NOTHING) no aborta la transacción ante una carrera.
    async createSupplier(organizationId, input) {
      const { count } = await client.supplier.createMany({
        data: [{ organizationId, name: input.name, normalizedName: input.normalizedName }],
        skipDuplicates: true,
      });
      const supplier = (await client.supplier.findUniqueOrThrow({
        where: { organizationId_normalizedName: { organizationId, normalizedName: input.normalizedName } },
        select: { id: true, name: true, normalizedName: true },
      })) satisfies SupplierRow;
      return { supplier, created: count === 1 };
    },

    // `supplierId: null` en el WHERE: nunca pisa un vínculo existente (idempotente y seguro ante concurrencia).
    async linkTransactions(organizationId, supplierId, transactionIds) {
      if (transactionIds.length === 0) return 0;
      const { count } = await client.bankTransaction.updateMany({
        where: { organizationId, supplierId: null, id: { in: transactionIds } },
        data: { supplierId },
      });
      return count;
    },

    async appendAuditEvents(organizationId, events) {
      await client.auditEvent.createMany({
        data: events.map((event) => ({
          organizationId,
          entityType: event.entityType,
          entityId: event.entityId,
          eventType: event.eventType,
          actorId: event.actorId,
          payload: event.payload as Prisma.InputJsonValue,
        })),
      });
    },
  };
  return store;
}

export function createPrismaAssociationStore(client: Client = db): SupplierAssociationStore {
  return createStore(client, !("$transaction" in client));
}

export function createPrismaRecurrenceStore(client: Client = db): RecurrenceStore {
  return {
    async listOutflows(organizationId, filter) {
      const rows = await client.bankTransaction.findMany({
        where: {
          organizationId,
          amountMinor: { lt: 0 },
          postedOn: { gte: new Date(`${filter.since}T00:00:00.000Z`) },
          ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
        },
        select: { id: true, postedOn: true, amountMinor: true, currency: true, supplierId: true, description: true },
        orderBy: [{ postedOn: "asc" }, { id: "asc" }],
        take: filter.limit + 1,
      });
      return {
        truncated: rows.length > filter.limit,
        transactions: rows.slice(0, filter.limit).map((row) => ({ ...row, postedOn: toCalendarDate(row.postedOn) })),
      };
    },
  };
}
