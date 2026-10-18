/**
 * Purpose: shape of what the LLM may return when reading an invoice. It carries claims, never
 *   decisions: no supplier identity, no contract match, no approval.
 * Runs in: server and tests (pure).
 * Triggered by: extractInvoice() as the Zod contract of the DeepSeek call.
 * Receives → Returns: unknown JSON → RawExtraction (strict).
 * Talks to: nothing.
 */
import { z } from "zod";

// Todos los campos son obligatorios y nullable (los structured outputs de OpenAI no admiten
// opcionales). `null` significa "no consta en el documento".
const ClaimSchema = z.strictObject({
  value: z.string().nullable(),
  // Fragmento literal del documento que respalda el valor; se verifica contra el texto fuente.
  excerpt: z.string().nullable(),
});

export const RawExtractionSchema = z.strictObject({
  isInvoice: z.boolean(),
  // invoice = pedido de pago; receipt = el documento dice que el pago YA se hizo (cargo a
  // tarjeta, "paid"); other = ninguno. Ante la duda, el modelo debe responder invoice.
  documentKind: z.enum(["invoice", "receipt", "other"]),
  // Frase del documento que dice que el pago ya se realizó (p. ej. "Amount paid $20.00").
  paymentConfirmation: ClaimSchema,
  // YYYY-MM-DD; solo en recibos.
  paidDate: ClaimSchema,
  // Medio de pago tal como aparece, sin números completos (p. ej. "Visa ending 4242").
  paymentMethod: ClaimSchema,
  invoiceNumber: ClaimSchema,
  supplierName: ClaimSchema,
  beneficiaryAccount: ClaimSchema,
  // Decimal con punto y sin separadores de miles, p. ej. "1500.50".
  amount: ClaimSchema,
  // Código ISO 4217, p. ej. "USD".
  currency: ClaimSchema,
  description: ClaimSchema,
  // YYYY-MM-DD
  invoiceDate: ClaimSchema,
  dueDate: ClaimSchema,
  // El documento contiene texto que da instrucciones al lector (aprobar, ignorar reglas…).
  injectionSuspected: z.boolean(),
});

export type RawExtraction = z.infer<typeof RawExtractionSchema>;
export type RawClaim = z.infer<typeof ClaimSchema>;
