import { and, asc, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { organizations } from "@/lib/db/domain-schema";

export type OrganizationRow = typeof organizations.$inferSelect;

/**
 * v1 is a single-tenant local installation (section 5), so the workspace is the
 * oldest organization row. Organization scoping still exists on every query.
 */
export async function findPrimaryOrganization(
  db: AppDatabase,
): Promise<OrganizationRow | null> {
  const rows = await db
    .select()
    .from(organizations)
    .orderBy(asc(organizations.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function findOrganizationById(
  db: AppDatabase,
  organizationId: string,
): Promise<OrganizationRow | null> {
  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

export type OrganizationProfilePatch = Partial<
  Pick<
    OrganizationRow,
    | "name"
    | "address"
    | "contact"
    | "phone"
    | "email"
    | "leaderName"
    | "leaderTitle"
    | "registrationNumber"
    | "printNote"
    | "timezone"
  >
>;

/**
 * Optimistic concurrency per section 9.1: the update only applies when the
 * caller still holds the revision it read, and `revision` is bumped in the same
 * statement. Returns null when another session saved first.
 */
export async function updateOrganizationProfile(
  db: AppDatabase,
  params: {
    organizationId: string;
    expectedRevision: number;
    patch: OrganizationProfilePatch;
  },
): Promise<OrganizationRow | null> {
  const rows = await db
    .update(organizations)
    .set({
      ...params.patch,
      revision: sql`${organizations.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(organizations.id, params.organizationId),
        eq(organizations.revision, params.expectedRevision),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function createOrganization(
  db: AppDatabase,
  input: {
    name: string;
    address?: string | null;
    contact?: string | null;
    timezone?: string;
  },
): Promise<OrganizationRow> {
  const rows = await db
    .insert(organizations)
    .values({
      name: input.name,
      address: input.address ?? null,
      contact: input.contact ?? null,
      timezone: input.timezone ?? "Asia/Jakarta",
    })
    .returning();
  const created = rows[0];
  if (!created) {
    throw new Error("Organization insert returned no row");
  }
  return created;
}
