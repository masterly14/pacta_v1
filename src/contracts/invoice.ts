import { z } from "zod";

// Confianza del extractor por campo, en el rango 0 a 1.
export const FieldConfidenceSchema = z.object({
  supplier: z.number().min(0).max(1),
  invoiceNumber: z.number().min(0).max(1),
  amount: z.number().min(0).max(1),
  currency: z.number().min(0).max(1),
  dueDate: z.number().min(0).max(1),
  bankAccount: z.number().min(0).max(1),
});

export const InvoiceSchema = z.object({
  supplier: z.string().min(1), // proveedor
  invoiceNumber: z.string().min(1), // número de factura
  amount: z.number().nonnegative(), // monto
  currency: z.string().length(3), // código ISO 4217, p. ej. "USD"
  dueDate: z.iso.date(), // fecha de vencimiento (YYYY-MM-DD)
  bankAccount: z.string().min(1), // cuenta bancaria destino
  fieldConfidence: FieldConfidenceSchema, // confianza por campo
});

export type FieldConfidence = z.infer<typeof FieldConfidenceSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
