import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import type { Organization, OrganizationMembership, User } from "@prisma/client";
import { db } from "@/lib/db";
import { membershipRoleFromClerk } from "@/shared/auth/membership-role";

export class OrganizationRequiredError extends Error {
  constructor() {
    super("Se requiere una organización de Clerk activa. El aislamiento de datos usa organizationId.");
    this.name = "OrganizationRequiredError";
  }
}

export type Workspace = {
  user: User;
  organization: Organization;
  membership: OrganizationMembership;
};

type EnsureWorkspaceInput = {
  userId: string;
  organizationId: string;
  email: string;
  displayName: string | null;
  organizationName: string;
  membershipRole: ReturnType<typeof membershipRoleFromClerk>;
};

/** Espejo local de Clerk. Idempotente; no concede permisos de pago. */
export async function persistWorkspace(input: EnsureWorkspaceInput): Promise<Workspace> {
  return db.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { id: input.userId },
      create: {
        id: input.userId,
        email: input.email,
        displayName: input.displayName,
      },
      update: {
        email: input.email,
        displayName: input.displayName,
      },
    });

    const organization = await tx.organization.upsert({
      where: { id: input.organizationId },
      create: {
        id: input.organizationId,
        name: input.organizationName,
      },
      update: {
        name: input.organizationName,
      },
    });

    const membership = await tx.organizationMembership.upsert({
      where: {
        userId_organizationId: {
          userId: input.userId,
          organizationId: input.organizationId,
        },
      },
      create: {
        userId: input.userId,
        organizationId: input.organizationId,
        role: input.membershipRole,
      },
      update: {
        role: input.membershipRole,
      },
    });

    return { user, organization, membership };
  });
}

function primaryEmail(user: {
  primaryEmailAddress?: { emailAddress: string } | null;
  emailAddresses: { emailAddress: string }[];
}): string | null {
  const fromPrimary = user.primaryEmailAddress?.emailAddress.trim();
  if (fromPrimary) {
    return fromPrimary;
  }
  const fromList = user.emailAddresses[0]?.emailAddress.trim();
  return fromList || null;
}

function displayNameFromClerk(user: {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string | null {
  const full = user.fullName?.trim();
  if (full) {
    return full;
  }
  const parts = [user.firstName, user.lastName].filter((part): part is string => Boolean(part?.trim()));
  if (parts.length === 0) {
    return null;
  }
  return parts.join(" ");
}

/**
 * Lee la sesión de Clerk y materializa User + Organization + membresía en Neon.
 * Fail-closed: sin org activa no hay workspace (no se inventa una organización).
 */
export async function ensureWorkspaceFromSession(): Promise<Workspace> {
  const { userId, orgId, orgRole, orgSlug } = await auth();
  if (!userId || !orgId) {
    throw new OrganizationRequiredError();
  }

  const clerkUser = await currentUser();
  if (!clerkUser) {
    throw new OrganizationRequiredError();
  }

  const email = primaryEmail(clerkUser);
  if (!email) {
    throw new Error("El usuario de Clerk no tiene email; no se puede auditar el actor.");
  }

  let organizationName = orgSlug?.trim() || orgId;
  try {
    const client = await clerkClient();
    const org = await client.organizations.getOrganization({ organizationId: orgId });
    const name = org.name?.trim();
    if (name) {
      organizationName = name;
    }
  } catch {
    // El slug/id basta para crear la fila; el nombre se corrige en el siguiente sync.
  }

  return persistWorkspace({
    userId,
    organizationId: orgId,
    email,
    displayName: displayNameFromClerk(clerkUser),
    organizationName,
    membershipRole: membershipRoleFromClerk(orgRole),
  });
}
