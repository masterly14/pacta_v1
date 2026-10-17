import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BankTransactionSchema } from "./bank-transaction.ts";
import {
  BATCH_TRANSITIONS,
  BatchStatusSchema,
  BatchSummarySchema,
  canTransition,
  ImportBatchSchema,
} from "./import-batch.ts";
import {
  batchCommittedFixture,
  batchNeedsMappingFixture,
  batchStagedFixture,
  batchVoidedFixture,
  mappingSplitColumnsFixture,
  summaryFixture,
  transactionFixture,
} from "./fixtures.ts";

describe("transiciones de estado del lote", () => {
  it("permite el flujo normal", () => {
    assert.equal(canTransition("needs_mapping", "staged"), true);
    assert.equal(canTransition("staged", "committed"), true);
    assert.equal(canTransition("committed", "voided"), true);
  });

  it("un lote committed no se remapea ni vuelve a staged: se anula", () => {
    assert.equal(canTransition("committed", "staged"), false);
    assert.equal(canTransition("committed", "needs_mapping"), false);
    assert.equal(canTransition("committed", "failed"), false);
  });

  it("voided es terminal", () => {
    for (const status of BatchStatusSchema.options) {
      assert.equal(canTransition("voided", status), false);
    }
    assert.deepEqual(BATCH_TRANSITIONS.voided, []);
  });

  it("no se confirma un lote sin pasar por staged", () => {
    assert.equal(canTransition("needs_mapping", "committed"), false);
    assert.equal(canTransition("failed", "committed"), false);
  });
});

describe("BatchSummarySchema", () => {
  it("acepta un resumen consistente", () => {
    assert.equal(BatchSummarySchema.safeParse(summaryFixture).success, true);
  });

  it("rechaza si aceptadas + rechazadas + duplicadas no igualan el total", () => {
    assert.equal(BatchSummarySchema.safeParse({ ...summaryFixture, rowsTotal: 11 }).success, false);
  });

  it("rechaza periodFrom posterior a periodTo o solo uno de los dos", () => {
    assert.equal(
      BatchSummarySchema.safeParse({ ...summaryFixture, periodFrom: "2026-05-01", periodTo: "2026-01-01" }).success,
      false,
    );
    assert.equal(BatchSummarySchema.safeParse({ ...summaryFixture, periodTo: null }).success, false);
  });

  it("acepta lote sin filas válidas con periodo null", () => {
    assert.equal(
      BatchSummarySchema.safeParse({
        rowsTotal: 2,
        rowsAccepted: 0,
        rowsRejected: 2,
        rowsDuplicate: 0,
        periodFrom: null,
        periodTo: null,
      }).success,
      true,
    );
  });
});

describe("ImportBatchSchema", () => {
  it("acepta un lote en cada estado válido", () => {
    for (const fixture of [
      batchNeedsMappingFixture(),
      batchStagedFixture(),
      batchCommittedFixture(),
      batchVoidedFixture(),
      batchNeedsMappingFixture({ status: "failed" }),
    ]) {
      const result = ImportBatchSchema.safeParse(fixture);
      assert.equal(result.success, true, JSON.stringify(result.error?.issues));
    }
  });

  it("un lote committed sin mapeo o sin resumen se rechaza", () => {
    assert.equal(
      ImportBatchSchema.safeParse(
        batchCommittedFixture({ columnMapping: null, mappingConfirmedBy: null, mappingConfirmedAt: null }),
      ).success,
      false,
    );
    assert.equal(ImportBatchSchema.safeParse(batchCommittedFixture({ summary: null })).success, false);
  });

  it("un lote committed sin actor de confirmación se rechaza", () => {
    assert.equal(ImportBatchSchema.safeParse(batchCommittedFixture({ committedBy: null })).success, false);
  });

  it("un lote staged no puede venir ya confirmado", () => {
    assert.equal(
      ImportBatchSchema.safeParse(batchStagedFixture({ committedAt: "2026-04-01T10:10:00Z", committedBy: "user_admin" })).success,
      false,
    );
  });

  it("un lote voided requiere actor, instante y motivo; los demás no los llevan", () => {
    assert.equal(ImportBatchSchema.safeParse(batchVoidedFixture({ voidReason: null })).success, false);
    assert.equal(ImportBatchSchema.safeParse(batchVoidedFixture({ voidedBy: null })).success, false);
    assert.equal(ImportBatchSchema.safeParse(batchCommittedFixture({ voidReason: "no debería" })).success, false);
    assert.equal(ImportBatchSchema.safeParse(batchVoidedFixture({ voidReason: "x" })).success, false);
  });

  it("un lote needs_mapping no puede traer mapeo ni resumen", () => {
    assert.equal(
      ImportBatchSchema.safeParse(
        batchNeedsMappingFixture({ columnMapping: batchStagedFixture().columnMapping }),
      ).success,
      false,
    );
  });

  it("el mapeo debe referenciar cabeceras que existen en el archivo", () => {
    const result = ImportBatchSchema.safeParse(
      batchStagedFixture({ columnMapping: mappingSplitColumnsFixture }),
    );
    assert.equal(result.success, false);
  });

  it("el mapeo y su confirmación van juntos", () => {
    assert.equal(ImportBatchSchema.safeParse(batchStagedFixture({ mappingConfirmedBy: null })).success, false);
  });

  it("las etiquetas del lote se normalizan y respetan el máximo", () => {
    const parsed = ImportBatchSchema.parse(batchStagedFixture({ tags: ["RRHH", " rrhh "] }));
    assert.deepEqual(parsed.tags, ["rrhh"]);
    const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`);
    assert.equal(ImportBatchSchema.safeParse(batchStagedFixture({ tags: eleven })).success, false);
  });

  it("rechaza archivos de más de 4 MB, sha256 inválido y campos extra", () => {
    assert.equal(ImportBatchSchema.safeParse(batchStagedFixture({ fileSize: 4 * 1024 * 1024 + 1 })).success, false);
    assert.equal(ImportBatchSchema.safeParse(batchStagedFixture({ fileSha256: "xyz" })).success, false);
    assert.equal(ImportBatchSchema.safeParse(batchStagedFixture({ approved: true })).success, false);
  });
});

describe("BankTransactionSchema", () => {
  it("acepta un movimiento sin vínculo a proveedor", () => {
    assert.equal(BankTransactionSchema.safeParse(transactionFixture()).success, true);
  });

  it("supplierId y supplierLinkStatus deben ser coherentes", () => {
    assert.equal(BankTransactionSchema.safeParse(transactionFixture({ supplierId: "sup_1" })).success, false);
    assert.equal(BankTransactionSchema.safeParse(transactionFixture({ supplierLinkStatus: "suggested" })).success, false);
    assert.equal(
      BankTransactionSchema.safeParse(transactionFixture({ supplierId: "sup_1", supplierLinkStatus: "suggested" })).success,
      true,
    );
  });

  it("rechaza importe flotante o negativo y fingerprint inválido", () => {
    assert.equal(BankTransactionSchema.safeParse(transactionFixture({ amountMinor: 10.5 })).success, false);
    assert.equal(BankTransactionSchema.safeParse(transactionFixture({ amountMinor: -10 })).success, false);
    assert.equal(BankTransactionSchema.safeParse(transactionFixture({ fingerprint: "abc" })).success, false);
  });

  it("no existe campo de autorización: un campo extra se rechaza", () => {
    assert.equal(BankTransactionSchema.safeParse(transactionFixture({ authorized: true })).success, false);
  });
});
