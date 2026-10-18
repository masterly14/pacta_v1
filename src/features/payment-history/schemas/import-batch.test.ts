import { describe, expect, it } from "vitest";
import { BankTransactionSchema, isOutflow } from "./bank-transaction";
import {
  BATCH_TRANSITIONS,
  BatchStatusSchema,
  BatchSummarySchema,
  canTransition,
  ImportBatchSchema,
} from "./import-batch";
import {
  batchCommittedFixture,
  batchNeedsMappingFixture,
  batchStagedFixture,
  batchVoidedFixture,
  mappingSplitColumnsFixture,
  summaryFixture,
  transactionFixture,
} from "./fixtures";

describe("transiciones de estado del lote", () => {
  it("permite el flujo normal", () => {
    expect(canTransition("needs_mapping", "staged")).toBe(true);
    expect(canTransition("staged", "committed")).toBe(true);
    expect(canTransition("committed", "voided")).toBe(true);
  });

  it("un lote committed no se remapea ni vuelve a staged: se anula", () => {
    expect(canTransition("committed", "staged")).toBe(false);
    expect(canTransition("committed", "needs_mapping")).toBe(false);
    expect(canTransition("committed", "failed")).toBe(false);
  });

  it("voided es terminal", () => {
    for (const status of BatchStatusSchema.options) {
      expect(canTransition("voided", status)).toBe(false);
    }
    expect(BATCH_TRANSITIONS.voided).toEqual([]);
  });

  it("no se confirma un lote sin pasar por staged", () => {
    expect(canTransition("needs_mapping", "committed")).toBe(false);
    expect(canTransition("failed", "committed")).toBe(false);
  });
});

describe("BatchSummarySchema", () => {
  it("acepta un resumen consistente", () => {
    expect(BatchSummarySchema.safeParse(summaryFixture).success).toBe(true);
  });

  it("rechaza si aceptadas + rechazadas + duplicadas no igualan el total", () => {
    expect(BatchSummarySchema.safeParse({ ...summaryFixture, rowsTotal: 11 }).success).toBe(false);
  });

  it("rechaza periodFrom posterior a periodTo o solo uno de los dos", () => {
    expect(BatchSummarySchema.safeParse({ ...summaryFixture, periodFrom: "2026-05-01", periodTo: "2026-01-01" }).success).toBe(false);
    expect(BatchSummarySchema.safeParse({ ...summaryFixture, periodTo: null }).success).toBe(false);
  });

  it("acepta lote sin filas válidas con periodo null", () => {
    expect(BatchSummarySchema.safeParse({
        rowsTotal: 2,
        rowsAccepted: 0,
        rowsRejected: 2,
        rowsDuplicate: 0,
        periodFrom: null,
        periodTo: null,
      }).success).toBe(true);
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
      expect(result.success).toBe(true);
    }
  });

  it("un lote committed sin mapeo o sin resumen se rechaza", () => {
    expect(ImportBatchSchema.safeParse(
        batchCommittedFixture({ columnMapping: null, mappingConfirmedBy: null, mappingConfirmedAt: null }),
      ).success).toBe(false);
    expect(ImportBatchSchema.safeParse(batchCommittedFixture({ summary: null })).success).toBe(false);
  });

  it("un lote committed sin actor de confirmación se rechaza", () => {
    expect(ImportBatchSchema.safeParse(batchCommittedFixture({ committedBy: null })).success).toBe(false);
  });

  it("un lote staged no puede venir ya confirmado", () => {
    expect(ImportBatchSchema.safeParse(batchStagedFixture({ committedAt: "2026-04-01T10:10:00Z", committedBy: "user_admin" })).success).toBe(false);
  });

  it("un lote voided requiere actor, instante y motivo; los demás no los llevan", () => {
    expect(ImportBatchSchema.safeParse(batchVoidedFixture({ voidReason: null })).success).toBe(false);
    expect(ImportBatchSchema.safeParse(batchVoidedFixture({ voidedBy: null })).success).toBe(false);
    expect(ImportBatchSchema.safeParse(batchCommittedFixture({ voidReason: "no debería" })).success).toBe(false);
    expect(ImportBatchSchema.safeParse(batchVoidedFixture({ voidReason: "x" })).success).toBe(false);
  });

  it("un lote needs_mapping no puede traer mapeo ni resumen", () => {
    expect(ImportBatchSchema.safeParse(
        batchNeedsMappingFixture({ columnMapping: batchStagedFixture().columnMapping }),
      ).success).toBe(false);
  });

  it("el mapeo debe referenciar cabeceras que existen en el archivo", () => {
    const result = ImportBatchSchema.safeParse(
      batchStagedFixture({ columnMapping: mappingSplitColumnsFixture }),
    );
    expect(result.success).toBe(false);
  });

  it("el mapeo y su confirmación van juntos", () => {
    expect(ImportBatchSchema.safeParse(batchStagedFixture({ mappingConfirmedBy: null })).success).toBe(false);
  });

  it("las etiquetas del lote se normalizan y respetan el máximo", () => {
    const parsed = ImportBatchSchema.parse(batchStagedFixture({ tags: ["RRHH", " rrhh "] }));
    expect(parsed.tags).toEqual(["rrhh"]);
    const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`);
    expect(ImportBatchSchema.safeParse(batchStagedFixture({ tags: eleven })).success).toBe(false);
  });

  it("rechaza archivos de más de 4 MB, sha256 inválido y campos extra", () => {
    expect(ImportBatchSchema.safeParse(batchStagedFixture({ fileSize: 4 * 1024 * 1024 + 1 })).success).toBe(false);
    expect(ImportBatchSchema.safeParse(batchStagedFixture({ fileSha256: "xyz" })).success).toBe(false);
    expect(ImportBatchSchema.safeParse(batchStagedFixture({ approved: true })).success).toBe(false);
  });
});

describe("BankTransactionSchema", () => {
  it("acepta una salida sin proveedor y una vinculada", () => {
    expect(BankTransactionSchema.safeParse(transactionFixture()).success).toBe(true);
    expect(BankTransactionSchema.safeParse(transactionFixture({ supplierId: "sup_1" })).success).toBe(true);
  });

  it("el importe lleva signo: salida negativa, entrada positiva, nunca 0", () => {
    expect(BankTransactionSchema.safeParse(transactionFixture({ amountMinor: 5000 })).success).toBe(true);
    expect(BankTransactionSchema.safeParse(transactionFixture({ amountMinor: 0 })).success).toBe(false);
  });

  it("rechaza importe flotante o fuera del rango Int32 de la BD y fingerprint inválido", () => {
    expect(BankTransactionSchema.safeParse(transactionFixture({ amountMinor: -10.5 })).success).toBe(false);
    expect(BankTransactionSchema.safeParse(transactionFixture({ amountMinor: -2_147_483_648 })).success).toBe(false);
    expect(BankTransactionSchema.safeParse(transactionFixture({ amountMinor: 2_147_483_648 })).success).toBe(false);
    expect(BankTransactionSchema.safeParse(transactionFixture({ fingerprint: "abc" })).success).toBe(false);
  });

  it("isOutflow distingue salidas de entradas", () => {
    expect(isOutflow({ amountMinor: -1 })).toBe(true);
    expect(isOutflow({ amountMinor: 1 })).toBe(false);
  });

  it("no existe campo de autorización: un campo extra se rechaza", () => {
    expect(BankTransactionSchema.safeParse(transactionFixture({ authorized: true })).success).toBe(false);
  });
});
