import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
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
  phone: text("phone"),
  email: text("email"),
  /** Person responsible for the letterhead signature block (FR-17). */
  leaderName: text("leader_name"),
  leaderTitle: text("leader_title"),
  registrationNumber: text("registration_number"),
  /** Optional line printed under the letterhead, e.g. an archive reference. */
  printNote: text("print_note"),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  /**
   * Organization logo is not bound to a child (PRD section 9.2). The foreign
   * key to `attachments` is added by the media migration in T05.
   */
  logoAttachmentId: text("logo_attachment_id"),
  revision: integer("revision").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Dynamic AI configuration (PRD section 9.2 `ai_settings`, FR-10). The API key
 * is stored encrypted and never leaves the server; `keyFingerprint` is a
 * one-way digest so the configuration fingerprint can be recomputed without
 * decrypting the secret.
 */
export const aiSettings = sqliteTable(
  "ai_settings",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    mode: text("mode", {
      enum: ["mock", "local_endpoint", "remote_endpoint"],
    })
      .notNull()
      .default("mock"),
    providerName: text("provider_name").notNull().default("Mock lokal"),
    baseUrl: text("base_url"),
    model: text("model"),
    /** Request path appended to `base_url` for OpenAI-compatible services. */
    extension: text("extension").notNull().default("/v1/chat/completions"),
    keyCiphertext: text("key_ciphertext"),
    keyVersion: integer("key_version"),
    keyFingerprint: text("key_fingerprint"),
    temperature: real("temperature").notNull().default(0.2),
    maxTokens: integer("max_tokens").notNull().default(2000),
    timeoutSeconds: integer("timeout_seconds").notNull().default(45),
    dailyLimit: integer("daily_limit").notNull().default(20),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    settingsVersion: integer("settings_version").notNull().default(1),
    promptVersion: text("prompt_version").notNull().default("p1"),
    lastTestFingerprint: text("last_test_fingerprint"),
    lastTestStatus: text("last_test_status", {
      enum: ["untested", "passed", "failed"],
    })
      .notNull()
      .default("untested"),
    lastTestAt: integer("last_test_at", { mode: "timestamp_ms" }),
    revision: integer("revision").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("ai_settings_organization_unique").on(table.organizationId),
    check(
      "ai_settings_mode_check",
      sql`mode in ('mock','local_endpoint','remote_endpoint')`,
    ),
    check(
      "ai_settings_test_status_check",
      sql`last_test_status in ('untested','passed','failed')`,
    ),
    check("ai_settings_enabled_check", sql`enabled in (0,1)`),
    check(
      "ai_settings_bounds_check",
      sql`temperature >= 0 and temperature <= 1 and max_tokens between 1 and 2000 and timeout_seconds between 5 and 60 and daily_limit between 1 and 100`,
    ),
    // A real endpoint cannot be enabled without the URL and model it was tested with.
    check(
      "ai_settings_endpoint_check",
      sql`mode = 'mock' or enabled = 0 or (base_url is not null and model is not null)`,
    ),
  ],
);

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
