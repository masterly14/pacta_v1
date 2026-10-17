import { z } from "zod";

// Contrato A → B (PLAN.md §6.1). Contiene evidencia y hechos extraídos, nunca una autorización.
// Valores desconocidos son `null`; jamás se sustituyen por 0, fecha actual u otra estimación.

// ---------------------------------------------------------------------------
// Primitivas compartidas (también las usa payment-decision.ts)
// ---------------------------------------------------------------------------

export const EntityIdSchema = z.string().trim().min(1).max(200);

// Código ISO 4217 en mayúsculas, p. ej. "USD".
export const CurrencyCodeSchema = z.string().regex(/^[A-Z]{3}$/, "Debe ser un código ISO 4217 en mayúsculas");

// Importe en unidades menores enteras (centavos para USD). Entero seguro, sin floats.
export const AmountMinorSchema = z.int().nonnegative();

// Fecha de calendario YYYY-MM-DD (sin zona horaria).
export const CalendarDateSchema = z.iso.date();

// Instante ISO 8601 en UTC (sufijo "Z").
export const UtcInstantSchema = z.iso.datetime();

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

// P0 solo usa email y dashboard; whatsapp/slack quedan reservados.
export const InvoiceSourceSchema = z.enum(["email", "dashboard", "whatsapp", "slack"]);

export const DocumentTypeSchema = z.enum(["pdf", "image", "email_body", "manual_entry"]);

// `matched` identifica al proveedor; NO implica que esté autorizado para cobrar.
export const SupplierMatchStatusSchema = z.enum(["matched", "ambiguous", "not_found"]);

export const ContractMatchStatusSchema = z.enum(["matched", "mismatch", "ambiguous", "not_found"]);

export const ContractFrequencySchema = z.enum(["one_time", "weekly", "monthly", "quarterly", "yearly"]);

// Campos extraíbles de la factura que pueden faltar. Debe coincidir con los campos nullable de abajo.
export const InvoiceMissingFieldSchema = z.enum([
  "invoiceNumber",
  "supplierName",
  "beneficiaryAccountReference",
  "amountMinor",
  "currency",
  "description",
  "invoiceDate",
  "dueDate",
]);

// ---------------------------------------------------------------------------
// Evidencia
// ---------------------------------------------------------------------------

// Apunta a dónde se observó un dato. Debe referirse a evidencia real, no generada.
export const InvoiceEvidenceSchema = z.strictObject({
  evidenceId: EntityIdSchema,
  sourceType: z.enum(["invoice_document", "email_body", "email_metadata", "contract_document", "manual_entry"]),
  documentId: EntityIdSchema.nullable(),
  field: z.string().min(1).nullable(), // campo del contexto que respalda, si aplica
  page: z.int().positive().nullable(),
  excerpt: z.string().max(1000).nullable(), // fragmento literal; dato no confiable
});

export const ExtractionWarningSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  field: z.string().min(1).nullable(),
});

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

export const ContractDiscrepancySchema = z.strictObject({
  field: z.enum(["amount", "currency", "supplier", "beneficiary_account", "period", "frequency", "other"]),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  description: z.string().min(1),
});

export const ContractMatchSchema = z
  .strictObject({
    contractId: EntityIdSchema.nullable(),
    matchStatus: ContractMatchStatusSchema,
    agreedAmountMinor: AmountMinorSchema.nullable(),
    currency: CurrencyCodeSchema.nullable(),
    frequency: ContractFrequencySchema.nullable(),
    validFrom: CalendarDateSchema.nullable(),
    validTo: CalendarDateSchema.nullable(),
    discrepancies: z.array(ContractDiscrepancySchema),
    evidence: z.array(InvoiceEvidenceSchema),
  })
  .superRefine((match, ctx) => {
    const needsContract = match.matchStatus === "matched" || match.matchStatus === "mismatch";
    if (needsContract && match.contractId === null) {
      ctx.addIssue({ code: "custom", path: ["contractId"], message: `contractId es obligatorio con matchStatus '${match.matchStatus}'` });
    }
    if (match.matchStatus === "not_found" && match.contractId !== null) {
      ctx.addIssue({ code: "custom", path: ["contractId"], message: "contractId debe ser null con matchStatus 'not_found'" });
    }
    if (match.matchStatus === "mismatch" && match.discrepancies.length === 0) {
      ctx.addIssue({ code: "custom", path: ["discrepancies"], message: "Un 'mismatch' debe listar al menos una discrepancia" });
    }
    if (match.matchStatus === "matched" && match.discrepancies.length > 0) {
      ctx.addIssue({ code: "custom", path: ["matchStatus"], message: "Con discrepancias el estado debe ser 'mismatch'" });
    }
    if (match.agreedAmountMinor !== null && match.currency === null) {
      ctx.addIssue({ code: "custom", path: ["currency"], message: "Un importe acordado requiere moneda explícita" });
    }
  });

// ---------------------------------------------------------------------------
// InvoiceContext
// ---------------------------------------------------------------------------

export const InvoiceContextSchema = z
  .strictObject({
    schemaVersion: z.literal(1),

    // Identidad
    invoiceId: EntityIdSchema,
    organizationId: EntityIdSchema,
    invoiceNumber: z.string().trim().min(1).nullable(), // número externo del proveedor

    // Origen
    source: InvoiceSourceSchema,
    sourceAccountId: EntityIdSchema.nullable(), // id interno de GmailConnection; null en carga manual
    sourceMessageId: z.string().min(1).nullable(), // gmailMessageId; null en carga manual
    documentId: EntityIdSchema.nullable(),
    documentType: DocumentTypeSchema,
    receivedAt: UtcInstantSchema,

    // Proveedor: nombre extraído separado de la identidad verificada
    supplierId: EntityIdSchema.nullable(),
    supplierName: z.string().trim().min(1).nullable(),
    supplierMatchStatus: SupplierMatchStatusSchema,
    beneficiaryAccountReference: z.string().trim().min(1).nullable(), // referencia enmascarada, nunca la cuenta completa

    // Importe
    amountMinor: AmountMinorSchema.nullable(),
    currency: CurrencyCodeSchema.nullable(),
    description: z.string().trim().min(1).nullable(),

    // Fechas de calendario
    invoiceDate: CalendarDateSchema.nullable(),
    dueDate: CalendarDateSchema.nullable(),

    // Contrato: null = no se intentó comparar; matchStatus 'not_found' = se buscó y no existe
    contractMatch: ContractMatchSchema.nullable(),

    // Calidad
    missingFields: z.array(InvoiceMissingFieldSchema),
    extractionWarnings: z.array(ExtractionWarningSchema),
    evidence: z.array(InvoiceEvidenceSchema),
  })
  .superRefine((invoice, ctx) => {
    if (invoice.supplierMatchStatus === "matched" && invoice.supplierId === null) {
      ctx.addIssue({ code: "custom", path: ["supplierId"], message: "supplierId es obligatorio con supplierMatchStatus 'matched'" });
    }
    if (invoice.supplierMatchStatus !== "matched" && invoice.supplierId !== null) {
      ctx.addIssue({ code: "custom", path: ["supplierId"], message: "supplierId debe ser null si el proveedor no está confirmado" });
    }
    if (invoice.source === "email" && invoice.sourceAccountId === null) {
      ctx.addIssue({ code: "custom", path: ["sourceAccountId"], message: "Un email requiere sourceAccountId del buzón Gmail" });
    }
    if (invoice.source === "email" && invoice.sourceMessageId === null) {
      ctx.addIssue({ code: "custom", path: ["sourceMessageId"], message: "Un email requiere sourceMessageId para idempotencia" });
    }
    if (invoice.source === "dashboard") {
      if (invoice.sourceAccountId !== null) {
        ctx.addIssue({ code: "custom", path: ["sourceAccountId"], message: "La carga manual no lleva sourceAccountId" });
      }
      if (invoice.sourceMessageId !== null) {
        ctx.addIssue({ code: "custom", path: ["sourceMessageId"], message: "La carga manual no lleva sourceMessageId" });
      }
    }
    if (invoice.amountMinor !== null && invoice.currency === null) {
      ctx.addIssue({ code: "custom", path: ["currency"], message: "Un importe requiere moneda explícita" });
    }

    // missingFields debe reflejar exactamente los campos null
    const listed = new Set(invoice.missingFields);
    if (listed.size !== invoice.missingFields.length) {
      ctx.addIssue({ code: "custom", path: ["missingFields"], message: "missingFields contiene duplicados" });
    }
    for (const field of InvoiceMissingFieldSchema.options) {
      const isNull = invoice[field] === null;
      if (isNull && !listed.has(field)) {
        ctx.addIssue({ code: "custom", path: ["missingFields"], message: `${field} es null y debe figurar en missingFields` });
      }
      if (!isNull && listed.has(field)) {
        ctx.addIssue({ code: "custom", path: ["missingFields"], message: `${field} tiene valor y no puede figurar en missingFields` });
      }
    }
  });

export type EvidenceReference = z.infer<typeof InvoiceEvidenceSchema>;
export type ContractMatch = z.infer<typeof ContractMatchSchema>;
export type InvoiceMissingField = z.infer<typeof InvoiceMissingFieldSchema>;
export type InvoiceContext = z.infer<typeof InvoiceContextSchema>;
