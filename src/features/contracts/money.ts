/**
 * Purpose: turn a decimal amount typed by a person ("20.00") into integer minor units
 *   without floats, using the ISO 4217 scale of the currency.
 * Runs in: server and tests (pure, no I/O).
 * Triggered by: ContractInputSchema when validating the contract form or POST /api/contracts.
 * Receives → Returns: (decimal string, ISO 4217 code) → { ok: true, amountMinor } | { ok: false, error }.
 * Talks to: nothing.
 */

// Monedas cuya escala no es 2. El resto usa 2 decimales (USD, EUR, COP, MXN...).
const CURRENCY_SCALES: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  CLP: 0,
  VND: 0,
  ISK: 0,
  KWD: 3,
  BHD: 3,
  JOD: 3,
  OMR: 3,
  TND: 3,
};

// Límite de la columna int4 en Postgres.
export const MAX_AMOUNT_MINOR = 2_147_483_647;

export function currencyScale(currency: string): number {
  return CURRENCY_SCALES[currency] ?? 2;
}

export type ParseAmountResult = { ok: true; amountMinor: number } | { ok: false; error: string };

// Solo aritmética de texto: "20.5" → "20" + "50" → 2050. Nunca parseFloat.
export function parseAmountToMinor(input: string, currency: string): ParseAmountResult {
  const value = input.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    return { ok: false, error: "Use a positive decimal number such as 20.00" };
  }
  const scale = currencyScale(currency);
  const [, whole, fraction = ""] = match;
  if (fraction.length > scale) {
    return { ok: false, error: `${currency} allows at most ${scale} decimal places` };
  }
  const digits = (whole + fraction.padEnd(scale, "0")).replace(/^0+(?=\d)/, "");
  if (digits.length > String(MAX_AMOUNT_MINOR).length || Number(digits) > MAX_AMOUNT_MINOR) {
    return { ok: false, error: "Amount is too large" };
  }
  return { ok: true, amountMinor: Number(digits) };
}

// Inverso para mostrar: 2050, "USD" → "20.50 USD".
export function formatMinor(amountMinor: number, currency: string): string {
  const scale = currencyScale(currency);
  if (scale === 0) {
    return `${amountMinor} ${currency}`;
  }
  const digits = String(amountMinor).padStart(scale + 1, "0");
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)} ${currency}`;
}
