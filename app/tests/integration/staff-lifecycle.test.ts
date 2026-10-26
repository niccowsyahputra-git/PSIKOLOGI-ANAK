import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDbReady, type AppDatabase } from "@/lib/db";
import { session, user } from "@/lib/db/auth-schema";
import { auditLogs, staffMemberships } from "@/lib/db/domain-schema";
import { resetEnvCacheForTests } from "@/lib/env";
import { ConflictError, ValidationError } from "@/lib/errors";
import { resolveFromProjectRoot } from "@/lib/paths";
import { PermissionDeniedError } from "@/lib/permissions";
import {
  createOrganization,
  type OrganizationRow,
} from "@/server/repositories/organization.repository";
import {
  assertVerifiedPsychologist,
  createStaffAccount,
  ensureStaffAccount,
  listStaffForAdmin,
  updateStaffAccount,
  type StaffActor,
} from "@/server/services/staff.service";

let tempDir: string;
let db: AppDatabase;
let organization: OrganizationRow;
let admin: StaffActor;
let pengasuhMembershipId: string;

async function auditRowsFor(action: string) {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.action, action))
    .orderBy(desc(auditLogs.createdAt));
  return rows.map((row) => ({
    ...row,
    metadata: JSON.parse(row.safeMetadata) as Record<string, unknown>,
  }));
}

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "panti-t02-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_MODE: "local-development",
    LOCAL_ONLY: "true",
    DATABASE_PROVIDER: "local",
    DATABASE_URL: `file:${path.join(tempDir, "test.db")}`,
    STORAGE_PROVIDER: "local",
    LOCAL_STORAGE_ROOT: path.join(tempDir, "storage"),
    BACKUP_ROOT: path.join(tempDir, "backups"),
    AI_MODE: "mock",
    BETTER_AUTH_SECRET: "b".repeat(48),
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"),
  });
  resetEnvCacheForTests();

  db = await getDbReady();
  await migrate(db, { migrationsFolder: resolveFromProjectRoot("migrations") });
  organization = await createOrganization(db, {
    name: "Panti Uji Lokal",
    timezone: "Asia/Jakarta",
  });
});

afterAll(async () => {
  await closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("staff membership lifecycle (T02)", () => {
  it("bootstraps the first administrator and audits it", async () => {
    const result = await ensureStaffAccount(db, {
      organizationId: organization.id,
      email: "admin@panti.test",
      name: "Administrator Uji",
      password: "AdminLokal2026!",
      role: "admin",
      actorLabel: "bootstrap:admin",
    });

    expect(result.createdUser).toBe(true);
    expect(result.createdMembership).toBe(true);

    admin = {
      membershipId: result.membershipId,
      authUserId: result.authUserId,
      organizationId: organization.id,
      role: "admin",
    };

    const audits = await auditRowsFor("staff.bootstrap_admin");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorType).toBe("system");
    expect(audits[0]?.actorId).toBe("bootstrap:admin");
    expect(audits[0]?.metadata).toMatchObject({ role: "admin", active: true });
  });

  it("stays idempotent when the bootstrap runs twice", async () => {
    const again = await ensureStaffAccount(db, {
      organizationId: organization.id,
      email: "admin@panti.test",
      name: "Administrator Uji",
      password: "AdminLokal2026!",
      role: "admin",
      actorLabel: "bootstrap:admin",
    });

    expect(again.createdUser).toBe(false);
    expect(again.membershipId).toBe(admin.membershipId);
  });

  it("refuses to silently change a role through the bootstrap path", async () => {
    await expect(
      ensureStaffAccount(db, {
        organizationId: organization.id,
        email: "admin@panti.test",
        name: "Administrator Uji",
        password: "AdminLokal2026!",
        role: "ketua",
        actorLabel: "bootstrap:admin",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("creates a pengasuh account with an audited membership", async () => {
    const created = await createStaffAccount(db, {
      actor: admin,
      input: {
        name: "Ibu Sari",
        email: "sari@panti.test",
        password: "PengasuhLokal2026!",
        role: "pengasuh",
      },
    });
    pengasuhMembershipId = created.membershipId;

    const rows = await listStaffForAdmin(db, { actor: admin });
    const sari = rows.find((row) => row.membershipId === created.membershipId);
    expect(sari).toBeDefined();
    expect(sari?.role).toBe("pengasuh");
    expect(sari?.active).toBe(true);
    expect(sari?.email).toBe("sari@panti.test");
    expect(sari?.credentialVerifiedAt).toBeNull();

    const audits = await auditRowsFor("staff.create");
    expect(audits[0]?.metadata).toMatchObject({
      authUserId: created.authUserId,
      role: "pengasuh",
    });
  });

  it("refuses staff management for non-admin roles", async () => {
    const pengasuhActor: StaffActor = {
      membershipId: pengasuhMembershipId,
      authUserId: "any",
      organizationId: organization.id,
      role: "pengasuh",
    };

    await expect(
      createStaffAccount(db, {
        actor: pengasuhActor,
        input: {
          name: "Tidak Boleh",
          email: "nope@panti.test",
          password: "PengasuhLokal2026!",
          role: "admin",
        },
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    await expect(listStaffForAdmin(db, { actor: pengasuhActor })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("requires a credential reference and chairperson confirmation for psychologists", async () => {
    await expect(
      createStaffAccount(db, {
        actor: admin,
        input: {
          name: "Psikolog Tanpa Kredensial",
          email: "psikolog@panti.test",
          password: "PsikologLokal2026!",
          role: "psikolog",
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const created = await createStaffAccount(db, {
      actor: admin,
      input: {
        name: "Ibu Rani",
        email: "rani@panti.test",
        password: "PsikologLokal2026!",
        role: "psikolog",
        credentialReference: "STR-1234567890",
        chairpersonConfirmation: true,
      },
    });

    const rows = await listStaffForAdmin(db, { actor: admin });
    const rani = rows.find((row) => row.membershipId === created.membershipId);
    expect(rani?.credentialVerifiedAt).not.toBeNull();

    await expect(
      assertVerifiedPsychologist(db, {
        membershipId: created.membershipId,
        authUserId: created.authUserId,
        organizationId: organization.id,
        role: "psikolog",
      }),
    ).resolves.toBeUndefined();

    await expect(
      assertVerifiedPsychologist(db, {
        membershipId: pengasuhMembershipId,
        authUserId: "any",
        organizationId: organization.id,
        role: "pengasuh",
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("audits a role change and invalidates the target session", async () => {
    const target = (await listStaffForAdmin(db, { actor: admin })).find(
      (row) => row.membershipId === pengasuhMembershipId,
    );
    expect(target).toBeDefined();

    await db.insert(session).values({
      id: randomUUID(),
      token: randomUUID(),
      userId: target!.authUserId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const updated = await updateStaffAccount(db, {
      actor: admin,
      membershipId: pengasuhMembershipId,
      input: { role: "ketua" },
    });

    expect(updated.role).toBe("ketua");
    expect(updated.credentialReference).toBeNull();

    const sessions = await db
      .select()
      .from(session)
      .where(eq(session.userId, target!.authUserId));
    expect(sessions).toHaveLength(0);

    const audits = await auditRowsFor("staff.role_change");
    expect(audits[0]?.entityId).toBe(pengasuhMembershipId);
    expect(audits[0]?.metadata).toMatchObject({
      role: "ketua",
      previousRole: "pengasuh",
    });
  });

  it("refuses a role or activation change on the acting account", async () => {
    await expect(
      updateStaffAccount(db, {
        actor: admin,
        membershipId: admin.membershipId,
        input: { role: "ketua" },
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      updateStaffAccount(db, {
        actor: admin,
        membershipId: admin.membershipId,
        input: { active: false },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("protects the last active administrator", async () => {
    const secondAdmin = await createStaffAccount(db, {
      actor: admin,
      input: {
        name: "Administrator Dua",
        email: "admin2@panti.test",
        password: "AdminLokal2026!",
        role: "admin",
      },
    });

    const deactivated = await updateStaffAccount(db, {
      actor: admin,
      membershipId: secondAdmin.membershipId,
      input: { active: false },
    });
    expect(deactivated.active).toBe(false);

    const deactivateAudits = await auditRowsFor("staff.deactivate");
    expect(deactivateAudits[0]?.metadata).toMatchObject({ active: false });

    const secondAdminActor: StaffActor = {
      membershipId: secondAdmin.membershipId,
      authUserId: secondAdmin.authUserId,
      organizationId: organization.id,
      role: "admin",
    };

    await expect(
      updateStaffAccount(db, {
        actor: secondAdminActor,
        membershipId: admin.membershipId,
        input: { active: false },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("enforces foreign keys and one membership per user and organisation", async () => {
    const orphanUserId = randomUUID();
    await db.insert(user).values({
      id: orphanUserId,
      name: "Uji FK",
      email: "fk@panti.test",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      db.insert(staffMemberships).values({
        organizationId: randomUUID(),
        authUserId: orphanUserId,
        role: "pengasuh",
        active: true,
      }),
    ).rejects.toThrow();

    await db.insert(staffMemberships).values({
      organizationId: organization.id,
      authUserId: orphanUserId,
      role: "pengasuh",
      active: true,
    });

    await expect(
      db.insert(staffMemberships).values({
        organizationId: organization.id,
        authUserId: orphanUserId,
        role: "ketua",
        active: true,
      }),
    ).rejects.toThrow();
  });

  it("rejects a role value outside the fixed set of four", async () => {
    await expect(
      db.run(
        `insert into staff_memberships (id, organization_id, auth_user_id, role, active, created_at, updated_at)
         values ('x-invalid-role', '${organization.id}', '${admin.authUserId}', 'superadmin', 1, 0, 0)`,
      ),
    ).rejects.toThrow();
  });
});
