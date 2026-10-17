/**
 * Purpose: persist and read suppliers, versioned payment policies, explicit authorizations
 *   and approval permissions, always scoped by organizationId and audited.
 * Runs in: server (Node).
 * Triggered by: actions.ts (mutations) and the /platform/policies page (reads).
 * Receives → Returns: (PolicyActor, validated input) → PolicyResult; organizationId → overview.
 * Talks to: db (src/lib/db.ts) — Supplier, PaymentPolicy, PaymentAuthorization,
 *   ApprovalPermission, OrganizationMembership, AuditEvent; ./permissions.ts, ./normalize.ts.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Workspace } from "@/shared/auth/ensure-workspace";
import { normalizeSupplierName } from "./normalize";
import {
  checkCanAuthorize,
  checkCanGrantPermissions,
  checkCanLoadDemoData,
  checkCanManagePolicies,
  type PolicyActor,
} from "./permissions";
import type { AuthorizationInput, PermissionInput, PolicyInput, SupplierInput } from "./schemas";

export type PolicyResult = { ok: true; message: string } | { ok: false; error: string };

const P0_CURRENCY = "USD";

type Tx = Prisma.TransactionClient;

function denied(error: string): PolicyResult {
  return { ok: false, error };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

// Fechas de calendario (@db.Date) se guardan como medianoche UTC.
function toDbDate(calendarDate: string): Date {
  return new Date(`${calendarDate}T00:00:00.000Z`);
}

function fromDbDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function audit(tx: Tx, actor: PolicyActor, entityType: string, entityId: string, eventType: string, payload: Prisma.InputJsonValue) {
  return tx.auditEvent.create({
    data: { organizationId: actor.organizationId, entityType, entityId, eventType, actorId: actor.userId, payload },
  });
}

// ---------------------------------------------------------------------------
// Actor
// ---------------------------------------------------------------------------

export async function loadPolicyActor(workspace: Workspace): Promise<PolicyActor> {
  const permission = await db.approvalPermission.findUnique({
    where: { userId_organizationId: { userId: workspace.user.id, organizationId: workspace.organization.id } },
  });
  return {
    userId: workspace.user.id,
    organizationId: workspace.organization.id,
    role: workspace.membership.role,
    permission:
      permission === null
        ? null
        : {
            canApprove: permission.canApprove,
            approvalLimitMinor: permission.approvalLimitMinor,
            canManagePolicies: permission.canManagePolicies,
          },
  };
}

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

export async function getPoliciesOverview(organizationId: string) {
  const [policies, suppliers, authorizations, members] = await Promise.all([
    db.paymentPolicy.findMany({ where: { organizationId }, orderBy: { version: "desc" }, take: 5 }),
    db.supplier.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
    db.paymentAuthorization.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: { supplier: { select: { name: true } } },
    }),
    db.organizationMembership.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { email: true, displayName: true } }, approvalPermission: true },
    }),
  ]);

  return {
    currentPolicy: policies[0] ?? null,
    policyHistory: policies,
    suppliers,
    authorizations: authorizations.map((auth) => ({
      ...auth,
      supplierName: auth.supplier.name,
      validFrom: fromDbDate(auth.validFrom),
      validUntil: fromDbDate(auth.validUntil),
    })),
    members: members.map((member) => ({
      userId: member.userId,
      role: member.role,
      email: member.user.email,
      displayName: member.user.displayName,
      permission: member.approvalPermission,
    })),
  };
}

export type PoliciesOverview = Awaited<ReturnType<typeof getPoliciesOverview>>;

// ---------------------------------------------------------------------------
// Mutaciones (cada una con su evento de auditoría en la misma transacción)
// ---------------------------------------------------------------------------

export async function createSupplier(actor: PolicyActor, input: SupplierInput): Promise<PolicyResult> {
  const denial = checkCanManagePolicies(actor);
  if (denial !== null) return denied(denial);

  const normalizedName = normalizeSupplierName(input.name);
  if (normalizedName === "") return denied("El nombre no contiene letras ni números.");

  try {
    await db.$transaction(async (tx) => {
      const supplier = await tx.supplier.create({
        data: {
          organizationId: actor.organizationId,
          name: input.name,
          normalizedName,
          beneficiaryAccountRef: input.beneficiaryAccountRef,
        },
      });
      await audit(tx, actor, "supplier", supplier.id, "supplier.created", { name: input.name, normalizedName });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return denied("Ya existe un proveedor con ese nombre.");
    throw error;
  }
  return { ok: true, message: `Proveedor ${input.name} creado.` };
}

// Nunca edita una política: crea la versión siguiente, vigente desde ahora.
export async function createPolicyVersion(actor: PolicyActor, input: PolicyInput): Promise<PolicyResult> {
  const denial = checkCanManagePolicies(actor);
  if (denial !== null) return denied(denial);

  try {
    const version = await db.$transaction(async (tx) => {
      const latest = await tx.paymentPolicy.findFirst({
        where: { organizationId: actor.organizationId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const policy = await tx.paymentPolicy.create({
        data: {
          organizationId: actor.organizationId,
          version: (latest?.version ?? 0) + 1,
          autoApprovalLimitMinor: input.autoApprovalLimitMinor,
          monthlyBudgetMinor: input.monthlyBudgetMinor,
          currency: P0_CURRENCY,
          effectiveFrom: new Date(),
          createdBy: actor.userId,
        },
      });
      await audit(tx, actor, "payment_policy", policy.id, "payment_policy.version_created", {
        version: policy.version,
        autoApprovalLimitMinor: input.autoApprovalLimitMinor,
        monthlyBudgetMinor: input.monthlyBudgetMinor,
        currency: P0_CURRENCY,
      });
      return policy.version;
    });
    return { ok: true, message: `Política versión ${version} vigente.` };
  } catch (error) {
    // Dos versiones simultáneas chocan en (organization_id, version): no se pisa ninguna.
    if (isUniqueViolation(error)) return denied("Otra persona creó una versión al mismo tiempo. Recarga e intenta de nuevo.");
    throw error;
  }
}

export async function createAuthorization(actor: PolicyActor, input: AuthorizationInput): Promise<PolicyResult> {
  const denial = checkCanAuthorize(actor, input.maxAmountMinor);
  if (denial !== null) return denied(denial);

  // El proveedor llega del formulario: debe pertenecer a la organización del actor.
  const supplier = await db.supplier.findFirst({
    where: { id: input.supplierId, organizationId: actor.organizationId },
    select: { id: true, name: true },
  });
  if (supplier === null) return denied("Proveedor no encontrado.");

  await db.$transaction(async (tx) => {
    const authorization = await tx.paymentAuthorization.create({
      data: {
        organizationId: actor.organizationId,
        supplierId: supplier.id,
        beneficiaryAccountRef: input.beneficiaryAccountRef,
        currency: P0_CURRENCY,
        maxAmountMinor: input.maxAmountMinor,
        scope: input.scope,
        frequency: input.frequency,
        validFrom: toDbDate(input.validFrom),
        validUntil: toDbDate(input.validUntil),
        authorizedBy: actor.userId,
      },
    });
    await audit(tx, actor, "payment_authorization", authorization.id, "payment_authorization.created", {
      supplierId: supplier.id,
      beneficiaryAccountRef: input.beneficiaryAccountRef,
      maxAmountMinor: input.maxAmountMinor,
      currency: P0_CURRENCY,
      scope: input.scope,
      frequency: input.frequency,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
    });
  });
  return { ok: true, message: `Autorización creada para ${supplier.name}.` };
}

export async function revokeAuthorization(actor: PolicyActor, authorizationId: string): Promise<PolicyResult> {
  const denial = checkCanManagePolicies(actor);
  if (denial !== null) return denied(denial);

  const revoked = await db.$transaction(async (tx) => {
    const result = await tx.paymentAuthorization.updateMany({
      where: { id: authorizationId, organizationId: actor.organizationId, status: "active" },
      data: { status: "revoked", revokedAt: new Date(), revokedBy: actor.userId },
    });
    if (result.count === 0) return false;
    await audit(tx, actor, "payment_authorization", authorizationId, "payment_authorization.revoked", {});
    return true;
  });
  return revoked ? { ok: true, message: "Autorización revocada." } : denied("La autorización no existe o ya no está activa.");
}

export async function setApprovalPermission(actor: PolicyActor, input: PermissionInput): Promise<PolicyResult> {
  const denial = checkCanGrantPermissions(actor);
  if (denial !== null) return denied(denial);

  // Solo miembros de la organización (la FK compuesta también lo impone).
  const membership = await db.organizationMembership.findUnique({
    where: { userId_organizationId: { userId: input.userId, organizationId: actor.organizationId } },
    select: { userId: true },
  });
  if (membership === null) return denied("La persona no es miembro de esta organización.");

  const data = {
    canApprove: input.canApprove,
    approvalLimitMinor: input.approvalLimitMinor,
    canManagePolicies: input.canManagePolicies,
    grantedBy: actor.userId,
  };
  await db.$transaction(async (tx) => {
    await tx.approvalPermission.upsert({
      where: { userId_organizationId: { userId: input.userId, organizationId: actor.organizationId } },
      create: { userId: input.userId, organizationId: actor.organizationId, ...data },
      update: data,
    });
    await audit(tx, actor, "approval_permission", input.userId, "approval_permission.set", {
      canApprove: input.canApprove,
      approvalLimitMinor: input.approvalLimitMinor,
      canManagePolicies: input.canManagePolicies,
    });
  });
  return { ok: true, message: "Permisos actualizados." };
}

// ---------------------------------------------------------------------------
// Datos demo (ficticios, idempotentes)
// ---------------------------------------------------------------------------

// Coinciden con fixtures/payment-history/demo-bank.csv para que el historial se asocie.
const DEMO_SUPPLIERS = [
  { name: "Nube Hosting LLC", beneficiaryAccountRef: "****1234" },
  { name: "Diseño Studio", beneficiaryAccountRef: "****3390" },
  { name: "Papelería Central", beneficiaryAccountRef: "****4821" },
];

export async function loadDemoData(actor: PolicyActor, today: string): Promise<PolicyResult> {
  const denial = checkCanLoadDemoData(actor);
  if (denial !== null) return denied(denial);

  await db.$transaction(async (tx) => {
    // El admin que carga la demo recibe permisos explícitos (sin aprobadores ilimitados).
    const permission = { canApprove: true, approvalLimitMinor: 1_000_000, canManagePolicies: true, grantedBy: actor.userId };
    await tx.approvalPermission.upsert({
      where: { userId_organizationId: { userId: actor.userId, organizationId: actor.organizationId } },
      create: { userId: actor.userId, organizationId: actor.organizationId, ...permission },
      update: permission,
    });

    const suppliers = new Map<string, string>();
    for (const demo of DEMO_SUPPLIERS) {
      const normalizedName = normalizeSupplierName(demo.name);
      const supplier = await tx.supplier.upsert({
        where: { organizationId_normalizedName: { organizationId: actor.organizationId, normalizedName } },
        create: { organizationId: actor.organizationId, name: demo.name, normalizedName, beneficiaryAccountRef: demo.beneficiaryAccountRef },
        update: {},
      });
      suppliers.set(demo.name, supplier.id);
    }

    const hasPolicy = await tx.paymentPolicy.count({ where: { organizationId: actor.organizationId } });
    if (hasPolicy === 0) {
      await tx.paymentPolicy.create({
        data: {
          organizationId: actor.organizationId,
          version: 1,
          autoApprovalLimitMinor: 200_000, // 2,000.00 USD
          monthlyBudgetMinor: 2_000_000, // 20,000.00 USD
          currency: P0_CURRENCY,
          effectiveFrom: new Date(),
          createdBy: actor.userId,
        },
      });
    }

    // Solo Papelería Central queda autorizada (aprobación automática). Nube Hosting tiene
    // historial recurrente pero NO autorización: su factura debe escalar en la demo.
    const papeleriaId = suppliers.get("Papelería Central");
    const hasAuthorization = await tx.paymentAuthorization.count({ where: { organizationId: actor.organizationId } });
    if (papeleriaId !== undefined && hasAuthorization === 0) {
      const endOfNextYear = `${Number(today.slice(0, 4)) + 1}-12-31`;
      await tx.paymentAuthorization.create({
        data: {
          organizationId: actor.organizationId,
          supplierId: papeleriaId,
          beneficiaryAccountRef: "****4821",
          currency: P0_CURRENCY,
          maxAmountMinor: 10_000, // 100.00 USD
          scope: "recurring",
          frequency: "monthly",
          validFrom: toDbDate(today),
          validUntil: toDbDate(endOfNextYear),
          authorizedBy: actor.userId,
        },
      });
    }

    await audit(tx, actor, "organization", actor.organizationId, "demo_data.loaded", { suppliers: DEMO_SUPPLIERS.map((s) => s.name) });
  });
  return { ok: true, message: "Datos demo cargados." };
}
