import { z } from "zod";
import { CalendarDateSchema, EntityIdSchema } from "./primitives";

// Contratos de la asociación movimiento ↔ proveedor. Vincular o crear un proveedor desde el banco
// NO autoriza ningún pago: las autorizaciones son una entidad aparte, creada solo por una persona.

// Clave estable de la contraparte (ver suppliers/counterparty-key.ts).
export const CounterpartyKeySchema = z.string().min(1).max(120);

const SimilaritySchema = z.number().min(0).max(1);

export const SupplierCandidateSchema = z.strictObject({
  supplierId: EntityIdSchema,
  supplierName: z.string().min(1),
  similarity: SimilaritySchema,
});
export type SupplierCandidate = z.infer<typeof SupplierCandidateSchema>;

const suggestionBase = {
  key: CounterpartyKeySchema,
  occurrences: z.int().min(1),
  transactionIds: z.array(EntityIdSchema).min(1),
};

// Una sugerencia nunca vincula por sí sola: requiere confirmación humana (o `autoCreate` en el caso `create_new` elegible).
export const SupplierSuggestionSchema = z
  .discriminatedUnion("kind", [
    // Parecido a un proveedor existente, sin coincidencia exacta.
    z.strictObject({ ...suggestionBase, kind: z.literal("link_existing"), candidate: SupplierCandidateSchema }),
    // Varios candidatos igual de parecidos (o varios proveedores con la misma clave).
    z.strictObject({ ...suggestionBase, kind: z.literal("ambiguous"), candidates: z.array(SupplierCandidateSchema).min(2).max(5) }),
    // Sin candidato: proponer crear un proveedor nuevo.
    z.strictObject({
      ...suggestionBase,
      kind: z.literal("create_new"),
      proposedName: z.string().min(1).max(200),
      firstPostedOn: CalendarDateSchema,
      lastPostedOn: CalendarDateSchema,
      sampleDescriptions: z.array(z.string().min(1)).max(3), // texto del banco: dato no confiable
      autoCreateEligible: z.boolean(),
    }),
  ])
  .superRefine((suggestion, ctx) => {
    if (suggestion.transactionIds.length !== suggestion.occurrences) {
      ctx.addIssue({ code: "custom", path: ["transactionIds"], message: "transactionIds debe tener exactamente 'occurrences' elementos" });
    }
  });
export type SupplierSuggestion = z.infer<typeof SupplierSuggestionSchema>;

export const AssociationSkippedSchema = z.strictObject({
  inflows: z.int().nonnegative(), // entradas: no se asocian
  unclassifiable: z.int().nonnegative(), // sin contraparte identificable
  alreadyLinked: z.int().nonnegative(),
});
export type AssociationSkipped = z.infer<typeof AssociationSkippedSchema>;

export const AssociationReportSchema = z.strictObject({
  linked: z.array(
    z.strictObject({ supplierId: EntityIdSchema, key: CounterpartyKeySchema, count: z.int().positive(), method: z.enum(["exact", "auto_created"]) }),
  ),
  created: z.array(
    z.strictObject({ supplierId: EntityIdSchema, name: z.string().min(1), key: CounterpartyKeySchema, transactionCount: z.int().positive() }),
  ),
  suggestions: z.array(SupplierSuggestionSchema), // lo que sigue pendiente de decisión humana
  skipped: AssociationSkippedSchema,
});
export type AssociationReport = z.infer<typeof AssociationReportSchema>;

// ---------------------------------------------------------------------------
// Peticiones
// ---------------------------------------------------------------------------

export const AssociateRequestSchema = z.strictObject({
  importBatchId: EntityIdSchema.optional(), // sin lote = todos los movimientos sin proveedor de la organización
  autoCreate: z.boolean().default(false),
});
export type AssociateRequest = z.infer<typeof AssociateRequestSchema>;

export const ConfirmSuggestionRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("link_existing"), key: CounterpartyKeySchema, supplierId: EntityIdSchema }),
  z.strictObject({ action: z.literal("create_new"), key: CounterpartyKeySchema, name: z.string().trim().min(1).max(200) }),
]);
export type ConfirmSuggestionRequest = z.infer<typeof ConfirmSuggestionRequestSchema>;

// ---------------------------------------------------------------------------
// Auditoría (fila de audit_events; eventType en minúsculas con punto, como en policies/server.ts)
// ---------------------------------------------------------------------------

const auditRowBase = { entityType: z.literal("supplier"), entityId: EntityIdSchema, actorId: EntityIdSchema.nullable() };

export const SupplierAssociationAuditEventSchema = z.discriminatedUnion("eventType", [
  // Creación automática pedida con `autoCreate`. actorId null = proceso del sistema; requestedBy = quien activó la opción.
  z.strictObject({
    ...auditRowBase,
    eventType: z.literal("supplier.auto_created"),
    payload: z.strictObject({
      name: z.string().min(1),
      normalizedName: z.string().min(1),
      key: CounterpartyKeySchema,
      transactionCount: z.int().positive(),
      requestedBy: EntityIdSchema,
      importBatchId: EntityIdSchema.nullable(),
    }),
  }),
  // Creación confirmada por una persona desde una sugerencia.
  z.strictObject({
    ...auditRowBase,
    eventType: z.literal("supplier.created_from_bank"),
    payload: z.strictObject({
      name: z.string().min(1),
      normalizedName: z.string().min(1),
      key: CounterpartyKeySchema,
      transactionCount: z.int().positive(),
    }),
  }),
  z.strictObject({
    ...auditRowBase,
    eventType: z.literal("bank_transactions.linked"),
    payload: z.strictObject({
      key: CounterpartyKeySchema,
      count: z.int().positive(),
      method: z.enum(["exact", "auto_created", "confirmed"]),
      importBatchId: EntityIdSchema.nullable(),
    }),
  }),
]);
export type SupplierAssociationAuditEvent = z.infer<typeof SupplierAssociationAuditEventSchema>;
