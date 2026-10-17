import { z } from "zod";
import { MAX_CELL_LENGTH } from "./csv-fields.ts";
import {
  AmountMinorSchema,
  CalendarDateSchema,
  CurrencyCodeSchema,
  DirectionSchema,
  EntityIdSchema,
  RowNumberSchema,
  Sha256Schema,
  UtcInstantSchema,
} from "./primitives.ts";

// Movimiento bancario importado. Es historial, NO autorización: un proveedor visto aquí no queda autorizado.

export const FingerprintSchema = Sha256Schema;

// `suggested`/`confirmed` solo describen el vínculo con un proveedor del catálogo; no conceden permiso de pago.
export const SupplierLinkStatusSchema = z.enum(["unlinked", "suggested", "confirmed"]);
export type SupplierLinkStatus = z.infer<typeof SupplierLinkStatusSchema>;

export const BankTransactionSchema = z
  .strictObject({
    id: EntityIdSchema,
    organizationId: EntityIdSchema,
    batchId: EntityIdSchema,
    rowNumber: RowNumberSchema,

    postedOn: CalendarDateSchema,
    direction: DirectionSchema,
    amountMinor: AmountMinorSchema, // entero seguro; en BD es BigInt y se convierte comprobando el rango
    currency: CurrencyCodeSchema,

    descriptionRaw: z.string().max(MAX_CELL_LENGTH).nullable(),
    counterpartyRaw: z.string().max(MAX_CELL_LENGTH).nullable(),
    counterpartyNormalized: z.string().max(MAX_CELL_LENGTH).nullable(),
    externalRef: z.string().trim().min(1).max(200).nullable(),

    fingerprint: FingerprintSchema,

    supplierId: EntityIdSchema.nullable(),
    supplierLinkStatus: SupplierLinkStatusSchema,

    createdAt: UtcInstantSchema,
  })
  .superRefine((transaction, ctx) => {
    if (transaction.supplierLinkStatus === "unlinked" && transaction.supplierId !== null) {
      ctx.addIssue({ code: "custom", path: ["supplierId"], message: "Con vínculo 'unlinked' supplierId debe ser null" });
    }
    if (transaction.supplierLinkStatus !== "unlinked" && transaction.supplierId === null) {
      ctx.addIssue({ code: "custom", path: ["supplierId"], message: `Con vínculo '${transaction.supplierLinkStatus}' supplierId es obligatorio` });
    }
  });
export type BankTransaction = z.infer<typeof BankTransactionSchema>;
