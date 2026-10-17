/**
 * Purpose: Zod contract for the facts the engine needs about an organization (policy,
 *   authorizations, prior decisions, budget used, recurrence hint, clock and decision ID).
 * Runs in: server and tests (pure, no I/O).
 * Triggered by: imported by decide() to validate its second argument.
 * Receives → Returns: nothing at runtime; exports EngineFactsSchema and inferred types.
 * Talks to: src/shared/schemas/invoice-context.ts, src/shared/schemas/payment-decision.ts.
 */
import { z } from "zod";
import {
  AmountMinorSchema,
  CalendarDateSchema,
  CurrencyCodeSchema,
  EntityIdSchema,
  UtcInstantSchema,
} from "@/shared/schemas/invoice-context";
import { DecisionOutcomeSchema } from "@/shared/schemas/payment-decision";

// Hechos que B conoce sobre la organización. Los carga `evaluateInvoice()` desde la BD;
// `decide()` los recibe como datos planos para ser pura y testeable.

export const EnginePolicySchema = z.strictObject({
  policyId: EntityIdSchema,
  version: z.int().positive(),
  autoApprovalLimitMinor: AmountMinorSchema,
  monthlyBudgetMinor: AmountMinorSchema,
  currency: CurrencyCodeSchema,
});

export const EngineAuthorizationSchema = z.strictObject({
  authorizationId: EntityIdSchema,
  supplierId: EntityIdSchema,
  beneficiaryAccountRef: z.string().min(1),
  currency: CurrencyCodeSchema,
  maxAmountMinor: AmountMinorSchema,
  scope: z.enum(["one_time", "recurring"]),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]).nullable(),
  validFrom: CalendarDateSchema,
  validUntil: CalendarDateSchema,
  status: z.enum(["active", "revoked", "consumed"]),
});

// Decisión previa de otra factura (o de la misma, en una reevaluación).
export const EnginePriorDecisionSchema = z.strictObject({
  decisionId: EntityIdSchema,
  invoiceId: EntityIdSchema,
  supplierId: EntityIdSchema.nullable(),
  invoiceNumber: z.string().min(1).nullable(),
  amountMinor: AmountMinorSchema.nullable(),
  invoiceDate: CalendarDateSchema.nullable(),
  decision: DecisionOutcomeSchema,
});

export const EngineFactsSchema = z.strictObject({
  policy: EnginePolicySchema.nullable(), // null = la política no pudo cargarse
  authorizations: z.array(EngineAuthorizationSchema),
  priorDecisions: z.array(EnginePriorDecisionSchema),
  // Otras facturas con el mismo sha256 de archivo y decisión no `blocked` (lo resuelve el loader).
  documentDuplicateInvoiceIds: z.array(EntityIdSchema),
  budgetUsedMinor: AmountMinorSchema.nullable(), // aprobado en el mes UTC; null = no calculable
  recurrenceSuggested: z.boolean(), // sugerencia del CSV; nunca autoriza
  now: UtcInstantSchema,
  decisionId: EntityIdSchema,
  traceId: z.string().min(1).nullable(),
});

export type EnginePolicy = z.infer<typeof EnginePolicySchema>;
export type EngineAuthorization = z.infer<typeof EngineAuthorizationSchema>;
export type EnginePriorDecision = z.infer<typeof EnginePriorDecisionSchema>;
export type EngineFacts = z.infer<typeof EngineFactsSchema>;
