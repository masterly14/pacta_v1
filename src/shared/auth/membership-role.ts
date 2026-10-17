import type { MembershipRole } from "@prisma/client";

/** Convierte el rol de Clerk (`org:admin`, `org:member`) al enum local. */
export function membershipRoleFromClerk(orgRole: string | null | undefined): MembershipRole {
  if (orgRole === "org:admin" || orgRole === "admin") {
    return "admin";
  }
  return "member";
}
