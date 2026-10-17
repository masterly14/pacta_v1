/**
 * Purpose: tests for float-free amount parsing and formatting.
 * Runs in: Vitest (`npm test`).
 * Triggered by: `npm test`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: ./money.ts.
 */
import { describe, expect, it } from "vitest";
import { formatMinor, MAX_AMOUNT_MINOR, parseAmountToMinor } from "./money";

describe("parseAmountToMinor", () => {
  it.each([
    ["20", 2000],
    ["20.5", 2050],
    ["20.05", 2005],
    ["0.01", 1],
    ["1250.00", 125_000],
    [" 007.10 ", 710],
  ])("parses %s USD as %d", (input, expected) => {
    expect(parseAmountToMinor(input, "USD")).toEqual({ ok: true, amountMinor: expected });
  });

  it("does not suffer from float rounding", () => {
    // 0.1 + 0.2 y 19.99 * 100 fallan con floats.
    expect(parseAmountToMinor("19.99", "USD")).toEqual({ ok: true, amountMinor: 1999 });
    expect(parseAmountToMinor("1.15", "USD")).toEqual({ ok: true, amountMinor: 115 });
  });

  it("uses the currency scale", () => {
    expect(parseAmountToMinor("1500", "JPY")).toEqual({ ok: true, amountMinor: 1500 });
    expect(parseAmountToMinor("1.5", "JPY").ok).toBe(false);
    expect(parseAmountToMinor("1.234", "KWD")).toEqual({ ok: true, amountMinor: 1234 });
  });

  it.each(["20.055", "-1", "abc", "", "1e3", "20.", ".5", "1.2.3", "1,250.00"])("rejects %j", (input) => {
    expect(parseAmountToMinor(input, "USD").ok).toBe(false);
  });

  it("rejects amounts above the int4 column limit", () => {
    expect(parseAmountToMinor("21474836.47", "USD")).toEqual({ ok: true, amountMinor: MAX_AMOUNT_MINOR });
    expect(parseAmountToMinor("21474836.48", "USD").ok).toBe(false);
    expect(parseAmountToMinor("99999999999999999999", "USD").ok).toBe(false);
  });
});

describe("formatMinor", () => {
  it("formats by currency scale", () => {
    expect(formatMinor(2050, "USD")).toBe("20.50 USD");
    expect(formatMinor(5, "USD")).toBe("0.05 USD");
    expect(formatMinor(1500, "JPY")).toBe("1500 JPY");
    expect(formatMinor(1234, "KWD")).toBe("1.234 KWD");
  });
});
