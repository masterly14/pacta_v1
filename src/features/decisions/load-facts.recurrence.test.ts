import { describe, expect, it } from "vitest";
import type { RecurrenceInput } from "@/features/payment-history/recurrence/detect-recurrence";
import type { RecurrenceStore } from "@/features/payment-history/recurrence/recurrence-service";
import { loadRecurrenceSuggested } from "./load-facts";

let counter = 0;
function outflow(postedOn: string, overrides: Partial<RecurrenceInput> = {}): RecurrenceInput {
  counter += 1;
  return {
    id: `r${counter}`,
    postedOn,
    amountMinor: -2000,
    currency: "USD",
    supplierId: "sup_1",
    description: "HOSTING DEMO",
    ...overrides,
  };
}

function storeOf(transactions: RecurrenceInput[], truncated = false): RecurrenceStore {
  return {
    async listOutflows() {
      return { transactions, truncated };
    },
  };
}

const invoice = { organizationId: "org_a", supplierId: "sup_1" as string | null };
const now = new Date("2026-04-01T12:00:00Z");
const monthly = [outflow("2026-01-15"), outflow("2026-02-14"), outflow("2026-03-16")];

describe("loadRecurrenceSuggested", () => {
  it("is true only when the detector finds a cadence, not merely three outflows", async () => {
    expect(await loadRecurrenceSuggested(storeOf(monthly), invoice, now)).toBe(true);

    const irregular = [outflow("2026-01-01"), outflow("2026-01-05"), outflow("2026-06-01")];
    expect(await loadRecurrenceSuggested(storeOf(irregular), invoice, now)).toBe(false);
  });

  it("is false when amounts are outside the 10% band", async () => {
    const uneven = [
      outflow("2026-01-15", { amountMinor: -1000 }),
      outflow("2026-02-14", { amountMinor: -5000 }),
      outflow("2026-03-16", { amountMinor: -1000 }),
    ];
    expect(await loadRecurrenceSuggested(storeOf(uneven), invoice, now)).toBe(false);
  });

  it("is false without a confirmed supplier, and when the history cannot be calculated", async () => {
    expect(await loadRecurrenceSuggested(storeOf(monthly), { ...invoice, supplierId: null }, now)).toBe(false);
    expect(await loadRecurrenceSuggested(storeOf(monthly, true), invoice, now)).toBe(false);
  });
});
