import { z } from "zod";

export const DecisionActionSchema = z.enum(["PAY", "HOLD", "ESCALATE"]);

// Justificación estructurada de la decisión, para auditoría.
export const RationaleSchema = z.object({
  factors: z.array(z.string()), // factores considerados
  citedRules: z.array(z.string()), // ids de reglas de la política citadas
  citedDocuments: z.array(z.string()), // ids de documentos citados (factura, correo, mensaje)
  uncertainty: z.object({
    level: z.enum(["low", "medium", "high"]),
    notes: z.array(z.string()), // qué no está claro
  }),
});

export const DecisionSchema = z.object({
  invoiceNumber: z.string().min(1),
  action: DecisionActionSchema,
  rationale: RationaleSchema,
});

export type DecisionAction = z.infer<typeof DecisionActionSchema>;
export type Rationale = z.infer<typeof RationaleSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
