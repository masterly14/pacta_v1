import { z } from "zod";
import { ColumnMappingSchema } from "./column-mapping.ts";
import { BatchSummarySchema } from "./import-batch.ts";
import { ContextNoteSchema, EntityIdSchema, Sha256Schema, TagsSchema } from "./primitives.ts";

// Payloads de `audit_events.payload_json` del historial bancario. El actor y el instante viven en
// columnas de la tabla (actor_id, created_at); el payload solo describe qué cambió. Append-only.

const eventBase = { schemaVersion: z.literal(1), batchId: EntityIdSchema };

export const BankImportAuditPayloadSchema = z.discriminatedUnion("eventType", [
  z.strictObject({
    ...eventBase,
    eventType: z.literal("BANK_IMPORT_CREATED"),
    fileSha256: Sha256Schema,
    tags: TagsSchema,
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal("BANK_IMPORT_MAPPING_CONFIRMED"),
    mapping: ColumnMappingSchema,
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal("BANK_IMPORT_COMMITTED"),
    summary: BatchSummarySchema,
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal("BANK_IMPORT_VOIDED"),
    reason: z.string().trim().min(3).max(500),
  }),
  z.strictObject({
    ...eventBase,
    eventType: z.literal("BANK_IMPORT_TAGS_UPDATED"),
    tagsBefore: TagsSchema,
    tagsAfter: TagsSchema,
    contextNoteBefore: ContextNoteSchema.nullable(),
    contextNoteAfter: ContextNoteSchema.nullable(),
  }),
]);
export type BankImportAuditPayload = z.infer<typeof BankImportAuditPayloadSchema>;
export type BankImportAuditEventType = BankImportAuditPayload["eventType"];
