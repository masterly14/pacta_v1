import { z } from "zod";
import { ColumnMappingSchema, DetectedHeadersSchema, MappingSuggestionSchema } from "./column-mapping.ts";
import { RawCsvRowSchema } from "./csv-fields.ts";
import { BatchSummarySchema } from "./import-batch.ts";
import { ContextNoteSchema, EntityIdSchema, TagsSchema } from "./primitives.ts";

// Contratos de borde HTTP del importador. Todo lo que entra se valida aquí; el archivo va aparte (multipart).

export const MAX_SAMPLE_ROWS = 5;

// ---------------------------------------------------------------------------
// Subida
// ---------------------------------------------------------------------------

export const ImportRequestFieldsSchema = z.strictObject({
  tags: TagsSchema.default([]),
  contextNote: ContextNoteSchema.nullable().default(null),
});
export type ImportRequestFields = z.infer<typeof ImportRequestFieldsSchema>;

export const ImportNeedsMappingResponseSchema = z.strictObject({
  status: z.literal("needs_mapping"),
  batchId: EntityIdSchema,
  detectedHeaders: DetectedHeadersSchema,
  sampleRows: z.array(RawCsvRowSchema).max(MAX_SAMPLE_ROWS),
  suggestions: z.array(MappingSuggestionSchema),
});

export const ImportStagedResponseSchema = z.strictObject({
  status: z.literal("staged"),
  batchId: EntityIdSchema,
  summary: BatchSummarySchema,
});

// Respuesta de la subida y de confirmar mapeo (esta última siempre termina en `staged` o error).
export const ImportResponseSchema = z.discriminatedUnion("status", [
  ImportNeedsMappingResponseSchema,
  ImportStagedResponseSchema,
]);
export type ImportResponse = z.infer<typeof ImportResponseSchema>;

// ---------------------------------------------------------------------------
// Acciones sobre un lote (el batchId viaja en la ruta)
// ---------------------------------------------------------------------------

export const ConfirmMappingRequestSchema = z.strictObject({ mapping: ColumnMappingSchema });
export type ConfirmMappingRequest = z.infer<typeof ConfirmMappingRequestSchema>;

export const CommitBatchRequestSchema = z.strictObject({});

export const VoidBatchRequestSchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });
export type VoidBatchRequest = z.infer<typeof VoidBatchRequestSchema>;

export const SetBatchTagsRequestSchema = z.strictObject({
  tags: TagsSchema,
  contextNote: ContextNoteSchema.nullable(),
});
export type SetBatchTagsRequest = z.infer<typeof SetBatchTagsRequestSchema>;

// ---------------------------------------------------------------------------
// Errores tipados
// ---------------------------------------------------------------------------

export const ApiErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_FILE_TYPE",
  "INVALID_ENCODING",
  "TOO_MANY_ROWS",
  "DUPLICATE_FILE",
  "INVALID_MAPPING",
  "INVALID_STATE",
  "INTERNAL_ERROR",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({ code: ApiErrorCodeSchema, message: z.string().min(1) }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
