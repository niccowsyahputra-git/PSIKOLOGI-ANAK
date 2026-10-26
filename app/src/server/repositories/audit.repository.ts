import { and, desc, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { auditLogs } from "@/lib/db/domain-schema";
import type { SafeAuditMetadata } from "@/lib/audit-metadata";

export type AuditLogRow = typeof auditLogs.$inferSelect;

export type AuditInsert = {
  organizationId: string;
  actorId: string;
  actorType: "staff" | "participant" | "system";
  action: string;
  entityType: string;
  entityId: string | null;
  safeMetadata: SafeAuditMetadata;
  createdAt?: Date;
};

/** Any drizzle executor: the app database or an open transaction. */
export type SqlExecutor = Pick<AppDatabase, "insert" | "select">;

export async function insertAuditLog(
  executor: SqlExecutor,
  entry: AuditInsert,
): Promise<void> {
  await executor.insert(auditLogs).values({
    organizationId: entry.organizationId,
    actorId: entry.actorId,
    actorType: entry.actorType,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    safeMetadata: JSON.stringify(entry.safeMetadata),
    createdAt: entry.createdAt ?? new Date(),
  });
}

export type AuditListFilter = {
  organizationId: string;
  limit: number;
  cursor?: { createdAt: Date; id: string } | undefined;
  action?: string | undefined;
  entityType?: string | undefined;
};

export async function listAuditLogs(
  db: AppDatabase,
  filter: AuditListFilter,
): Promise<AuditLogRow[]> {
  const conditions = [eq(auditLogs.organizationId, filter.organizationId)];

  if (filter.action) conditions.push(eq(auditLogs.action, filter.action));
  if (filter.entityType) conditions.push(eq(auditLogs.entityType, filter.entityType));
  if (filter.cursor) {
    conditions.push(
      sql`(${auditLogs.createdAt} < ${filter.cursor.createdAt.getTime()} OR (${auditLogs.createdAt} = ${filter.cursor.createdAt.getTime()} AND ${auditLogs.id} < ${filter.cursor.id}))`,
    );
  }

  return db
    .select()
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(filter.limit);
}

export async function countAuditLogs(
  db: AppDatabase,
  organizationId: string,
): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`count(*)` })
    .from(auditLogs)
    .where(eq(auditLogs.organizationId, organizationId));
  return rows[0]?.total ?? 0;
}
