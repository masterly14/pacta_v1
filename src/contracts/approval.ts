import { z } from "zod";
import { DecisionActionSchema } from "./decision";

// Resolución humana de una factura escalada.
export const ApprovalSchema = z.object({
  invoiceNumber: z.string().min(1),
  approverId: z.string().min(1), // usuario de Clerk que decide
  outcome: DecisionActionSchema, // PAY, HOLD o ESCALATE (no resuelto)
  comment: z.string().max(2000).optional(),
  channel: z.enum(["dashboard", "slack", "whatsapp", "email"]),
  decidedAt: z.iso.datetime(),
});

export type Approval = z.infer<typeof ApprovalSchema>;
