import { describe, expect, it } from "vitest";
import type { RecurrenceInput } from "./detect-recurrence";
import {
  getRecurrenceSuggestions,
  hasRecurrenceSuggestion,
  recurrenceWindowStart,
  type RecurrenceStore,
} from "./recurrence-service";

let counter = 0;
function txn(postedOn: string, overrides: Partial<RecurrenceInput> = {}): RecurrenceInput {
  counter += 1;
  return { id: `r${counter}`, postedOn, amountMinor: -2000, currency: "USD", supplierId: "sup_1", description: "HOSTING DEMO", ...overrides };
}

function fakeStore(transactions: RecurrenceInput[], truncated = false) {
  const calls: { organizationId: string; since: string; supplierId?: string }[] = [];
  const store: RecurrenceStore = {
    async listOutflows(organizationId, filter) {
      calls.push({ organizationId, since: filter.since, supplierId: filter.supplierId });
      return { transactions, truncated };
    },
  };
  return { store, calls };
}

const monthly = [txn("2026-01-15"), txn("2026-02-14"), txn("2026-03-16")];
const now = new Date("2026-04-01T12:00:00Z");

describe("recurrenceWindowStart", () => {
  it("retrocede 18 meses en calendario UTC", () => {
    expect(recurrenceWindowStart(now)).toBe("2024-10-01");
  });
});

describe("getRecurrenceSuggestions", () => {
  it("consulta acotada por organización y ventana, y detecta la recurrencia", async () => {
    const { store, calls } = fakeStore(monthly);
    const result = await getRecurrenceSuggestions(store, { organizationId: "org_a", now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestions.length).toBe(1);
    expect(calls).toEqual([{ organizationId: "org_a", since: "2024-10-01", supplierId: undefined }]);
  });

  it("filtra por proveedor", async () => {
    const { store } = fakeStore([...monthly, ...["2026-01-10", "2026-02-09", "2026-03-11"].map((d) => txn(d, { supplierId: "sup_2" }))]);
    const result = await getRecurrenceSuggestions(store, { organizationId: "org_a", supplierId: "sup_2", now });
    expect(result.ok && result.suggestions.length).toBe(1);
    expect(result.ok && result.suggestions[0].supplierId).toBe("sup_2");
  });

  it("fail-closed: con datos truncados no afirma nada", async () => {
    const { store } = fakeStore(monthly, true);
    expect((await getRecurrenceSuggestions(store, { organizationId: "org_a", now })).ok).toBe(false);
  });
});

describe("hasRecurrenceSuggestion", () => {
  it("true solo si el proveedor tiene una recurrencia sugerida", async () => {
    expect(await hasRecurrenceSuggestion(fakeStore(monthly).store, { organizationId: "org_a", supplierId: "sup_1", now })).toBe(true);
    expect(await hasRecurrenceSuggestion(fakeStore(monthly.slice(0, 2)).store, { organizationId: "org_a", supplierId: "sup_1", now })).toBe(false);
  });

  it("false si no se puede calcular (la regla del motor escala igual por falta de autorización)", async () => {
    expect(await hasRecurrenceSuggestion(fakeStore(monthly, true).store, { organizationId: "org_a", supplierId: "sup_1", now })).toBe(false);
  });
});
