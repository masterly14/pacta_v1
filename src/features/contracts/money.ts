/**
 * Purpose: turn a decimal amount typed by a person ("20.00") into integer minor units
 *   without floats, using the ISO 4217 scale of the currency. Only currencies with a
 *   known scale are supported; any other code is rejected, never guessed.
 * Runs in: server and tests (pure, no I/O).
 * Triggered by: ContractInputSchema when validating the contract form or POST /api/contracts.
 * Receives → Returns: (decimal string, ISO 4217 code) → { ok: true, amountMinor } | { ok: false, error };
 *   formatMinor(amountMinor, code) → display text.
 * Talks to: nothing.
 */

// Monedas admitidas y sus decimales (ISO 4217). Una moneda fuera de la lista se rechaza:
// suponer una escala guardaría montos multiplicados o divididos por 10^n.
export const CURRENCY_SCALES: Readonly<Record<string, number>> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  CHF: 2,
  MXN: 2,
  COP: 2,
  BRL: 2,
  ARS: 2,
  PEN: 2,
  INR: 2,
  CNY: 2,
  JPY: 0,
  KRW: 0,
  CLP: 0,
};

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_SCALES);

// Límite de la columna int4 en Postgres.
export const MAX_AMOUNT_MINOR = 2_147_483_647;

export function currencyScale(currency: string): number | null {
  return Object.hasOwn(CURRENCY_SCALES, currency) ? CURRENCY_SCALES[currency] : null;
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
  if (scale === null) {
    return { ok: false, error: `Currency ${currency} is not supported` };
  }
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

// Inverso para mostrar: 2050, "USD" → "20.50 USD". Sin escala conocida no se inventa un punto decimal.
export function formatMinor(amountMinor: number, currency: string): string {
  const scale = currencyScale(currency);
  if (scale === null) {
    return `${amountMinor} minor units ${currency}`;
  }
  if (scale === 0) {
    return `${amountMinor} ${currency}`;
  }
  const digits = String(amountMinor).padStart(scale + 1, "0");
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)} ${currency}`;
}
