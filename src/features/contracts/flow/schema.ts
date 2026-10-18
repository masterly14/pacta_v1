/**
 * Purpose: contrato Zod del grafo que describe cómo se paga un contrato (nodos + aristas).
 *   Es el JSON que se guarda versionado y el que dibuja @xyflow/react. Evidencia, nunca autorización.
 * Runs in: servidor, cliente (validación en vivo) y tests; puro.
 * Triggered by: guardado/activación de una versión de flujo y el evaluador.
 * Receives → Returns: JSON no confiable → ContractFlowGraph validado (strictObject, tipos cerrados).
 * Talks to: src/shared/schemas/invoice-context.ts (primitivos de fecha, moneda, importe).
 */
import { z } from "zod";
import {
  AmountMinorSchema as BaseAmountMinorSchema,
  CalendarDateSchema,
  ContractFrequencySchema,
  CurrencyCodeSchema,
} from "@/shared/schemas/invoice-context";
import { MAX_AMOUNT_MINOR } from "../money";

// El resumen se guarda en columnas Int de Contract: el tope es el de toda la app.
const AmountMinorSchema = BaseAmountMinorSchema.max(MAX_AMOUNT_MINOR);

export const FLOW_LIMITS = { maxNodes: 50, maxEdges: 100, maxBytes: 64 * 1024 } as const;

// Márgenes de tolerancia en puntos base (100 = 1 %). Entero: sin floats en dinero.
const ToleranceBpsSchema = z.int().min(0).max(10_000).default(0);
const NodeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const LabelSchema = z.string().trim().min(1).max(80);

const PositionSchema = z.strictObject({ x: z.number().finite(), y: z.number().finite() });

const StartDataSchema = z.strictObject({
  frequency: ContractFrequencySchema,
  validFrom: CalendarDateSchema,
  validTo: CalendarDateSchema.nullable(),
});

const AmountDataSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("fixed"),
    currency: CurrencyCodeSchema,
    amountMinor: AmountMinorSchema.min(1),
    toleranceBps: ToleranceBpsSchema,
  }),
  z.strictObject({
    mode: z.literal("range"),
    currency: CurrencyCodeSchema,
    minMinor: AmountMinorSchema,
    maxMinor: AmountMinorSchema.min(1),
  }),
  z.strictObject({
    mode: z.literal("cap"),
    currency: CurrencyCodeSchema,
    maxMinor: AmountMinorSchema.min(1),
  }),
]);

const BeneficiaryDataSchema = z.strictObject({ accountRef: z.string().trim().min(1).max(120) });

// Campos y operadores cerrados: no hay expresiones libres.
const ConditionDataSchema = z.discriminatedUnion("field", [
  z.strictObject({
    field: z.literal("amountMinor"),
    op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
    value: AmountMinorSchema,
  }),
  z.strictObject({
    field: z.literal("currency"),
    op: z.enum(["eq", "neq"]),
    value: CurrencyCodeSchema,
  }),
]);

const MilestoneDataSchema = z.strictObject({ label: LabelSchema, requiresEvidence: z.boolean() });
const PaymentTermsDataSchema = z.strictObject({ netDays: z.int().min(0).max(365) });
const EndDataSchema = z.strictObject({ outcome: z.enum(["expect_payment", "escalate", "block"]) });

const base = { id: NodeIdSchema, position: PositionSchema };

export const FlowNodeSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("start"), data: StartDataSchema }),
  z.strictObject({ ...base, type: z.literal("amount"), data: AmountDataSchema }),
  z.strictObject({ ...base, type: z.literal("beneficiary"), data: BeneficiaryDataSchema }),
  z.strictObject({ ...base, type: z.literal("condition"), data: ConditionDataSchema }),
  z.strictObject({ ...base, type: z.literal("milestone"), data: MilestoneDataSchema }),
  z.strictObject({ ...base, type: z.literal("paymentTerms"), data: PaymentTermsDataSchema }),
  z.strictObject({ ...base, type: z.literal("end"), data: EndDataSchema }),
]);

export const FlowEdgeSchema = z.strictObject({
  id: NodeIdSchema,
  source: NodeIdSchema,
  target: NodeIdSchema,
  sourceHandle: z.enum(["default", "true", "false"]).default("default"),
});

export const ContractFlowGraphSchema = z.strictObject({
  schemaVersion: z.literal(1),
  nodes: z.array(FlowNodeSchema).max(FLOW_LIMITS.maxNodes),
  edges: z.array(FlowEdgeSchema).max(FLOW_LIMITS.maxEdges),
});

export type FlowNode = z.infer<typeof FlowNodeSchema>;
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;
export type ContractFlowGraph = z.infer<typeof ContractFlowGraphSchema>;
export type FlowNodeType = FlowNode["type"];
