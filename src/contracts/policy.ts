import { z } from "zod";

// Reglas de negocio de la empresa que el agente debe respetar.
export const PolicySchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  rules: z.object({
    maxAutoPayAmount: z.number().nonnegative(), // monto máximo para pagar sin revisión
    allowedCurrencies: z.array(z.string().length(3)).min(1),
    trustedSuppliers: z.array(z.string().min(1)),
    bankAccountAllowlist: z.array(z.string().min(1)),
    minFieldConfidence: z.number().min(0).max(1), // por debajo, se escala
  }),
});

export type Policy = z.infer<typeof PolicySchema>;
