/**
 * Purpose: decide whether two contract validity periods overlap, so a supplier never has two
 *   contracts in force on the same day (which would make every invoice match ambiguous).
 * Runs in: server and tests (pure, no I/O).
 * Triggered by: server.ts#createContract before inserting a contract.
 * Receives → Returns: (period, periods[]) → the first overlapping period or null.
 * Talks to: nothing.
 */

// Fechas de calendario YYYY-MM-DD; validTo null = sin fin. Ambos extremos son inclusivos.
export type ContractPeriod = { validFrom: string; validTo: string | null };

const OPEN_END = "9999-12-31";

export function periodsOverlap(a: ContractPeriod, b: ContractPeriod): boolean {
  return a.validFrom <= (b.validTo ?? OPEN_END) && b.validFrom <= (a.validTo ?? OPEN_END);
}

export function findOverlap<T extends ContractPeriod>(period: ContractPeriod, existing: readonly T[]): T | null {
  return existing.find((other) => periodsOverlap(period, other)) ?? null;
}
