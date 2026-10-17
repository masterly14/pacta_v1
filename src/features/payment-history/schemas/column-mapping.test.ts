import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ColumnMappingSchema,
  DetectedHeadersSchema,
  mappingHeaders,
  validateMappingAgainstHeaders,
} from "./column-mapping.ts";
import {
  detectedHeadersFixture,
  mappingAmountAndDirectionFixture,
  mappingSignedFixture,
  mappingSplitColumnsFixture,
  splitHeadersFixture,
} from "./fixtures.ts";

describe("ColumnMappingSchema", () => {
  it("acepta los tres layouts de importe", () => {
    for (const fixture of [mappingAmountAndDirectionFixture, mappingSignedFixture, mappingSplitColumnsFixture]) {
      assert.equal(ColumnMappingSchema.safeParse(fixture).success, true);
    }
  });

  it("rechaza dos campos asignados a la misma cabecera", () => {
    const result = ColumnMappingSchema.safeParse({
      ...mappingAmountAndDirectionFixture,
      amount: { layout: "amount_and_direction", amountHeader: "Importe", directionHeader: "Importe" },
    });
    assert.equal(result.success, false);
  });

  it("rechaza débito y crédito en la misma columna", () => {
    const result = ColumnMappingSchema.safeParse({
      ...mappingSplitColumnsFixture,
      amount: { layout: "debit_credit_columns", debitHeader: "Debit", creditHeader: "Debit" },
    });
    assert.equal(result.success, false);
  });

  it("rechaza una descripción asignada a la columna de la fecha", () => {
    const result = ColumnMappingSchema.safeParse({ ...mappingSignedFixture, description: { header: "Fecha" } });
    assert.equal(result.success, false);
  });

  it("exige formato de fecha explícito (nunca se adivina)", () => {
    assert.equal(
      ColumnMappingSchema.safeParse({ ...mappingSignedFixture, date: { header: "Fecha" } }).success,
      false,
    );
    assert.equal(
      ColumnMappingSchema.safeParse({ ...mappingSignedFixture, date: { header: "Fecha", format: "auto" } }).success,
      false,
    );
  });

  it("exige separador decimal explícito", () => {
    const withoutSeparator: Record<string, unknown> = { ...mappingSignedFixture };
    delete withoutSeparator.decimalSeparator;
    assert.equal(ColumnMappingSchema.safeParse(withoutSeparator).success, false);
  });

  it("rechaza moneda fija en minúsculas o con layout mezclado", () => {
    assert.equal(
      ColumnMappingSchema.safeParse({ ...mappingSignedFixture, currency: { source: "fixed", code: "usd" } }).success,
      false,
    );
    assert.equal(
      ColumnMappingSchema.safeParse({
        ...mappingSignedFixture,
        amount: { layout: "signed_amount", amountHeader: "Importe", debitHeader: "Debit" },
      }).success,
      false,
    );
  });

  it("rechaza campos extra (strict)", () => {
    assert.equal(ColumnMappingSchema.safeParse({ ...mappingSignedFixture, autoApply: true }).success, false);
  });

  it("lista las cabeceras referenciadas", () => {
    const mapping = ColumnMappingSchema.parse(mappingAmountAndDirectionFixture);
    assert.deepEqual(mappingHeaders(mapping), [
      "Fecha",
      "Importe",
      "Tipo",
      "Moneda",
      "Descripcion",
      "Contraparte",
      "Referencia",
    ]);
  });
});

describe("validateMappingAgainstHeaders", () => {
  const detected = DetectedHeadersSchema.parse(detectedHeadersFixture);

  it("ok cuando todas las cabeceras existen", () => {
    const mapping = ColumnMappingSchema.parse(mappingAmountAndDirectionFixture);
    assert.deepEqual(validateMappingAgainstHeaders(mapping, detected), { ok: true });
  });

  it("informa las cabeceras inexistentes", () => {
    const mapping = ColumnMappingSchema.parse(mappingSplitColumnsFixture);
    const check = validateMappingAgainstHeaders(mapping, detected);
    assert.equal(check.ok, false);
    if (!check.ok) assert.ok(check.missingHeaders.includes("Debit"));
  });

  it("el mapeo split valida contra sus propias cabeceras", () => {
    const mapping = ColumnMappingSchema.parse(mappingSplitColumnsFixture);
    const check = validateMappingAgainstHeaders(mapping, DetectedHeadersSchema.parse(splitHeadersFixture));
    assert.deepEqual(check, { ok: true });
  });
});

describe("DetectedHeadersSchema", () => {
  it("rechaza cabeceras duplicadas aunque cambien mayúsculas o tildes", () => {
    assert.equal(DetectedHeadersSchema.safeParse({ schemaVersion: 1, headers: ["Fecha", "fecha"] }).success, false);
    assert.equal(DetectedHeadersSchema.safeParse({ schemaVersion: 1, headers: ["Descripción", "Descripcion"] }).success, false);
  });

  it("rechaza lista vacía y más de 200 cabeceras", () => {
    assert.equal(DetectedHeadersSchema.safeParse({ schemaVersion: 1, headers: [] }).success, false);
    const many = Array.from({ length: 201 }, (_, i) => `col${i}`);
    assert.equal(DetectedHeadersSchema.safeParse({ schemaVersion: 1, headers: many }).success, false);
  });
});
