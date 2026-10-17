/**
 * Purpose: tests for UTC calendar period math used by authorization usage and budget.
 * Runs in: Vitest (`npm test`).
 * Triggered by: `npm test` / `npm run test:watch`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: ./periods.ts.
 */
import { describe, expect, it } from "vitest";
import { monthBoundsUtc, periodBounds } from "./periods";

describe("periodBounds", () => {
  it.each([
    ["monthly", "2026-10-17", "2026-10-01", "2026-10-31"],
    ["monthly", "2026-02-10", "2026-02-01", "2026-02-28"],
    ["monthly", "2028-02-29", "2028-02-01", "2028-02-29"],
    ["monthly", "2026-12-31", "2026-12-01", "2026-12-31"],
    ["quarterly", "2026-10-17", "2026-10-01", "2026-12-31"],
    ["quarterly", "2026-03-31", "2026-01-01", "2026-03-31"],
    ["yearly", "2026-06-15", "2026-01-01", "2026-12-31"],
    ["weekly", "2026-10-17", "2026-10-12", "2026-10-18"], // sábado → semana lun 12 – dom 18
    ["weekly", "2026-10-12", "2026-10-12", "2026-10-18"], // lunes
    ["weekly", "2026-10-18", "2026-10-12", "2026-10-18"], // domingo
    ["weekly", "2026-12-31", "2026-12-28", "2027-01-03"], // cruza de año
  ] as const)("%s period of %s is %s → %s", (frequency, date, start, end) => {
    expect(periodBounds(frequency, date)).toEqual({ start, end });
  });
});

describe("monthBoundsUtc", () => {
  it("returns the UTC calendar month of an instant", () => {
    expect(monthBoundsUtc("2026-10-17T12:00:00Z")).toEqual({
      start: new Date("2026-10-01T00:00:00.000Z"),
      endExclusive: new Date("2026-11-01T00:00:00.000Z"),
    });
  });

  it("uses UTC, not local time, at month edges", () => {
    expect(monthBoundsUtc("2026-10-31T23:59:59Z").endExclusive).toEqual(new Date("2026-11-01T00:00:00.000Z"));
    expect(monthBoundsUtc("2026-11-01T00:00:00Z").start).toEqual(new Date("2026-11-01T00:00:00.000Z"));
  });
});
