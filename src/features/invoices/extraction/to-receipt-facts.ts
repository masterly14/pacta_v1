/**
 * Purpose: decide deterministically whether an extraction describes a payment ALREADY made
 *   (a receipt, e.g. an automatic card charge) and keep its facts: paid date and masked method.
 *   Safety: a receipt is never evaluated for payment, so this can only prevent a payment, never
 *   cause one. Without verifiable evidence, or with suspected injection, it stays an invoice.
 * Runs in: server and tests (pure, no I/O).
 * Triggered by: extractInvoice() after the LLM call.
 * Receives → Returns: (RawExtraction, transcripts) → ReceiptFacts | null.
 * Talks to: to-invoice-context.ts (excerpt lookup, account masking).
 */
import { CalendarDateSchema } from "@/shared/schemas/invoice-context";
import type { RawExtraction } from "./raw-extraction.schema";
import { locateExcerpt, redactAccountNumbers, type DocumentTranscript } from "./to-invoice-context";

export type ReceiptFacts = {
  // Fecha de calendario (YYYY-MM-DD) del pago, si el documento la indica.
  paidOn: string | null;
  // Texto tal como aparece, con números largos enmascarados.
  paymentMethod: string | null;
};

// Un fragmento de 1-3 letras ("paid") aparecería en casi cualquier documento.
const MIN_CONFIRMATION_LENGTH = 4;

export function toReceiptFacts(raw: RawExtraction, transcripts: DocumentTranscript[]): ReceiptFacts | null {
  if (raw.documentKind !== "receipt" || raw.injectionSuspected) return null;
  const excerpt = raw.paymentConfirmation.excerpt?.trim() ?? "";
  if (excerpt.length < MIN_CONFIRMATION_LENGTH || locateExcerpt(excerpt, transcripts) === null) return null;

  const paidDate = raw.paidDate.value?.trim() ?? "";
  const parsedDate = CalendarDateSchema.safeParse(paidDate);

  const method = raw.paymentMethod.value?.trim() ?? "";
  const paymentMethod = method === ""
    ? null
    // Un número de tarjeta completo (13-19 dígitos) queda como ****1234.
    : redactAccountNumbers(method).slice(0, 100);

  return { paidOn: parsedDate.success ? parsedDate.data : null, paymentMethod };
}
