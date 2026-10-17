/**
 * Purpose: turn a test invoice typed by a person into a valid InvoiceContext, so any
 *   combination of supplier, amount, currency, account, number and date can be evaluated.
 * Runs in: server (Node).
 * Triggered by: ../actions.ts#evaluateCustomInvoiceAction (simulator "Factura de prueba" form).
 * Receives → Returns: (raw form values, organizationId, now) → InvoiceContext | an error message.
 * Talks to: db (Supplier read only), contracts/server.ts#findContractMatch,
 *   contracts/money.ts#parseAmountToMinor.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { parseAmountToMinor, SUPPORTED_CURRENCIES } from "@/features/contracts/money";
import { findContractMatch } from "@/features/contracts/server";
import { CalendarDateSchema, InvoiceContextSchema, type InvoiceContext } from "@/shared/schemas/invoice-context";

// Campo opcional: cadena vacía → null.
const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullable());

export const CustomInvoiceInputSchema = z.object({
  supplierId: optionalText(200), // vacío = proveedor no reconocido
  invoiceNumber: optionalText(100),
  amount: optionalText(30),
  currency: z.enum(SUPPORTED_CURRENCIES as [string, ...string[]], { message: "Moneda no soportada" }),
  beneficiaryAccountReference: optionalText(64),
  invoiceDate: z.preprocess((v) => (v === "" ? null : v), CalendarDateSchema.nullable()),
  description: optionalText(500),
  withWarning: z.preprocess((v) => v === "on", z.boolean()),
});

export type CustomInvoiceInput = z.infer<typeof CustomInvoiceInputSchema>;

export async function buildCustomInvoice(
  input: CustomInvoiceInput,
  organizationId: string,
  now: Date,
): Promise<{ ok: true; invoice: InvoiceContext } | { ok: false; error: string }> {
  // El proveedor llega del formulario: debe pertenecer a la organización.
  const supplier =
    input.supplierId === null
      ? null
      : await db.supplier.findFirst({ where: { id: input.supplierId, organizationId }, select: { id: true, name: true } });
  if (input.supplierId !== null && supplier === null) return { ok: false, error: "Proveedor no encontrado." };

  let amountMinor: number | null = null;
  if (input.amount !== null) {
    const parsed = parseAmountToMinor(input.amount, input.currency);
    if (!parsed.ok) return { ok: false, error: `Monto inválido: ${parsed.error}` };
    amountMinor = parsed.amountMinor;
  }

  // Igual que hará el pipeline real: el contrato se compara antes de evaluar.
  const contractMatch = await findContractMatch(organizationId, {
    supplierId: supplier?.id ?? null,
    amountMinor,
    currency: input.currency,
    invoiceDate: input.invoiceDate,
    beneficiaryAccountReference: input.beneficiaryAccountReference,
  });

  // `missingFields` debe listar exactamente los campos null (lo exige InvoiceContextSchema).
  const fields = {
    invoiceNumber: input.invoiceNumber,
    name: supplier?.name ?? null,
    email: null, // carga de prueba: no viene de un correo
    subject: null,
    body: null,
    beneficiaryAccountReference: input.beneficiaryAccountReference,
    amountMinor,
    currency: input.currency,
    description: input.description,
    invoiceDate: input.invoiceDate,
    dueDate: null,
  };
  const missingFields = (Object.keys(fields) as (keyof typeof fields)[]).filter((k) => fields[k] === null);

  const invoice = InvoiceContextSchema.parse({
    schemaVersion: 1,
    invoiceId: `test_${randomUUID()}`,
    organizationId,
    source: "dashboard",
    sourceAccountId: null,
    sourceMessageId: null,
    documentId: null,
    documentType: "manual_entry",
    receivedAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    supplierId: supplier?.id ?? null,
    supplierMatchStatus: supplier === null ? "not_found" : "matched",
    ...fields,
    contractMatch,
    missingFields,
    extractionWarnings: input.withWarning
      ? [{ code: "manual_test_warning", message: "Advertencia de extracción simulada", field: null }]
      : [],
    evidence: [],
  });
  return { ok: true, invoice };
}
