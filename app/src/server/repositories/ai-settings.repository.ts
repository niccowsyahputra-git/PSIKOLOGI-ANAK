import { and, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { aiSettings } from "@/lib/db/domain-schema";

export type AiSettingsRow = typeof aiSettings.$inferSelect;
export type AiSettingsPatch = Partial<
  Omit<AiSettingsRow, "id" | "organizationId" | "revision" | "createdAt" | "updatedAt">
>;

export async function findAiSettings(
  db: AppDatabase,
  organizationId: string,
): Promise<AiSettingsRow | null> {
  const rows = await db
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The row is created lazily on first read so a fresh installation always starts
 * from mock mode with AI disabled (PRD section 11.1), without a data migration.
 */
export async function ensureAiSettings(
  db: AppDatabase,
  organizationId: string,
): Promise<AiSettingsRow> {
  const existing = await findAiSettings(db, organizationId);
  if (existing) return existing;

  await db.insert(aiSettings).values({ organizationId }).onConflictDoNothing();
  const created = await findAiSettings(db, organizationId);
  if (!created) {
    throw new Error("AI settings row could not be created");
  }
  return created;
}

/** Optimistic concurrency (section 9.1): null means another session saved first. */
export async function updateAiSettingsRow(
  db: AppDatabase,
  params: {
    organizationId: string;
    expectedRevision: number;
    patch: AiSettingsPatch;
  },
): Promise<AiSettingsRow | null> {
  const rows = await db
    .update(aiSettings)
    .set({
      ...params.patch,
      revision: sql`${aiSettings.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(aiSettings.organizationId, params.organizationId),
        eq(aiSettings.revision, params.expectedRevision),
      ),
    )
    .returning();
  return rows[0] ?? null;
}
