import { describe, expect, it } from "vitest";
import { parseBankCsv } from "./parse-bank-csv";

const header = "date,description,amount,currency,reference";

describe("parseBankCsv", () => {
  it("reads a signed amount as an outflow and keeps the reference", () => {
    const result = parseBankCsv(`${header}\n2026-01-15,HOSTING DEMO,-20.00,USD,demo-1\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      {
        rowNumber: 2,
        postedOn: "2026-01-15",
        amountMinor: -2000,
        currency: "USD",
        description: "HOSTING DEMO",
        externalRef: "demo-1",
      },
    ]);
  });

  it("treats direction debit as an outflow and credit as an inflow", () => {
    const result = parseBankCsv(
      "posted_on,description,amount,direction,currency\n2026-02-14,HOSTING DEMO,20.00,debit,usd\n2026-02-20,HOSTING DEMO,5.00,credit,USD\n",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.amountMinor)).toEqual([-2000, 500]);
  });

  it("keeps valid rows and rejects a bad date, a comma amount, a zero and a formula", () => {
    const csv = [
      header,
      "2026-13-01,HOSTING DEMO,-20.00,USD,bad-date",
      "2026-01-15,HOSTING DEMO,\"-20,00\",USD,comma",
      "2026-01-15,HOSTING DEMO,0.00,USD,zero",
      "2026-01-15,=CMD(),-20.00,USD,formula",
      "2026-03-16,HOSTING DEMO,-20.00,USD,ok",
    ].join("\n");
    const result = parseBankCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((row) => row.externalRef)).toEqual(["ok"]);
    expect(result.rejected).toHaveLength(4);
  });

  it("rejects a file whose headers are not a supported layout", () => {
    const result = parseBankCsv("fecha,concepto,valor\n2026-01-15,HOSTING,-20\n");
    expect(result.ok).toBe(false);
  });

  it("accepts a semicolon-separated file", () => {
    const result = parseBankCsv("date;description;amount;currency\n2026-01-15;HOSTING DEMO;-20.00;USD\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0].amountMinor).toBe(-2000);
  });
});
