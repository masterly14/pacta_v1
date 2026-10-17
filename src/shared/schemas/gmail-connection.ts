import { z } from "zod";
import { EntityIdSchema, UtcInstantSchema } from "./invoice-context.ts";

// Buzón Gmail de una organización, conectado vía Composio.
// Composio guarda los tokens; este contrato no admite secretos ni access tokens.
// El buzón no autoriza pagos.

export const GmailConnectionStatusSchema = z.enum(["pending", "active", "failed", "expired", "revoked"]);

/** Correo ya normalizado: minúsculas, sin espacios. */
export const NormalizedEmailSchema = z
  .string()
  .min(3)
  .max(320)
  .regex(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/, "El correo debe estar en minúsculas y sin espacios");

export const ComposioConnectedAccountIdSchema = z
  .string()
  .min(4)
  .max(200)
  .regex(/^ca_/, "Debe ser un connected_account_id de Composio (ca_…)");

export const ComposioAuthConfigIdSchema = z
  .string()
  .min(4)
  .max(200)
  .regex(/^ac_/, "Debe ser un auth_config_id de Composio (ac_…)");

export const ComposioTriggerIdSchema = z
  .string()
  .min(4)
  .max(200)
  .regex(/^ti_/, "Debe ser un trigger_id de Composio (ti_…)");

export const GmailMailboxAliasSchema = z.string().trim().min(1).max(80);

export const GmailConnectionSchema = z
  .strictObject({
    id: EntityIdSchema,
    organizationId: EntityIdSchema,
    connectedByUserId: EntityIdSchema,
    composioUserId: EntityIdSchema,
    composioConnectedAccountId: ComposioConnectedAccountIdSchema,
    composioAuthConfigId: ComposioAuthConfigIdSchema,
    composioTriggerId: ComposioTriggerIdSchema.nullable(),
    emailAddress: NormalizedEmailSchema.nullable(),
    alias: GmailMailboxAliasSchema.nullable(),
    status: GmailConnectionStatusSchema,
    connectedAt: UtcInstantSchema.nullable(),
    revokedAt: UtcInstantSchema.nullable(),
  })
  .superRefine((connection, ctx) => {
    if (connection.composioUserId !== connection.organizationId) {
      ctx.addIssue({
        code: "custom",
        path: ["composioUserId"],
        message: "composioUserId debe ser igual a organizationId para agrupar buzones de la org",
      });
    }
    if (connection.status === "active" && connection.emailAddress === null) {
      ctx.addIssue({
        code: "custom",
        path: ["emailAddress"],
        message: "Un buzón active requiere el correo leído del perfil de Gmail",
      });
    }
    if (connection.status === "active" && connection.connectedAt === null) {
      ctx.addIssue({
        code: "custom",
        path: ["connectedAt"],
        message: "Un buzón active requiere connectedAt",
      });
    }
    if (connection.status === "revoked" && connection.revokedAt === null) {
      ctx.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "Un buzón revoked requiere revokedAt",
      });
    }
    if (connection.status !== "revoked" && connection.revokedAt !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "revokedAt solo aplica con status 'revoked'",
      });
    }
  });

export const GmailConnectionPublicSchema = z.strictObject({
  id: EntityIdSchema,
  organizationId: EntityIdSchema,
  connectedByUserId: EntityIdSchema,
  emailAddress: NormalizedEmailSchema.nullable(),
  alias: GmailMailboxAliasSchema.nullable(),
  status: GmailConnectionStatusSchema,
  connectedAt: UtcInstantSchema.nullable(),
});

/** Body HTTP. organizationId lo fija el servidor desde la sesión. */
export const GmailConnectRequestBodySchema = z.strictObject({
  alias: GmailMailboxAliasSchema.nullable(),
});

/** Lo construye el servidor; el cliente no elige organizationId. */
export const GmailConnectCommandSchema = z.strictObject({
  organizationId: EntityIdSchema,
  userId: EntityIdSchema,
  alias: GmailMailboxAliasSchema.nullable(),
});

export const GmailConnectLinkSchema = z.strictObject({
  connectionId: EntityIdSchema,
  redirectUrl: z.url({ protocol: /^https$/ }),
  status: z.literal("pending"),
});

export function toGmailConnectionPublic(
  connection: z.infer<typeof GmailConnectionSchema>,
): z.infer<typeof GmailConnectionPublicSchema> {
  return {
    id: connection.id,
    organizationId: connection.organizationId,
    connectedByUserId: connection.connectedByUserId,
    emailAddress: connection.emailAddress,
    alias: connection.alias,
    status: connection.status,
    connectedAt: connection.connectedAt,
  };
}

export function gmailConnectionStatusFromComposio(status: string): z.infer<typeof GmailConnectionStatusSchema> | null {
  switch (status) {
    case "INITIALIZING":
    case "INITIATED":
      return "pending";
    case "ACTIVE":
      return "active";
    case "FAILED":
      return "failed";
    case "EXPIRED":
      return "expired";
    default:
      return null;
  }
}

export type GmailConnectionStatus = z.infer<typeof GmailConnectionStatusSchema>;
export type GmailConnection = z.infer<typeof GmailConnectionSchema>;
export type GmailConnectionPublic = z.infer<typeof GmailConnectionPublicSchema>;
export type GmailConnectRequestBody = z.infer<typeof GmailConnectRequestBodySchema>;
export type GmailConnectCommand = z.infer<typeof GmailConnectCommandSchema>;
export type GmailConnectLink = z.infer<typeof GmailConnectLinkSchema>;
