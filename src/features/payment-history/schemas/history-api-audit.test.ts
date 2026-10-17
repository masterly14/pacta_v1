import { describe, expect, it } from "vitest";
import { BankImportAuditPayloadSchema } from "./audit-events";
import {
  ApiErrorSchema,
  ConfirmMappingRequestSchema,
  ImportRequestFieldsSchema,
  ImportResponseSchema,
  SetBatchTagsRequestSchema,
  VoidBatchRequestSchema,
} from "./api";
import {
  DuplicateCandidateSchema,
  HistoryCoverageSchema,
  HistorySpendResultSchema,
  RecurrenceSuggestionSchema,
} from "./history-queries";
import {
  detectedHeadersFixture,
  mappingSignedFixture,
  recurrenceSuggestionFixture,
  spendKnownFixture,
  spendUnknownFixture,
  summaryFixture,
} from "./fixtures";

describe("HistorySpendResultSchema (fail-closed)", () => {
  it("acepta known y unknown con razón", () => {
    expect(HistorySpendResultSchema.safeParse(spendKnownFixture).success).toBe(true);
    expect(HistorySpendResultSchema.safeParse(spendUnknownFixture).success).toBe(true);
  });

  it("unknown exige razón y no admite importe", () => {
    expect(HistorySpendResultSchema.safeParse({ status: "unknown" }).success).toBe(false);
    expect(HistorySpendResultSchema.safeParse({ ...spendUnknownFixture, amountMinor: 0 }).success).toBe(false);
  });

  it("known no admite importe nulo, negativo, flotante ni cero lotes", () => {
    expect(HistorySpendResultSchema.safeParse({ ...spendKnownFixture, amountMinor: null }).success).toBe(false);
    expect(HistorySpendResultSchema.safeParse({ ...spendKnownFixture, amountMinor: -1 }).success).toBe(false);
    expect(HistorySpendResultSchema.safeParse({ ...spendKnownFixture, amountMinor: 1.5 }).success).toBe(false);
    expect(HistorySpendResultSchema.safeParse({ ...spendKnownFixture, batchIds: [] }).success).toBe(false);
  });

  it("known rechaza from posterior a to", () => {
    expect(HistorySpendResultSchema.safeParse({ ...spendKnownFixture, from: "2026-05-01", to: "2026-04-01" }).success).toBe(false);
  });
});

describe("HistoryCoverageSchema", () => {
  it("null/null significa sin histórico", () => {
    expect(HistoryCoverageSchema.safeParse({ firstPostedOn: null, lastPostedOn: null, rejectedRows: 0 }).success).toBe(true);
  });

  it("rechaza un extremo nulo y el orden invertido", () => {
    expect(HistoryCoverageSchema.safeParse({ firstPostedOn: "2026-01-01", lastPostedOn: null, rejectedRows: 0 }).success).toBe(false);
    expect(HistoryCoverageSchema.safeParse({ firstPostedOn: "2026-03-01", lastPostedOn: "2026-01-01", rejectedRows: 0 }).success).toBe(false);
  });
});

describe("recurrencias y duplicados", () => {
  it("una recurrencia es solo una sugerencia", () => {
    expect(RecurrenceSuggestionSchema.safeParse(recurrenceSuggestionFixture).success).toBe(true);
    expect(RecurrenceSuggestionSchema.safeParse({ ...recurrenceSuggestionFixture, isSuggestionOnly: false }).success).toBe(false);
  });

  it("no puede portar un permiso de pago (campo extra) ni tener ocurrencias inconsistentes", () => {
    expect(RecurrenceSuggestionSchema.safeParse({ ...recurrenceSuggestionFixture, authorized: true }).success).toBe(false);
    expect(RecurrenceSuggestionSchema.safeParse({ ...recurrenceSuggestionFixture, occurrences: 5 }).success).toBe(false);
    expect(RecurrenceSuggestionSchema.safeParse({ ...recurrenceSuggestionFixture, occurrences: 1 }).success).toBe(false);
  });

  it("groupKind y supplierId deben ser coherentes; las fechas, ordenadas", () => {
    expect(RecurrenceSuggestionSchema.safeParse({ ...recurrenceSuggestionFixture, groupKind: "supplier" }).success).toBe(false);
    expect(RecurrenceSuggestionSchema.safeParse({ ...recurrenceSuggestionFixture, groupKind: "supplier", supplierId: "sup_1" })
        .success).toBe(true);
    expect(RecurrenceSuggestionSchema.safeParse({ ...recurrenceSuggestionFixture, supplierId: "sup_1" }).success).toBe(false);
    expect(RecurrenceSuggestionSchema.safeParse({
        ...recurrenceSuggestionFixture,
        firstPostedOn: "2026-04-01",
        lastPostedOn: "2026-01-01",
      }).success).toBe(false);
  });

  it("el candidato duplicado exige base de coincidencia conocida", () => {
    const candidate = {
      transactionId: "txn_1",
      postedOn: "2026-01-01",
      amountMinor: 100,
      currency: "USD",
      matchBasis: "external_ref",
    };
    expect(DuplicateCandidateSchema.safeParse(candidate).success).toBe(true);
    expect(DuplicateCandidateSchema.safeParse({ ...candidate, matchBasis: "same_name" }).success).toBe(false);
  });
});

describe("contratos de API", () => {
  it("los campos de subida son opcionales y por defecto vacíos", () => {
    expect(ImportRequestFieldsSchema.parse({})).toEqual({ tags: [], contextNote: null });
    const parsed = ImportRequestFieldsSchema.parse({ tags: ["RRHH"], contextNote: "tarjeta corporativa" });
    expect(parsed.tags).toEqual(["rrhh"]);
  });

  it("la respuesta distingue needs_mapping de staged", () => {
    const needsMapping = {
      status: "needs_mapping",
      batchId: "batch_1",
      detectedHeaders: detectedHeadersFixture,
      sampleRows: [{ Fecha: "01/02/2026" }],
      suggestions: [{ field: "posted_on", header: "Fecha", matchedBy: "alias" }],
    };
    expect(ImportResponseSchema.safeParse(needsMapping).success).toBe(true);
    expect(ImportResponseSchema.safeParse({ status: "staged", batchId: "batch_1", summary: summaryFixture }).success).toBe(true);
    expect(ImportResponseSchema.safeParse({ status: "committed", batchId: "batch_1" }).success).toBe(false);
  });

  it("limita las filas de muestra a 5", () => {
    const sampleRows = Array.from({ length: 6 }, () => ({ Fecha: "x" }));
    expect(ImportResponseSchema.safeParse({
        status: "needs_mapping",
        batchId: "batch_1",
        detectedHeaders: detectedHeadersFixture,
        sampleRows,
        suggestions: [],
      }).success).toBe(false);
  });

  it("confirmar mapeo exige un mapeo válido", () => {
    expect(ConfirmMappingRequestSchema.safeParse({ mapping: mappingSignedFixture }).success).toBe(true);
    expect(ConfirmMappingRequestSchema.safeParse({ mapping: { schemaVersion: 1 } }).success).toBe(false);
    expect(ConfirmMappingRequestSchema.safeParse({}).success).toBe(false);
  });

  it("anular exige motivo; editar etiquetas valida el máximo", () => {
    expect(VoidBatchRequestSchema.safeParse({ reason: "ab" }).success).toBe(false);
    expect(VoidBatchRequestSchema.safeParse({ reason: "Fechas mal interpretadas" }).success).toBe(true);
    const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`);
    expect(SetBatchTagsRequestSchema.safeParse({ tags: eleven, contextNote: null }).success).toBe(false);
    expect(SetBatchTagsRequestSchema.safeParse({ tags: ["q3"], contextNote: null }).success).toBe(true);
  });

  it("los errores usan códigos tipados", () => {
    expect(ApiErrorSchema.safeParse({ error: { code: "FORBIDDEN", message: "Sin permiso" } }).success).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: { code: "OTHER", message: "x" } }).success).toBe(false);
  });
});

describe("payloads de auditoría", () => {
  it("acepta cada tipo de evento", () => {
    const events = [
      { eventType: "BANK_IMPORT_CREATED", fileSha256: "a".repeat(64), tags: ["rrhh"] },
      { eventType: "BANK_IMPORT_MAPPING_CONFIRMED", mapping: mappingSignedFixture },
      { eventType: "BANK_IMPORT_COMMITTED", summary: summaryFixture },
      { eventType: "BANK_IMPORT_VOIDED", reason: "Fechas mal interpretadas" },
      {
        eventType: "BANK_IMPORT_TAGS_UPDATED",
        tagsBefore: ["rrhh"],
        tagsAfter: ["rrhh", "q3"],
        contextNoteBefore: null,
        contextNoteAfter: "tarjeta corporativa",
      },
    ];
    for (const event of events) {
      const result = BankImportAuditPayloadSchema.safeParse({ schemaVersion: 1, batchId: "batch_1", ...event });
      expect(result.success).toBe(true);
    }
  });

  it("rechaza eventos desconocidos, sin batchId o sin versión", () => {
    expect(BankImportAuditPayloadSchema.safeParse({ schemaVersion: 1, batchId: "b", eventType: "BANK_IMPORT_APPROVED" }).success).toBe(false);
    expect(BankImportAuditPayloadSchema.safeParse({ schemaVersion: 1, eventType: "BANK_IMPORT_VOIDED", reason: "motivo válido" }).success).toBe(false);
    expect(BankImportAuditPayloadSchema.safeParse({ batchId: "b", eventType: "BANK_IMPORT_VOIDED", reason: "motivo válido" }).success).toBe(false);
  });
});
