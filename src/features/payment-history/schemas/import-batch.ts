import { z } from "zod";
import { ColumnMappingSchema, DetectedHeadersSchema, validateMappingAgainstHeaders } from "./column-mapping.ts";
import { MAX_FILE_BYTES } from "./csv-fields.ts";
import {
  CalendarDateSchema,
  ContextNoteSchema,
  EntityIdSchema,
  Sha256Schema,
  TagsSchema,
  UtcInstantSchema,
} from "./primitives.ts";

// ---------------------------------------------------------------------------
// Estados y transiciones
// ---------------------------------------------------------------------------

export const BatchStatusSchema = z.enum(["needs_mapping", "staged", "committed", "failed", "voided"]);
export type BatchStatus = z.infer<typeof BatchStatusSchema>;

// Solo los lotes `committed` cuentan para presupuesto, duplicados y recurrencias.
// Un lote `committed` no se remapea ni se edita: se anula y se reimporta. `voided` es terminal.
export const BATCH_TRANSITIONS: Record<BatchStatus, readonly BatchStatus[]> = {
  needs_mapping: ["staged", "failed"],
  staged: ["committed", "failed", "needs_mapping"],
  committed: ["voided"],
  failed: ["needs_mapping", "voided"],
  voided: [],
};

export function canTransition(from: BatchStatus, to: BatchStatus): boolean {
  return BATCH_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Resumen del lote
// ---------------------------------------------------------------------------

export const BatchSummarySchema = z
  .strictObject({
    rowsTotal: z.int().nonnegative(),
    rowsAccepted: z.int().nonnegative(),
    rowsRejected: z.int().nonnegative(),
    rowsDuplicate: z.int().nonnegative(),
    periodFrom: CalendarDateSchema.nullable(),
    periodTo: CalendarDateSchema.nullable(),
  })
  .superRefine((summary, ctx) => {
    if (summary.rowsAccepted + summary.rowsRejected + summary.rowsDuplicate !== summary.rowsTotal) {
      ctx.addIssue({ code: "custom", path: ["rowsTotal"], message: "aceptadas + rechazadas + duplicadas debe igualar el total" });
    }
    if ((summary.periodFrom === null) !== (summary.periodTo === null)) {
      ctx.addIssue({ code: "custom", path: ["periodTo"], message: "periodFrom y periodTo deben ser ambos null o ambos con valor" });
    } else if (summary.periodFrom !== null && summary.periodTo !== null && summary.periodFrom > summary.periodTo) {
      ctx.addIssue({ code: "custom", path: ["periodFrom"], message: "periodFrom no puede ser posterior a periodTo" });
    }
  });
export type BatchSummary = z.infer<typeof BatchSummarySchema>;

// ---------------------------------------------------------------------------
// Lote
// ---------------------------------------------------------------------------

export const ImportBatchSchema = z
  .strictObject({
    id: EntityIdSchema,
    organizationId: EntityIdSchema,

    // Metadatos editables con auditoría; no afectan a importes ni a decisiones.
    tags: TagsSchema,
    contextNote: ContextNoteSchema.nullable(),

    fileName: z.string().min(1).max(255),
    fileSha256: Sha256Schema,
    fileRef: z.string().min(1), // almacenamiento privado; nunca una URL pública
    fileSize: z.int().positive().max(MAX_FILE_BYTES),
    uploadedBy: EntityIdSchema,

    detectedHeaders: DetectedHeadersSchema,
    columnMapping: ColumnMappingSchema.nullable(), // null hasta que una persona lo confirma
    mappingConfirmedBy: EntityIdSchema.nullable(),
    mappingConfirmedAt: UtcInstantSchema.nullable(),

    status: BatchStatusSchema,
    summary: BatchSummarySchema.nullable(), // null hasta parsear

    createdAt: UtcInstantSchema,
    committedAt: UtcInstantSchema.nullable(),
    committedBy: EntityIdSchema.nullable(),
    voidedAt: UtcInstantSchema.nullable(),
    voidedBy: EntityIdSchema.nullable(),
    voidReason: z.string().trim().min(3).max(500).nullable(),
  })
  .superRefine((batch, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

    const mappingFieldsSet = [batch.columnMapping, batch.mappingConfirmedBy, batch.mappingConfirmedAt].filter(
      (value) => value !== null,
    ).length;
    if (mappingFieldsSet !== 0 && mappingFieldsSet !== 3) {
      issue("columnMapping", "columnMapping, mappingConfirmedBy y mappingConfirmedAt van juntos o todos null");
    }

    if (batch.columnMapping) {
      const check = validateMappingAgainstHeaders(batch.columnMapping, batch.detectedHeaders);
      if (!check.ok) issue("columnMapping", `El mapeo referencia cabeceras inexistentes: ${check.missingHeaders.join(", ")}`);
    }

    if (batch.status === "needs_mapping") {
      if (batch.columnMapping !== null) issue("columnMapping", "Un lote 'needs_mapping' no tiene mapeo confirmado");
      if (batch.summary !== null) issue("summary", "Un lote 'needs_mapping' aún no tiene resumen");
    }
    if (batch.status === "staged" || batch.status === "committed") {
      if (batch.columnMapping === null) issue("columnMapping", `Un lote '${batch.status}' requiere mapeo confirmado`);
      if (batch.summary === null) issue("summary", `Un lote '${batch.status}' requiere resumen`);
    }

    const committedFieldsSet = [batch.committedAt, batch.committedBy].filter((value) => value !== null).length;
    if (committedFieldsSet === 1) issue("committedAt", "committedAt y committedBy van juntos");
    if (batch.status === "committed" && committedFieldsSet !== 2) issue("committedAt", "Un lote 'committed' requiere committedAt y committedBy");
    if (
      (batch.status === "needs_mapping" || batch.status === "staged" || batch.status === "failed") &&
      committedFieldsSet !== 0
    ) {
      issue("committedAt", `Un lote '${batch.status}' no puede estar confirmado`);
    }

    const voidedFieldsSet = [batch.voidedAt, batch.voidedBy, batch.voidReason].filter((value) => value !== null).length;
    if (batch.status === "voided" && voidedFieldsSet !== 3) {
      issue("voidedAt", "Un lote 'voided' requiere voidedAt, voidedBy y voidReason");
    }
    if (batch.status !== "voided" && voidedFieldsSet !== 0) {
      issue("voidedAt", "Solo un lote 'voided' lleva datos de anulación");
    }
  });
export type ImportBatch = z.infer<typeof ImportBatchSchema>;
