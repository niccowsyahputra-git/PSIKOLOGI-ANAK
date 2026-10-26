import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./auth";
import { getDbReady } from "./db";
import { UnauthenticatedError } from "./errors";
import { permissionsForRole, type PermissionCode } from "./permissions";
import type { StaffRole } from "./roles";
import {
  findMembershipByAuthUser,
} from "@/server/repositories/staff.repository";
import {
  findOrganizationById,
  type OrganizationRow,
} from "@/server/repositories/organization.repository";
import type { StaffActor } from "@/server/services/staff.service";

export type StaffSessionContext = {
  user: { id: string; name: string; email: string };
  membership: {
    id: string;
    role: StaffRole;
    organizationId: string;
    credentialVerifiedAt: Date | null;
  };
  organization: Pick<OrganizationRow, "id" | "name" | "timezone">;
  permissions: PermissionCode[];
};

/**
 * Server-derived staff context. Client-supplied roles are ignored: the role
 * always comes from `staff_memberships` for the authenticated auth user
 * (FR-01, section 12.4). Returns null when the session, membership or
 * organization is missing or inactive.
 */
export async function getStaffSession(): Promise<StaffSessionContext | null> {
  const requestHeaders = await headers();
  if ((await cookies()).get("panti.intake")?.value) return null;
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session?.user) return null;

  const db = await getDbReady();
  const membership = await findMembershipByAuthUser(db, session.user.id);
  if (!membership || !membership.active) return null;

  const organization = await findOrganizationById(db, membership.organizationId);
  if (!organization) return null;

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
    },
    membership: {
      id: membership.id,
      role: membership.role,
      organizationId: membership.organizationId,
      credentialVerifiedAt: membership.credentialVerifiedAt,
    },
    organization: {
      id: organization.id,
      name: organization.name,
      timezone: organization.timezone,
    },
    permissions: permissionsForRole(membership.role),
  };
}

/** Page-level guard: unauthenticated staff are redirected to the local login. */
export async function requireStaffSession(): Promise<StaffSessionContext> {
  const context = await getStaffSession();
  if (!context) {
    redirect("/login");
  }
  return context;
}

/** API-level guard: never redirects, always answers with 401/403 envelopes. */
export async function requireStaffSessionForApi(): Promise<StaffSessionContext> {
  const context = await getStaffSession();
  if (!context) {
    throw new UnauthenticatedError();
  }
  return context;
}

export function toStaffActor(context: StaffSessionContext): StaffActor {
  return {
    membershipId: context.membership.id,
    authUserId: context.user.id,
    organizationId: context.organization.id,
    role: context.membership.role,
  };
}
