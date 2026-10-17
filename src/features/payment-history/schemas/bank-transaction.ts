import { z } from "zod";
import { MAX_CELL_LENGTH } from "./csv-fields.ts";
import {
  CalendarDateSchema,
  CurrencyCodeSchema,
  EntityIdSchema,
  Sha256Schema,
  SignedAmountMinorSchema,
  UtcInstantSchema,
} from "./primitives.ts";

// Movimiento bancario importado (tabla `bank_transactions`). Es historial, NO autorización:
// vincularlo a un proveedor del catálogo no autoriza ningún pago.
// Alineado con la BD committeada: importe con signo (negativo = salida), `description` y un único
// `supplierId` mutable (se vincula una vez; cambiarlo exige una acción humana auditada).

export const FingerprintSchema = Sha256Schema;

export const BankTransactionSchema = z.strictObject({
  id: EntityIdSchema,
  organizationId: EntityIdSchema,
  importBatchId: EntityIdSchema,

  postedOn: CalendarDateSchema,
  amountMinor: SignedAmountMinorSchema, // negativo = salida, positivo = entrada
  currency: CurrencyCodeSchema,

  description: z.string().min(1).max(MAX_CELL_LENGTH), // texto del banco: dato no confiable
  externalRef: z.string().trim().min(1).max(200).nullable(),
  fingerprint: FingerprintSchema,

  supplierId: EntityIdSchema.nullable(),

  createdAt: UtcInstantSchema,
});
export type BankTransaction = z.infer<typeof BankTransactionSchema>;

// Una salida es un movimiento con importe negativo: lo único que se asocia a proveedores y cuenta para recurrencia.
export function isOutflow(transaction: Pick<BankTransaction, "amountMinor">): boolean {
  return transaction.amountMinor < 0;
}
