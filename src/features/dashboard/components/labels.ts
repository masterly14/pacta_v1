/**
 * Purpose: Spanish labels and formatting shared by the dashboard and the outside-payments detail
 *   page (receipt status, signals, per-currency amounts).
 * Runs in: anywhere (pure constants and functions).
 * Triggered by: /platform and /platform/outside-payments.
 * Receives → Returns: status / signal / { currency: minor } → display text.
 * Talks to: contracts/money#formatMinor.
 */
import { formatMinor } from "@/features/contracts/money";
import type { ReceiptSignal, ReceiptStatus } from "../metrics";

export const RECEIPT_STATUS: Record<ReceiptStatus, { label: string; variant: "destructive" | "secondary" | "default" }> = {
  unapproved: { label: "sin aprobación", variant: "destructive" },
  covered_by_authorization: { label: "cubierto por autorización", variant: "secondary" },
  approved_in_pacta: { label: "aprobado en Pacta", variant: "default" },
};

export const RECEIPT_SIGNAL: Record<ReceiptSignal, string> = {
  likely_recurring: "probable cargo recurrente",
  bank_confirmed: "confirmado en banco",
  supplier_unknown: "proveedor no reconocido",
};

// Nunca suma monedas distintas: "$1,500.00 · €20.00".
export function formatAmounts(byCurrency: Record<string, number>): string {
  const entries = Object.entries(byCurrency);
  return entries.length === 0 ? "—" : entries.map(([currency, minor]) => formatMinor(minor, currency)).join(" · ");
}
