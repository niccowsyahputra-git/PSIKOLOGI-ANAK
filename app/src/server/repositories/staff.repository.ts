import { and, desc, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { staffMemberships } from "@/lib/db/domain-schema";
import { account, session, user } from "@/lib/db/auth-schema";
import type { StaffRole } from "@/lib/roles";

export type StaffMembershipRow = typeof staffMemberships.$inferSelect;
export type AuthUserRow = typeof user.$inferSelect;

export type StaffListRow = {
  membershipId: string;
  authUserId: string;
  name: string;
  email: string;
  role: StaffRole;
  active: boolean;
  credentialReference: string | null;
  credentialVerifiedAt: Date | null;
  credentialVerifiedBy: string | null;
  createdAt: Date;
};

const staffSelection = {
  membershipId: staffMemberships.id,
  authUserId: staffMemberships.authUserId,
  name: user.name,
  email: user.email,
  role: staffMemberships.role,
  active: staffMemberships.active,
  credentialReference: staffMemberships.credentialReference,
  credentialVerifiedAt: staffMemberships.credentialVerifiedAt,
  credentialVerifiedBy: staffMemberships.credentialVerifiedBy,
  createdAt: staffMemberships.createdAt,
};

export async function listStaff(
  db: AppDatabase,
  organizationId: string,
): Promise<StaffListRow[]> {
  return db
    .select(staffSelection)
    .from(staffMemberships)
    .innerJoin(user, eq(user.id, staffMemberships.authUserId))
    .where(eq(staffMemberships.organizationId, organizationId))
    .orderBy(desc(staffMemberships.createdAt));
}

export async function findStaffById(
  db: AppDatabase,
  organizationId: string,
  membershipId: string,
): Promise<StaffListRow | null> {
  const rows = await db
    .select(staffSelection)
    .from(staffMemberships)
    .innerJoin(user, eq(user.id, staffMemberships.authUserId))
    .where(
      and(
        eq(staffMemberships.organizationId, organizationId),
        eq(staffMemberships.id, membershipId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findMembershipByAuthUser(
  db: AppDatabase,
  authUserId: string,
): Promise<StaffMembershipRow | null> {
  const rows = await db
    .select()
    .from(staffMemberships)
    .where(eq(staffMemberships.authUserId, authUserId))
    .limit(1);
  return rows[0] ?? null;
}

export async function countMemberships(
  db: AppDatabase,
  organizationId: string,
): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`count(*)` })
    .from(staffMemberships)
    .where(eq(staffMemberships.organizationId, organizationId));
  return rows[0]?.total ?? 0;
}

export async function findUserByEmail(
  db: AppDatabase,
  email: string,
): Promise<AuthUserRow | null> {
  const rows = await db.select().from(user).where(eq(user.email, email)).limit(1);
  return rows[0] ?? null;
}

/** Better Auth credentials live in `account` with providerId `credential`. */
export async function findCredentialAccount(
  db: AppDatabase,
  authUserId: string,
): Promise<{ id: string; password: string | null } | null> {
  const rows = await db
    .select({ id: account.id, password: account.password })
    .from(account)
    .where(
      and(eq(account.userId, authUserId), eq(account.providerId, "credential")),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Role or activation changes must not leave a usable session behind
 * (section 4.2: "invalidasi/revalidasi sesi"). Better Auth sessions are deleted
 * so the next request re-authenticates against the new membership state.
 */
export async function deleteSessionsForAuthUser(
  db: AppDatabase,
  authUserId: string,
): Promise<void> {
  await db.delete(session).where(eq(session.userId, authUserId));
}
