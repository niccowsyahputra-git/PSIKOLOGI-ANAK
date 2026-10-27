import { sanitizeAuditMetadata } from "@/lib/audit-metadata";
import type { AppDatabase } from "@/lib/db";
import {
  insertAuditLog,
  type AuditInsert,
  type SqlExecutor,
} from "@/server/repositories/audit.repository";

export type AuditActor =
  | { type: "staff"; membershipId: string }
  | { type: "participant"; sessionId: string }
  | { type: "system"; label: string };

export type AuditEventName =
  | "organization.create"
  | "staff.bootstrap_admin"
  | "staff.create"
  | "staff.update"
  | "staff.role_change"
  | "staff.deactivate"
  | "staff.reactivate"
  | "staff.credential_verify"
  | "settings.general_update"
  | "settings.ai_update"
  | "settings.ai_test"
  | "settings.ai_reset"
  | "auth.login"
  | "auth.logout";

export type RecordAuditInput = {
  organizationId: string;
  actor: AuditActor;
  action: AuditEventName | string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

function actorToColumns(actor: AuditActor): Pick<AuditInsert, "actorId" | "actorType"> {
  switch (actor.type) {
    case "staff":
      return { actorId: actor.membershipId, actorType: "staff" };
    case "participant":
      return { actorId: actor.sessionId, actorType: "participant" };
    case "system":
      return { actorId: actor.label, actorType: "system" };
  }
}

/**
 * The only write path into `audit_logs`. Metadata is sanitized here so callers
 * cannot accidentally persist participant text or secrets (FR-16).
 */
export async function recordAudit(
  executor: SqlExecutor,
  input: RecordAuditInput,
): Promise<void> {
  await insertAuditLog(executor, {
    organizationId: input.organizationId,
    ...actorToColumns(input.actor),
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    safeMetadata: sanitizeAuditMetadata(input.metadata),
  });
}

export async function recordAuditInTransaction(
  db: AppDatabase,
  input: RecordAuditInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    await recordAudit(tx, input);
  });
}
