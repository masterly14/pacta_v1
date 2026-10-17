/**
 * Purpose: normalize a supplier name into Supplier.normalizedName (catalog uniqueness and matching).
 * Runs in: anywhere (pure function).
 * Triggered by: server.ts when creating suppliers; must match payment-history's normalizeName.
 * Receives → Returns: string → string (lowercase, no accents or punctuation, collapsed whitespace).
 * Talks to: nothing.
 */

// Debe producir exactamente lo mismo que `normalizeName` de payment-history: el CSV
// asocia movimientos a proveedores comparando este valor.
export function normalizeSupplierName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
