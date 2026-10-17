/**
 * Purpose: pure authorization check for the contracts feature (who may register or
 *   terminate contracts).
 * Runs in: server and tests (pure, no I/O).
 * Triggered by: server.ts before every mutation, and the contracts page to hide forms.
 * Receives → Returns: ContractActor → null when allowed, or a human-readable reason.
 * Talks to: nothing.
 */

// Identidad y rol vienen de Clerk (espejo en organization_memberships).
export type ContractActor = {
  userId: string;
  organizationId: string;
  role: "admin" | "member";
};

export type Denial = string | null;

// Un contrato no autoriza pagos, pero cambia cómo se comparan las facturas: solo admins.
export function checkCanManageContracts(actor: ContractActor): Denial {
  return actor.role === "admin" ? null : "Solo un administrador de la organización puede registrar o terminar contratos.";
}
