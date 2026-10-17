/**
 * Purpose: convert USD amounts typed by a person to integer minor units and back, without floats.
 * Runs in: anywhere (pure functions).
 * Triggered by: schemas.ts (form parsing) and the policies page (display).
 * Receives → Returns: parseUsdToMinor("1,234.50") → 123450 | null; formatUsd(123450) → "$1,234.50";
 *   toUsdInput(123450) → "1234.50".
 * Talks to: nothing.
 */

// Máximo de una columna int4 de Postgres (importes en unidades menores).
export const MAX_AMOUNT_MINOR = 2_147_483_647;

// Acepta "25", "25.5", "25.50", "1,234.56" y "$25". Rechaza negativos, más de 2 decimales y vacíos.
export function parseUsdToMinor(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (match === null) {
    return null;
  }
  const whole = match[1];
  const cents = (match[2] ?? "").padEnd(2, "0");
  if (whole.length > 8) {
    return null; // evita enteros fuera de rango antes de convertir
  }
  const minor = Number(whole) * 100 + Number(cents);
  return minor <= MAX_AMOUNT_MINOR ? minor : null;
}

// Valor editable para un input: 200000 → "2000.00" (lo que parseUsdToMinor acepta de vuelta).
export function toUsdInput(amountMinor: number): string {
  return `${Math.trunc(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`;
}

export function formatUsd(amountMinor: number): string {
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  const whole = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}$${whole}.${cents}`;
}
