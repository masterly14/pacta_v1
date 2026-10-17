/**
 * Purpose: tests for contract period overlap (no two contracts in force on the same day).
 * Runs in: Vitest (`npm test`).
 * Triggered by: `npm test` / `npm run test:watch`.
 * Receives → Returns: nothing; passes or fails.
 * Talks to: ./overlap.ts.
 */
import { describe, expect, it } from "vitest";
import { findOverlap, periodsOverlap } from "./overlap";

describe("periodsOverlap", () => {
  it.each([
    ["identical periods", { validFrom: "2026-01-01", validTo: "2026-12-31" }, { validFrom: "2026-01-01", validTo: "2026-12-31" }],
    ["partial overlap", { validFrom: "2026-01-01", validTo: "2026-06-30" }, { validFrom: "2026-06-01", validTo: "2026-12-31" }],
    ["shared boundary day (inclusive)", { validFrom: "2026-01-01", validTo: "2026-06-30" }, { validFrom: "2026-06-30", validTo: null }],
    ["both open-ended", { validFrom: "2026-01-01", validTo: null }, { validFrom: "2027-01-01", validTo: null }],
    ["one contains the other", { validFrom: "2026-01-01", validTo: null }, { validFrom: "2026-03-01", validTo: "2026-04-01" }],
  ])("detects %s", (_label, a, b) => {
    expect(periodsOverlap(a, b)).toBe(true);
    expect(periodsOverlap(b, a)).toBe(true);
  });

  it.each([
    ["back-to-back renewal", { validFrom: "2026-01-01", validTo: "2026-06-30" }, { validFrom: "2026-07-01", validTo: null }],
    ["future contract after an ended one", { validFrom: "2025-01-01", validTo: "2025-12-31" }, { validFrom: "2026-01-01", validTo: "2026-12-31" }],
  ])("allows %s", (_label, a, b) => {
    expect(periodsOverlap(a, b)).toBe(false);
    expect(periodsOverlap(b, a)).toBe(false);
  });
});

describe("findOverlap", () => {
  it("returns the first overlapping period, or null", () => {
    const existing = [
      { id: "old", validFrom: "2025-01-01", validTo: "2025-12-31" },
      { id: "current", validFrom: "2026-01-01", validTo: null },
    ];
    expect(findOverlap({ validFrom: "2026-10-01", validTo: null }, existing)?.id).toBe("current");
    expect(findOverlap({ validFrom: "2024-01-01", validTo: "2024-12-31" }, existing)).toBeNull();
  });
});
