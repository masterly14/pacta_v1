import { describe, expect, it } from "vitest";
import {
  ColumnMappingSchema,
  DetectedHeadersSchema,
  mappingHeaders,
  validateMappingAgainstHeaders,
} from "./column-mapping";
import {
  detectedHeadersFixture,
  mappingAmountAndDirectionFixture,
  mappingSignedFixture,
  mappingSplitColumnsFixture,
  splitHeadersFixture,
} from "./fixtures";

describe("ColumnMappingSchema", () => {
  it("acepta los tres layouts de importe", () => {
    for (const fixture of [mappingAmountAndDirectionFixture, mappingSignedFixture, mappingSplitColumnsFixture]) {
      expect(ColumnMappingSchema.safeParse(fixture).success).toBe(true);
    }
  });

  it("rechaza dos campos asignados a la misma cabecera", () => {
    const result = ColumnMappingSchema.safeParse({
      ...mappingAmountAndDirectionFixture,
      amount: { layout: "amount_and_direction", amountHeader: "Importe", directionHeader: "Importe" },
    });
    expect(result.success).toBe(false);
  });

  it("rechaza débito y crédito en la misma columna", () => {
    const result = ColumnMappingSchema.safeParse({
      ...mappingSplitColumnsFixture,
      amount: { layout: "debit_credit_columns", debitHeader: "Debit", creditHeader: "Debit" },
    });
    expect(result.success).toBe(false);
  });

  it("rechaza una descripción asignada a la columna de la fecha", () => {
    const result = ColumnMappingSchema.safeParse({ ...mappingSignedFixture, description: { header: "Fecha" } });
    expect(result.success).toBe(false);
  });

  it("exige formato de fecha explícito (nunca se adivina)", () => {
    expect(ColumnMappingSchema.safeParse({ ...mappingSignedFixture, date: { header: "Fecha" } }).success).toBe(false);
    expect(ColumnMappingSchema.safeParse({ ...mappingSignedFixture, date: { header: "Fecha", format: "auto" } }).success).toBe(false);
  });

  it("exige separador decimal explícito", () => {
    const withoutSeparator: Record<string, unknown> = { ...mappingSignedFixture };
    delete withoutSeparator.decimalSeparator;
    expect(ColumnMappingSchema.safeParse(withoutSeparator).success).toBe(false);
  });

  it("rechaza moneda fija en minúsculas o con layout mezclado", () => {
    expect(ColumnMappingSchema.safeParse({ ...mappingSignedFixture, currency: { source: "fixed", code: "usd" } }).success).toBe(false);
    expect(ColumnMappingSchema.safeParse({
        ...mappingSignedFixture,
        amount: { layout: "signed_amount", amountHeader: "Importe", debitHeader: "Debit" },
      }).success).toBe(false);
  });

  it("rechaza campos extra (strict)", () => {
    expect(ColumnMappingSchema.safeParse({ ...mappingSignedFixture, autoApply: true }).success).toBe(false);
  });

  it("lista las cabeceras referenciadas", () => {
    const mapping = ColumnMappingSchema.parse(mappingAmountAndDirectionFixture);
    expect(mappingHeaders(mapping)).toEqual([
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
    expect(validateMappingAgainstHeaders(mapping, detected)).toEqual({ ok: true });
  });

  it("informa las cabeceras inexistentes", () => {
    const mapping = ColumnMappingSchema.parse(mappingSplitColumnsFixture);
    const check = validateMappingAgainstHeaders(mapping, detected);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.missingHeaders.includes("Debit")).toBeTruthy();
  });

  it("el mapeo split valida contra sus propias cabeceras", () => {
    const mapping = ColumnMappingSchema.parse(mappingSplitColumnsFixture);
    const check = validateMappingAgainstHeaders(mapping, DetectedHeadersSchema.parse(splitHeadersFixture));
    expect(check).toEqual({ ok: true });
  });
});

describe("DetectedHeadersSchema", () => {
  it("rechaza cabeceras duplicadas aunque cambien mayúsculas o tildes", () => {
    expect(DetectedHeadersSchema.safeParse({ schemaVersion: 1, headers: ["Fecha", "fecha"] }).success).toBe(false);
    expect(DetectedHeadersSchema.safeParse({ schemaVersion: 1, headers: ["Descripción", "Descripcion"] }).success).toBe(false);
  });

  it("rechaza lista vacía y más de 200 cabeceras", () => {
    expect(DetectedHeadersSchema.safeParse({ schemaVersion: 1, headers: [] }).success).toBe(false);
    const many = Array.from({ length: 201 }, (_, i) => `col${i}`);
    expect(DetectedHeadersSchema.safeParse({ schemaVersion: 1, headers: many }).success).toBe(false);
  });
});
