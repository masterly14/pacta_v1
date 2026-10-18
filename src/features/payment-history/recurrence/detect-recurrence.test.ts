import { describe, expect, it } from "vitest";
import { RecurrenceSuggestionSchema } from "../schemas/history-queries";
import { detectRecurrences, type RecurrenceInput } from "./detect-recurrence";

let counter = 0;
function txn(overrides: Partial<RecurrenceInput> & { postedOn: string }): RecurrenceInput {
  counter += 1;
  return {
    id: `t${String(counter).padStart(3, "0")}`,
    amountMinor: -2000,
    currency: "USD",
    supplierId: null,
    description: "COMPRA TARJETA 4455 HOSTING DEMO INC",
    ...overrides,
  };
}

const monthly = ["2026-01-15", "2026-02-14", "2026-03-16"];

describe("detectRecurrences", () => {
  it("3 pagos mensuales al mismo proveedor => sugerencia mensual", () => {
    const result = detectRecurrences(monthly.map((postedOn) => txn({ postedOn, supplierId: "sup_1" })));
    expect(result.length).toBe(1);
    expect(result[0].cadence).toBe("monthly");
    expect(result[0].occurrences).toBe(3);
    expect(result[0].typicalAmountMinor).toBe(2000);
    expect(result[0].groupKind).toBe("supplier");
    expect(result[0].supplierId).toBe("sup_1");
    expect(result[0].isSuggestionOnly).toBe(true);
    expect(RecurrenceSuggestionSchema.safeParse(result[0]).success).toBe(true);
  });

  it("2 pagos no alcanzan el mínimo", () => {
    expect(detectRecurrences(monthly.slice(0, 2).map((postedOn) => txn({ postedOn, supplierId: "sup_1" })))).toEqual([]);
  });

  it("detecta también contrapartes sin proveedor, agrupadas por clave", () => {
    const result = detectRecurrences(monthly.map((postedOn) => txn({ postedOn })));
    expect(result.length).toBe(1);
    expect(result[0].groupKind).toBe("unlinked_counterparty");
    expect(result[0].supplierId).toBe(null);
    expect(result[0].counterpartyNormalized).toBe("hosting demo");
  });

  it("un proveedor une descripciones distintas del banco", () => {
    const result = detectRecurrences([
      txn({ postedOn: "2026-01-15", supplierId: "sup_1", description: "HOSTING DEMO INC" }),
      txn({ postedOn: "2026-02-14", supplierId: "sup_1", description: "PAGO HOSTING-DEMO.COM 9981" }),
      txn({ postedOn: "2026-03-16", supplierId: "sup_1", description: "Hosting Demo LLC ref 55" }),
    ]);
    expect(result.length).toBe(1);
    expect(result[0].occurrences).toBe(3);
  });

  it("tolerancia de monto: 10 % exacto pasa, 11 % no", () => {
    const within = detectRecurrences(
      [-10000, -11000, -9000].map((amountMinor, i) => txn({ postedOn: monthly[i], amountMinor, supplierId: "s" })),
    );
    expect(within.length).toBe(1);
    const outside = detectRecurrences(
      [-10000, -10000, -11200].map((amountMinor, i) => txn({ postedOn: monthly[i], amountMinor, supplierId: "s" })),
    );
    expect(outside).toEqual([]);
  });

  it("un hueco de 60 días corta la racha, pero una racha final de 3 se sugiere", () => {
    const dates = ["2025-10-01", "2025-12-05", "2026-01-15", "2026-02-14", "2026-03-16"];
    const result = detectRecurrences(dates.map((postedOn) => txn({ postedOn, supplierId: "s" })));
    expect(result.length).toBe(1);
    expect(result[0].occurrences).toBe(3);
    expect(result[0].firstPostedOn).toBe("2026-01-15");
    expect(result[0].lastPostedOn).toBe("2026-03-16");
  });

  it("un mes faltante rompe la serie: intervalos irregulares no son recurrencia", () => {
    const dates = ["2026-01-15", "2026-02-14", "2026-04-20"];
    expect(detectRecurrences(dates.map((postedOn) => txn({ postedOn, supplierId: "s" })))).toEqual([]);
  });

  it("detecta cadencias semanal, trimestral y anual", () => {
    const weekly = ["2026-03-02", "2026-03-09", "2026-03-16"];
    const quarterly = ["2025-09-15", "2025-12-15", "2026-03-16"];
    const yearly = ["2024-03-15", "2025-03-15", "2026-03-15"];
    expect(detectRecurrences(weekly.map((postedOn) => txn({ postedOn, supplierId: "w" })))[0].cadence).toBe("weekly");
    expect(detectRecurrences(quarterly.map((postedOn) => txn({ postedOn, supplierId: "q" })))[0].cadence).toBe("quarterly");
    expect(detectRecurrences(yearly.map((postedOn) => txn({ postedOn, supplierId: "y" })))[0].cadence).toBe("yearly");
  });

  it("no mezcla monedas", () => {
    const result = detectRecurrences([
      txn({ postedOn: monthly[0], supplierId: "s", currency: "USD" }),
      txn({ postedOn: monthly[1], supplierId: "s", currency: "EUR" }),
      txn({ postedOn: monthly[2], supplierId: "s", currency: "USD" }),
    ]);
    expect(result).toEqual([]);
  });

  it("ignora entradas", () => {
    const result = detectRecurrences(monthly.map((postedOn) => txn({ postedOn, supplierId: "s", amountMinor: 2000 })));
    expect(result).toEqual([]);
  });

  it("mismo día y monto cuenta una sola vez", () => {
    const result = detectRecurrences([
      txn({ postedOn: monthly[0], supplierId: "s" }),
      txn({ postedOn: monthly[0], supplierId: "s" }), // doble apunte
      txn({ postedOn: monthly[1], supplierId: "s" }),
    ]);
    expect(result).toEqual([]); // solo 2 ocurrencias reales
  });

  it("descripciones sin contraparte identificable y sin proveedor no se agrupan", () => {
    const result = detectRecurrences(monthly.map((postedOn) => txn({ postedOn, description: "TRANSFERENCIA" })));
    expect(result).toEqual([]);
  });

  it("no depende del orden de entrada", () => {
    const input = monthly.map((postedOn) => txn({ postedOn, supplierId: "s" }));
    expect(detectRecurrences([...input].reverse())).toEqual(detectRecurrences(input));
  });

  it("jamás produce un permiso: solo sugerencias marcadas", () => {
    const result = detectRecurrences(monthly.map((postedOn) => txn({ postedOn, supplierId: "s" })));
    for (const suggestion of result) {
      expect(suggestion.isSuggestionOnly).toBe(true);
      expect("authorized" in suggestion).toBe(false);
    }
  });
});
