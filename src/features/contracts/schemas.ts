/**
 * Purpose: Zod schemas for the contract forms and POST /api/contracts (register, terminate),
 *   mirroring the contracts_terms_check database constraint.
 * Runs in: server (server actions, route handler) and tests.
 * Triggered by: actions.ts and src/app/api/contracts/route.ts before touching the database.
 * Receives → Returns: raw values (strings) → typed inputs with the amount in minor units.
 * Talks to: ./money.ts, src/shared/schemas/invoice-context.ts (shared primitives).
 */
import { z } from "zod";
import {
  CalendarDateSchema,
  ContractFrequencySchema,
  CurrencyCodeSchema,
  EntityIdSchema,
} from "@/shared/schemas/invoice-context";
import { parseAmountToMinor } from "./money";

// Campo opcional: cadena vacía → null.
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), schema.nullable());
}

// Referencia enmascarada de cuenta (p. ej. "****1234"), nunca el número completo.
const AccountReferenceSchema = z.string().trim().min(4, "Cuenta: mínimo 4 caracteres").max(64);

export const ContractInputSchema = z
  .object({
    supplierId: EntityIdSchema,
    agreedAmount: z.string(),
    currency: z.preprocess(
      (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
      CurrencyCodeSchema,
    ),
    frequency: ContractFrequencySchema,
    validFrom: CalendarDateSchema,
    validTo: optional(CalendarDateSchema),
    beneficiaryAccountRef: optional(AccountReferenceSchema),
    description: optional(z.string().trim().max(500, "Descripción: máximo 500 caracteres")),
  })
  .transform((input, ctx) => {
    // La escala depende de la moneda, así que el monto se convierte después de validarla.
    const amount = parseAmountToMinor(input.agreedAmount, input.currency);
    if (!amount.ok || amount.amountMinor === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["agreedAmount"],
        message: amount.ok ? "Monto inválido (debe ser mayor que 0)" : `Monto inválido: ${amount.error}`,
      });
      return z.NEVER;
    }
    if (input.validTo !== null && input.validTo < input.validFrom) {
      ctx.addIssue({ code: "custom", path: ["validTo"], message: "La vigencia termina antes de empezar" });
      return z.NEVER;
    }
    return {
      supplierId: input.supplierId,
      agreedAmountMinor: amount.amountMinor,
      currency: input.currency,
      frequency: input.frequency,
      validFrom: input.validFrom,
      validTo: input.validTo,
      beneficiaryAccountRef: input.beneficiaryAccountRef,
      description: input.description,
    };
  });

export const TerminateContractInputSchema = z.object({ contractId: EntityIdSchema });

export type ContractInput = z.infer<typeof ContractInputSchema>;
