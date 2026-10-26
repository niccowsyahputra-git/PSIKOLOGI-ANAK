import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { STAFF_ROLES } from "../roles";
import { user } from "./auth-schema";

/**
 * Domain tables for T02. Later stages append their own tables to this file
 * (children, guardians, assessments, AI, reports) following section 9.2 of the
 * PRD. Auth tables live in `auth-schema.ts` and belong to Better Auth (DEC-03).
 */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date());

const roleCheck = sql`${sql.raw("role")} in ('pengasuh','ketua','psikolog','admin')`;

export const organizations = sqliteTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  address: text("address"),
  contact: text("contact"),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  /**
   * Organization logo is not bound to a child (PRD section 9.2). The foreign
   * key to `attachments` is added by the media migration in T05.
   */
  logoAttachmentId: text("logo_attachment_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const staffMemberships = sqliteTable(
  "staff_memberships",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    authUserId: text("auth_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    role: text("role", { enum: STAFF_ROLES }).notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    credentialReference: text("credential_reference"),
    credentialVerifiedBy: text("credential_verified_by").references(
      (): AnySQLiteColumn => staffMemberships.id,
      { onDelete: "set null" },
    ),
    credentialVerifiedAt: integer("credential_verified_at", {
      mode: "timestamp_ms",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("staff_memberships_auth_user_org_unique").on(
      table.authUserId,
      table.organizationId,
    ),
    index("staff_memberships_org_role_index").on(table.organizationId, table.role),
    check("staff_memberships_role_check", roleCheck),
    check("staff_memberships_active_check", sql`active in (0,1)`),
  ],
);

/**
 * Audit is append-only and stores identifiers plus field names only
 * (FR-16, section 12.4). Free text answers never reach this table.
 */
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    actorId: text("actor_id").notNull(),
    actorType: text("actor_type", {
      enum: ["staff", "participant", "system"],
    }).notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    safeMetadata: text("safe_metadata").notNull().default("{}"),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_logs_org_created_index").on(table.organizationId, table.createdAt),
    index("audit_logs_entity_index").on(table.entityType, table.entityId),
    check(
      "audit_logs_actor_type_check",
      sql`actor_type in ('staff','participant','system')`,
    ),
  ],
);
