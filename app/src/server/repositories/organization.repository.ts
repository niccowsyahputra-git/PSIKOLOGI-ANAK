import { asc, eq } from "drizzle-orm";
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
