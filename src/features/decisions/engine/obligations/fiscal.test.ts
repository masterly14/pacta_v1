/**
 * Purpose: oracle and trap-case tests for the fiscal engine (platform-core §7.2.1, §13):
 *   both demo scenarios against their expected results written beforehand, every rule's
 *   failure path, the run rules, the T-7 / T-3 alerts and invalid accounting data.
 * Runs in: Vitest (`npm test`).
 * Triggered by: `npm test` / `npm run test:watch`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: ./fiscal.ts, @/features/obligations/fiscal (fixture-source, schemas).
 */
import { describe, expect, it } from "vitest";
import { loadFiscalScenario, parseFiscalScenario, FISCAL_SCENARIO_NAMES } from "@/features/obligations/fiscal/fixture-source";
import { FiscalLineDecisionSchema, type FiscalScenario, type FiscalType } from "@/features/obligations/fiscal/schemas";
import { decideFiscalRun, fiscalAlerts, FISCAL_LINE_RULE_IDS, type FiscalRunInput } from "./fiscal";

function inputOf(scenario: FiscalScenario, overrides: Partial<FiscalRunInput> = {}): FiscalRunInput {
  return { template: scenario.template, snapshot: scenario.snapshot, settlements: scenario.settlements, run: scenario.run, asOf: scenario.asOf, ...overrides };
}

// Escenario limpio con un cambio aplicado a un impuesto. structuredClone: el fixture no se muta.
function clean(mutate: (scenario: FiscalScenario) => void = () => {}): FiscalScenario {
  const scenario = structuredClone(loadFiscalScenario("fiscal-limpio"));
  mutate(scenario);
  return scenario;
}

function line(scenario: FiscalScenario, fiscalType: FiscalType, overrides: Partial<FiscalRunInput> = {}) {
  const found = decideFiscalRun(inputOf(scenario, overrides)).lines.find((l) => l.fiscalType === fiscalType);
  if (!found) throw new Error(`no line for ${fiscalType}`);
  return found;
}

function item(scenario: FiscalScenario, fiscalType: FiscalType) {
  const found = scenario.snapshot.items.find((i) => i.fiscalType === fiscalType);
  if (!found) throw new Error(`no item for ${fiscalType}`);
  return found;
}

function settlement(scenario: FiscalScenario, fiscalType: FiscalType) {
  const found = scenario.settlements.find((s) => s.fiscalType === fiscalType);
  if (!found) throw new Error(`no settlement for ${fiscalType}`);
  return found;
}

describe("fiscal scenarios — oracle", () => {
  for (const name of FISCAL_SCENARIO_NAMES) {
    it(`${name}: every line matches the expected result`, () => {
      const scenario = loadFiscalScenario(name);
      const { lines } = decideFiscalRun(inputOf(scenario));
      expect(lines).toHaveLength(scenario.expected.length);
      for (const expected of scenario.expected) {
        const actual = lines.find((l) => l.fiscalType === expected.fiscalType && l.periodStart === expected.periodStart);
        expect(actual, `${expected.fiscalType} ${expected.periodStart}`).toBeDefined();
        expect(actual?.decision, actual?.explanation).toBe(expected.decision);
        expect([...(actual?.reasonCodes ?? [])].sort()).toEqual([...expected.reasonCodes].sort());
      }
    });

    it(`${name}: every decision is a valid, simulated, fixture-labeled output`, () => {
      const { lines } = decideFiscalRun(inputOf(loadFiscalScenario(name)));
      for (const decision of lines) {
        expect(FiscalLineDecisionSchema.safeParse(decision).success).toBe(true);
        expect(decision.isSimulated).toBe(true);
        expect(decision.dataOrigin).toBe("fixture");
        expect(decision.rulesEvaluated.map((r) => r.ruleId).slice(0, FISCAL_LINE_RULE_IDS.length)).toEqual([...FISCAL_LINE_RULE_IDS]);
      }
    });
  }

  it("is deterministic for the same input", () => {
    const scenario = loadFiscalScenario("fiscal-anomalias");
    expect(decideFiscalRun(inputOf(scenario))).toEqual(decideFiscalRun(inputOf(scenario)));
  });
});

describe("fiscal engine — trap cases (never approved)", () => {
  it("only the accounting draft, no settlement → requires_approval", () => {
    const scenario = clean((s) => {
      s.settlements = s.settlements.filter((x) => x.fiscalType !== "vat");
    });
    const vat = line(scenario, "vat");
    expect(vat.decision).toBe("requires_approval");
    expect(vat.reasonCodes).toContain("SETTLEMENT_UNCONFIRMED");
  });

  it("settlement differs by one minor unit → requires_approval", () => {
    const scenario = clean((s) => {
      settlement(s, "vat").amountMinor += 1;
    });
    const vat = line(scenario, "vat");
    expect(vat.decision).toBe("requires_approval");
    expect(vat.reasonCodes).toContain("SETTLEMENT_AMOUNT_MISMATCH");
  });

  it("variance just over the tolerance escalates; exactly at it passes", () => {
    const over = clean((s) => {
      item(s, "social_security").draftAmountMinor = 346500001; // 315000000 × 1.10 + 1
      settlement(s, "social_security").amountMinor = 346500001;
    });
    expect(line(over, "social_security").reasonCodes).toContain("VARIANCE_EXCEEDED");

    const atLimit = clean((s) => {
      item(s, "social_security").draftAmountMinor = 346500000;
      settlement(s, "social_security").amountMinor = 346500000;
    });
    expect(line(atLimit, "social_security").decision).toBe("approved");
  });

  it("no previous confirmed period → requires_approval", () => {
    const scenario = clean((s) => {
      item(s, "vat").previousConfirmedAmountMinor = null;
    });
    expect(line(scenario, "vat").reasonCodes).toContain("INSUFFICIENT_DATA");
    expect(line(scenario, "vat").decision).toBe("requires_approval");
  });

  it("missing draft amount → requires_approval, never approved", () => {
    const scenario = clean((s) => {
      item(s, "vat").draftAmountMinor = null;
    });
    const vat = line(scenario, "vat");
    expect(vat.decision).toBe("requires_approval");
    expect(vat.amountMinor).toBeNull();
    expect(vat.reasonCodes).toContain("INSUFFICIENT_DATA");
  });

  it("changed payment reference → requires_approval", () => {
    const scenario = clean((s) => {
      item(s, "withholding").paymentReference = "DIAN-****0000";
    });
    expect(line(scenario, "withholding").reasonCodes).toContain("BENEFICIARY_CHANGED");
  });

  it("accounting period still open → requires_approval", () => {
    const scenario = clean((s) => {
      item(s, "vat").accountingPeriodClosed = false;
    });
    expect(line(scenario, "vat").reasonCodes).toContain("STALE_EVIDENCE");
  });

  it("stale or future accounting snapshot → requires_approval", () => {
    const scenario = clean();
    expect(line(scenario, "vat", { asOf: "2026-11-13T14:00:00Z" }).reasonCodes).toContain("STALE_EVIDENCE");
    expect(line(scenario, "vat", { asOf: "2026-11-04T14:00:00Z" }).reasonCodes).toContain("STALE_EVIDENCE");
  });

  it("past due date → requires_approval", () => {
    const scenario = clean((s) => {
      s.snapshot.capturedAt = "2026-11-10T12:00:00Z";
    });
    const vat = line(scenario, "vat", { asOf: "2026-11-11T14:00:00Z" });
    expect(vat.decision).toBe("requires_approval");
    expect(vat.reasonCodes).toContain("DEADLINE_PASSED");
  });

  it("template in draft or a tax it does not watch → requires_approval", () => {
    const draft = clean((s) => {
      s.template.status = "draft";
      s.template.activatedBy = null;
      s.template.activatedAt = null;
    });
    expect(line(draft, "vat").reasonCodes).toContain("OBLIGATION_NOT_AUTHORIZED");

    const unwatched = clean((s) => {
      s.template.taxes = s.template.taxes.filter((t) => t.fiscalType !== "vat");
    });
    expect(line(unwatched, "vat").reasonCodes).toContain("OBLIGATION_NOT_AUTHORIZED");
  });

  it("period already paid → blocked, even with everything else correct", () => {
    const scenario = clean((s) => {
      s.run.paidPeriods = [{ fiscalType: "vat", periodStart: "2026-09-01" }];
    });
    const vat = line(scenario, "vat");
    expect(vat.decision).toBe("blocked");
    expect(vat.reasonCodes).toEqual(["DUPLICATE_LINE"]);
  });

  it("a line larger than free funds → blocked", () => {
    const scenario = clean((s) => {
      s.run.fundsAvailableMinor = 600000000;
      s.run.fundsReservedMinor = 0;
    });
    expect(line(scenario, "vat").decision).toBe("blocked");
    expect(line(scenario, "vat").reasonCodes).toContain("FUNDS_INSUFFICIENT");
  });
});

describe("fiscal engine — run rules", () => {
  it("each line fits but the total does not → all approvable lines blocked, run held", () => {
    const scenario = clean((s) => {
      s.run.fundsAvailableMinor = 900000000; // cubre cada línea, no la suma (1.107.000.000)
      s.run.fundsReservedMinor = 0;
    });
    const result = decideFiscalRun(inputOf(scenario));
    expect(result.held).toBe(true);
    for (const decision of result.lines) {
      expect(decision.decision).toBe("blocked");
      expect(decision.reasonCodes).toEqual(["FUNDS_INSUFFICIENT"]);
    }
  });

  it("total over the template cap → requires_approval", () => {
    const scenario = clean((s) => {
      s.template.runCapMinor = 1000000000;
    });
    const result = decideFiscalRun(inputOf(scenario));
    expect(result.held).toBe(false);
    for (const decision of result.lines) {
      expect(decision.decision).toBe("requires_approval");
      expect(decision.reasonCodes).toContain("OBLIGATION_NOT_AUTHORIZED");
    }
  });

  it("escalated lines do not count toward the run total", () => {
    const scenario = clean((s) => {
      s.settlements = s.settlements.filter((x) => x.fiscalType !== "vat"); // IVA escala
      s.run.fundsAvailableMinor = 500000000; // cubre retención + seguridad social (439.000.000)
      s.run.fundsReservedMinor = 0;
    });
    const result = decideFiscalRun(inputOf(scenario));
    expect(result.held).toBe(false);
    expect(result.lines.find((l) => l.fiscalType === "withholding")?.decision).toBe("approved");
    expect(result.lines.find((l) => l.fiscalType === "social_security")?.decision).toBe("approved");
  });
});

describe("fiscal alerts — T-7 / T-3", () => {
  it("T-7 warns with the draft amount and the funds gap", () => {
    const scenario = clean((s) => {
      s.run.fundsAvailableMinor = 400000000; // COP 4.000.000
      s.run.fundsReservedMinor = 0;
    });
    const alerts = fiscalAlerts({ ...inputOf(scenario), asOf: "2026-11-03T13:00:00Z" });
    const vat = alerts.find((a) => a.fiscalType === "vat");
    expect(vat).toMatchObject({ level: "early", daysUntilDue: 7, amountMinor: 668000000, reasonCodes: [], dataOrigin: "fixture" });
    expect(vat?.fundsGapMinor).toBe(268000000 + 124000000); // IVA y retención vencen el mismo día
    expect(vat?.message).toContain("según tu contabilidad (simulada)");
  });

  it("T-3 with a funds gap marks DEADLINE_AT_RISK", () => {
    const scenario = clean((s) => {
      s.run.fundsAvailableMinor = 400000000;
      s.run.fundsReservedMinor = 0;
    });
    const alerts = fiscalAlerts({ ...inputOf(scenario), asOf: "2026-11-07T13:00:00Z" });
    expect(alerts.find((a) => a.fiscalType === "vat")).toMatchObject({ level: "urgent", reasonCodes: ["DEADLINE_AT_RISK"] });
  });

  it("no alert for paid periods, unwatched taxes, past or far dues", () => {
    const scenario = clean((s) => {
      s.run.paidPeriods = [{ fiscalType: "withholding", periodStart: "2026-10-01" }];
      s.template.taxes = s.template.taxes.filter((t) => t.fiscalType !== "social_security");
    });
    expect(fiscalAlerts({ ...inputOf(scenario), asOf: "2026-11-03T13:00:00Z" }).map((a) => a.fiscalType)).toEqual(["vat"]);
    expect(fiscalAlerts({ ...inputOf(scenario), asOf: "2026-10-20T13:00:00Z" })).toEqual([]);
    expect(fiscalAlerts({ ...inputOf(scenario), asOf: "2026-11-11T13:00:00Z" })).toEqual([]);
  });

  it("an unknown draft amount makes the gap unknown and counts as at risk at T-3", () => {
    const scenario = clean((s) => {
      item(s, "vat").draftAmountMinor = null;
    });
    const vat = fiscalAlerts({ ...inputOf(scenario), asOf: "2026-11-08T13:00:00Z" }).find((a) => a.fiscalType === "vat");
    expect(vat).toMatchObject({ amountMinor: null, fundsGapMinor: null, reasonCodes: ["DEADLINE_AT_RISK"] });
  });
});

describe("simulated accounting connector — input boundary", () => {
  it("rejects an unmasked payment reference", () => {
    const raw = structuredClone(loadFiscalScenario("fiscal-limpio")) as unknown as { snapshot: { items: { paymentReference: string }[] } };
    raw.snapshot.items[0].paymentReference = "DIAN-12344410";
    const result = parseFiscalScenario(raw);
    expect(result.ok).toBe(false);
  });

  it("rejects a confirmed settlement without who confirmed it", () => {
    const raw = structuredClone(loadFiscalScenario("fiscal-limpio")) as unknown as { settlements: { confirmedBy: string | null }[] };
    raw.settlements[0].confirmedBy = null;
    expect(parseFiscalScenario(raw).ok).toBe(false);
  });

  it("rejects a float amount and a duplicated tax period", () => {
    const float = structuredClone(loadFiscalScenario("fiscal-limpio")) as unknown as { snapshot: { items: { draftAmountMinor: number }[] } };
    float.snapshot.items[0].draftAmountMinor = 6680000.5;
    expect(parseFiscalScenario(float).ok).toBe(false);

    const dup = structuredClone(loadFiscalScenario("fiscal-limpio"));
    dup.snapshot.items.push(structuredClone(dup.snapshot.items[0]));
    expect(parseFiscalScenario(dup).ok).toBe(false);
  });

  it("rejects accounting data from another organization", () => {
    const raw = structuredClone(loadFiscalScenario("fiscal-limpio"));
    raw.snapshot.organizationId = "org_otra";
    expect(parseFiscalScenario(raw).ok).toBe(false);
  });
});
