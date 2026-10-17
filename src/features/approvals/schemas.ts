/**
 * Purpose: Zod schema for resolving an approval request (approve or reject, optional comment
 *   and optional recurring authorization for future invoices).
 * Runs in: server (server actions) and tests.
 * Triggered by: actions.ts before calling server.ts#resolveApprovalRequest.
 * Receives → Returns: raw form values (strings) → ResolveApprovalInput with amounts in minor units.
 * Talks to: policies/money.ts#parseUsdToMinor, src/shared/schemas/invoice-context.ts (primitives).
 */
import { z } from "zod";
import { parseUsdToMinor } from "@/features/policies/money";
import { CalendarDateSchema, EntityIdSchema } from "@/shared/schemas/invoice-context";

// Vacío o ausente → null. Los campos de autorización no se envían si la casilla está desmarcada.
const blankToNull = (v: unknown) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v);

export const ResolveApprovalInputSchema = z
  .object({
    approvalRequestId: EntityIdSchema,
    action: z.enum(["approve", "reject"]),
    comment: z.preprocess(blankToNull, z.string().trim().max(1000).nullable()),
    authorize: z.preprocess((v) => v === "on" || v === true, z.boolean()),
    authAccount: z.preprocess(blankToNull, z.string().trim().min(4).max(64).nullable()),
    authMaxAmount: z.preprocess(blankToNull, z.string().nullable()),
    authFrequency: z.preprocess(blankToNull, z.enum(["weekly", "monthly", "quarterly", "yearly"]).nullable()),
    authValidFrom: z.preprocess(blankToNull, CalendarDateSchema.nullable()),
    authValidUntil: z.preprocess(blankToNull, CalendarDateSchema.nullable()),
  })
  .transform((input, ctx) => {
    // La autorización recurrente solo se crea al aprobar y con todos sus datos explícitos.
    if (input.action !== "approve" || !input.authorize) {
      return { approvalRequestId: input.approvalRequestId, action: input.action, comment: input.comment, authorization: null };
    }
    const maxAmountMinor = input.authMaxAmount === null ? null : parseUsdToMinor(input.authMaxAmount);
    if (input.authAccount === null || maxAmountMinor === null || maxAmountMinor === 0 || input.authFrequency === null || input.authValidFrom === null || input.authValidUntil === null) {
      ctx.addIssue({ code: "custom", message: "Para autorizar facturas futuras completa cuenta, monto máximo (> 0), frecuencia y vigencia." });
      return z.NEVER;
    }
    if (input.authValidUntil < input.authValidFrom) {
      ctx.addIssue({ code: "custom", message: "La vigencia de la autorización termina antes de empezar." });
      return z.NEVER;
    }
    return {
      approvalRequestId: input.approvalRequestId,
      action: input.action,
      comment: input.comment,
      authorization: {
        beneficiaryAccountRef: input.authAccount,
        maxAmountMinor,
        frequency: input.authFrequency,
        validFrom: input.authValidFrom,
        validUntil: input.authValidUntil,
      },
    };
  });

export type ResolveApprovalInput = z.infer<typeof ResolveApprovalInputSchema>;
