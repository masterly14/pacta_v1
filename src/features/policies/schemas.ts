/**
 * Purpose: Zod schemas for the policies forms (supplier, policy version, authorization,
 *   approval permission, revoke), mirroring the database CHECK constraints.
 * Runs in: server (server actions) and tests.
 * Triggered by: actions.ts, which parses FormData through these before touching the database.
 * Receives → Returns: raw form values (strings) → typed inputs with amounts in minor units.
 * Talks to: ./money.ts, src/shared/schemas/invoice-context.ts (shared primitives).
 */
import { z } from "zod";
import { CalendarDateSchema, EntityIdSchema } from "@/shared/schemas/invoice-context";
import { parseUsdToMinor } from "./money";

// Un monto en USD escrito por una persona → unidades menores enteras (> 0 salvo que se permita 0).
function usdAmount(options: { allowZero: boolean }) {
  return z.string().transform((value, ctx) => {
    const minor = parseUsdToMinor(value);
    if (minor === null || (!options.allowZero && minor === 0)) {
      ctx.addIssue({ code: "custom", message: options.allowZero ? "Monto inválido" : "Monto inválido (debe ser mayor que 0)" });
      return z.NEVER;
    }
    return minor;
  });
}

// Checkbox de formulario: presente ("on") = true, ausente = false.
const checkbox = z.preprocess((value) => value === "on" || value === "true" || value === true, z.boolean());

// Campo opcional: cadena vacía → null.
function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), schema.nullable());
}

// Referencia enmascarada de cuenta (p. ej. "****1234"), nunca el número completo.
const AccountReferenceSchema = z.string().trim().min(4, "Mínimo 4 caracteres").max(64);

export const SupplierInputSchema = z.object({
  name: z.string().trim().min(1, "Nombre obligatorio").max(120),
  beneficiaryAccountRef: optional(AccountReferenceSchema),
});

export const PolicyInputSchema = z.object({
  autoApprovalLimitMinor: usdAmount({ allowZero: true }),
  monthlyBudgetMinor: usdAmount({ allowZero: true }),
});

export const AuthorizationInputSchema = z
  .object({
    supplierId: EntityIdSchema,
    beneficiaryAccountRef: AccountReferenceSchema,
    maxAmountMinor: usdAmount({ allowZero: false }),
    scope: z.enum(["one_time", "recurring"]),
    frequency: optional(z.enum(["weekly", "monthly", "quarterly", "yearly"])),
    validFrom: CalendarDateSchema,
    validUntil: CalendarDateSchema,
  })
  .superRefine((input, ctx) => {
    if (input.scope === "recurring" && input.frequency === null) {
      ctx.addIssue({ code: "custom", path: ["frequency"], message: "Una autorización recurrente requiere frecuencia" });
    }
    if (input.scope === "one_time" && input.frequency !== null) {
      ctx.addIssue({ code: "custom", path: ["frequency"], message: "Una autorización única no lleva frecuencia" });
    }
    if (input.validUntil < input.validFrom) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "La vigencia termina antes de empezar" });
    }
  });

export const PermissionInputSchema = z
  .object({
    userId: EntityIdSchema,
    canApprove: checkbox,
    approvalLimitMinor: optional(usdAmount({ allowZero: false })),
    canManagePolicies: checkbox,
  })
  .superRefine((input, ctx) => {
    if (input.canApprove && input.approvalLimitMinor === null) {
      ctx.addIssue({ code: "custom", path: ["approvalLimitMinor"], message: "Un aprobador necesita un límite explícito" });
    }
  })
  // Sin permiso de aprobación no se guarda límite (lo exige el CHECK de la tabla).
  .transform((input) => (input.canApprove ? input : { ...input, approvalLimitMinor: null }));

export const RevokeInputSchema = z.object({ authorizationId: EntityIdSchema });

export type SupplierInput = z.infer<typeof SupplierInputSchema>;
export type PolicyInput = z.infer<typeof PolicyInputSchema>;
export type AuthorizationInput = z.infer<typeof AuthorizationInputSchema>;
export type PermissionInput = z.infer<typeof PermissionInputSchema>;
