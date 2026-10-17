import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BankImportAuditPayloadSchema } from "./audit-events.ts";
import {
  ApiErrorSchema,
  ConfirmMappingRequestSchema,
  ImportRequestFieldsSchema,
  ImportResponseSchema,
  SetBatchTagsRequestSchema,
  VoidBatchRequestSchema,
} from "./api.ts";
import {
  DuplicateCandidateSchema,
  HistoryCoverageSchema,
  HistorySpendResultSchema,
  RecurrenceSuggestionSchema,
} from "./history-queries.ts";
import {
  detectedHeadersFixture,
  mappingSignedFixture,
  recurrenceSuggestionFixture,
  spendKnownFixture,
  spendUnknownFixture,
  summaryFixture,
} from "./fixtures.ts";

describe("HistorySpendResultSchema (fail-closed)", () => {
  it("acepta known y unknown con razón", () => {
    assert.equal(HistorySpendResultSchema.safeParse(spendKnownFixture).success, true);
    assert.equal(HistorySpendResultSchema.safeParse(spendUnknownFixture).success, true);
  });

  it("unknown exige razón y no admite importe", () => {
    assert.equal(HistorySpendResultSchema.safeParse({ status: "unknown" }).success, false);
    assert.equal(HistorySpendResultSchema.safeParse({ ...spendUnknownFixture, amountMinor: 0 }).success, false);
  });

  it("known no admite importe nulo, negativo, flotante ni cero lotes", () => {
    assert.equal(HistorySpendResultSchema.safeParse({ ...spendKnownFixture, amountMinor: null }).success, false);
    assert.equal(HistorySpendResultSchema.safeParse({ ...spendKnownFixture, amountMinor: -1 }).success, false);
    assert.equal(HistorySpendResultSchema.safeParse({ ...spendKnownFixture, amountMinor: 1.5 }).success, false);
    assert.equal(HistorySpendResultSchema.safeParse({ ...spendKnownFixture, batchIds: [] }).success, false);
  });

  it("known rechaza from posterior a to", () => {
    assert.equal(
      HistorySpendResultSchema.safeParse({ ...spendKnownFixture, from: "2026-05-01", to: "2026-04-01" }).success,
      false,
    );
  });
});

describe("HistoryCoverageSchema", () => {
  it("null/null significa sin histórico", () => {
    assert.equal(
      HistoryCoverageSchema.safeParse({ firstPostedOn: null, lastPostedOn: null, rejectedRows: 0 }).success,
      true,
    );
  });

  it("rechaza un extremo nulo y el orden invertido", () => {
    assert.equal(
      HistoryCoverageSchema.safeParse({ firstPostedOn: "2026-01-01", lastPostedOn: null, rejectedRows: 0 }).success,
      false,
    );
    assert.equal(
      HistoryCoverageSchema.safeParse({ firstPostedOn: "2026-03-01", lastPostedOn: "2026-01-01", rejectedRows: 0 }).success,
      false,
    );
  });
});

describe("recurrencias y duplicados", () => {
  it("una recurrencia es solo una sugerencia", () => {
    assert.equal(RecurrenceSuggestionSchema.safeParse(recurrenceSuggestionFixture).success, true);
    assert.equal(
      RecurrenceSuggestionSchema.safeParse({ ...recurrenceSuggestionFixture, isSuggestionOnly: false }).success,
      false,
    );
  });

  it("no puede portar un permiso de pago (campo extra) ni tener ocurrencias inconsistentes", () => {
    assert.equal(
      RecurrenceSuggestionSchema.safeParse({ ...recurrenceSuggestionFixture, authorized: true }).success,
      false,
    );
    assert.equal(RecurrenceSuggestionSchema.safeParse({ ...recurrenceSuggestionFixture, occurrences: 5 }).success, false);
    assert.equal(RecurrenceSuggestionSchema.safeParse({ ...recurrenceSuggestionFixture, occurrences: 1 }).success, false);
  });

  it("el candidato duplicado exige base de coincidencia conocida", () => {
    const candidate = {
      transactionId: "txn_1",
      postedOn: "2026-01-01",
      amountMinor: 100,
      currency: "USD",
      matchBasis: "external_ref",
    };
    assert.equal(DuplicateCandidateSchema.safeParse(candidate).success, true);
    assert.equal(DuplicateCandidateSchema.safeParse({ ...candidate, matchBasis: "same_name" }).success, false);
  });
});

describe("contratos de API", () => {
  it("los campos de subida son opcionales y por defecto vacíos", () => {
    assert.deepEqual(ImportRequestFieldsSchema.parse({}), { tags: [], contextNote: null });
    const parsed = ImportRequestFieldsSchema.parse({ tags: ["RRHH"], contextNote: "tarjeta corporativa" });
    assert.deepEqual(parsed.tags, ["rrhh"]);
  });

  it("la respuesta distingue needs_mapping de staged", () => {
    const needsMapping = {
      status: "needs_mapping",
      batchId: "batch_1",
      detectedHeaders: detectedHeadersFixture,
      sampleRows: [{ Fecha: "01/02/2026" }],
      suggestions: [{ field: "posted_on", header: "Fecha", matchedBy: "alias" }],
    };
    assert.equal(ImportResponseSchema.safeParse(needsMapping).success, true);
    assert.equal(ImportResponseSchema.safeParse({ status: "staged", batchId: "batch_1", summary: summaryFixture }).success, true);
    assert.equal(ImportResponseSchema.safeParse({ status: "committed", batchId: "batch_1" }).success, false);
  });

  it("limita las filas de muestra a 5", () => {
    const sampleRows = Array.from({ length: 6 }, () => ({ Fecha: "x" }));
    assert.equal(
      ImportResponseSchema.safeParse({
        status: "needs_mapping",
        batchId: "batch_1",
        detectedHeaders: detectedHeadersFixture,
        sampleRows,
        suggestions: [],
      }).success,
      false,
    );
  });

  it("confirmar mapeo exige un mapeo válido", () => {
    assert.equal(ConfirmMappingRequestSchema.safeParse({ mapping: mappingSignedFixture }).success, true);
    assert.equal(ConfirmMappingRequestSchema.safeParse({ mapping: { schemaVersion: 1 } }).success, false);
    assert.equal(ConfirmMappingRequestSchema.safeParse({}).success, false);
  });

  it("anular exige motivo; editar etiquetas valida el máximo", () => {
    assert.equal(VoidBatchRequestSchema.safeParse({ reason: "ab" }).success, false);
    assert.equal(VoidBatchRequestSchema.safeParse({ reason: "Fechas mal interpretadas" }).success, true);
    const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`);
    assert.equal(SetBatchTagsRequestSchema.safeParse({ tags: eleven, contextNote: null }).success, false);
    assert.equal(SetBatchTagsRequestSchema.safeParse({ tags: ["q3"], contextNote: null }).success, true);
  });

  it("los errores usan códigos tipados", () => {
    assert.equal(ApiErrorSchema.safeParse({ error: { code: "FORBIDDEN", message: "Sin permiso" } }).success, true);
    assert.equal(ApiErrorSchema.safeParse({ error: { code: "OTHER", message: "x" } }).success, false);
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
      assert.equal(result.success, true, JSON.stringify(result.error?.issues));
    }
  });

  it("rechaza eventos desconocidos, sin batchId o sin versión", () => {
    assert.equal(
      BankImportAuditPayloadSchema.safeParse({ schemaVersion: 1, batchId: "b", eventType: "BANK_IMPORT_APPROVED" }).success,
      false,
    );
    assert.equal(
      BankImportAuditPayloadSchema.safeParse({ schemaVersion: 1, eventType: "BANK_IMPORT_VOIDED", reason: "motivo válido" }).success,
      false,
    );
    assert.equal(
      BankImportAuditPayloadSchema.safeParse({ batchId: "b", eventType: "BANK_IMPORT_VOIDED", reason: "motivo válido" }).success,
      false,
    );
  });
});
