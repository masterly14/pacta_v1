/**
 * Purpose: pure authorization checks for the policies feature (who may change what).
 * Runs in: server and tests (pure, no I/O).
 * Triggered by: server.ts before every mutation, and the policies page to hide forms.
 * Receives → Returns: (PolicyActor, …) → null when allowed, or a human-readable reason.
 * Talks to: nothing.
 */

// Actor de una acción: identidad y rol vienen de Clerk (espejo en organization_memberships);
// los permisos de pago, de approval_permissions. Sin fila de permisos = sin permisos.
export type PolicyActor = {
  userId: string;
  organizationId: string;
  role: "admin" | "member";
  permission: {
    canApprove: boolean;
    approvalLimitMinor: number | null;
    canManagePolicies: boolean;
  } | null;
};

export type Denial = string | null;

export function checkCanManagePolicies(actor: PolicyActor): Denial {
  return actor.permission?.canManagePolicies === true
    ? null
    : "Necesitas el permiso de gestionar políticas.";
}

// Solo un admin de la organización (rol de Clerk) otorga o quita permisos de pago.
export function checkCanGrantPermissions(actor: PolicyActor): Denial {
  return actor.role === "admin" ? null : "Solo un administrador de la organización puede cambiar permisos.";
}

// Autorizar pagos futuros es poder de aprobación: nadie autoriza más de lo que podría aprobar.
export function checkCanAuthorize(actor: PolicyActor, maxAmountMinor: number): Denial {
  const manage = checkCanManagePolicies(actor);
  if (manage !== null) {
    return manage;
  }
  const permission = actor.permission;
  if (permission === null || !permission.canApprove || permission.approvalLimitMinor === null) {
    return "Necesitas permiso de aprobación para crear autorizaciones.";
  }
  if (maxAmountMinor > permission.approvalLimitMinor) {
    return "El monto máximo supera tu límite de aprobación.";
  }
  return null;
}

export function checkCanLoadDemoData(actor: PolicyActor): Denial {
  return checkCanGrantPermissions(actor);
}
