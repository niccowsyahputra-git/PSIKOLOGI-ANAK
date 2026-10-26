import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@/lib/db";
import { account, user } from "@/lib/db/auth-schema";
import { staffMemberships } from "@/lib/db/domain-schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions";
import type { StaffRole } from "@/lib/roles";
import type { CreateStaffInput, UpdateStaffInput } from "@/lib/validation/staff.schema";
import {
  countMemberships,
  deleteSessionsForAuthUser,
  findMembershipByAuthUser,
  findStaffById,
  findUserByEmail,
  listStaff,
  type StaffListRow,
} from "@/server/repositories/staff.repository";
import { recordAudit } from "./audit.service";

export type StaffActor = {
  membershipId: string;
  authUserId: string;
  organizationId: string;
  role: StaffRole;
};

type Tx = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];

async function insertCredentialUser(
  tx: Tx,
  input: { email: string; name: string; password: string },
): Promise<string> {
  const authUserId = randomUUID();
  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  await tx.insert(user).values({
    id: authUserId,
    name: input.name,
    email: input.email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await tx.insert(account).values({
    id: randomUUID(),
    accountId: authUserId,
    providerId: "credential",
    userId: authUserId,
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });
  return authUserId;
}

function assertPsychologistCredentials(
  role: StaffRole,
  credentialReference: string | null | undefined,
  chairpersonConfirmation: boolean | undefined,
): void {
  if (role !== "psikolog") return;
  const fieldErrors: Record<string, string[]> = {};
  if (!credentialReference || credentialReference.trim().length < 3) {
    fieldErrors.credentialReference = [
      "Referensi kredensial profesi wajib diisi sebelum memberi peran psikolog",
    ];
  }
  if (chairpersonConfirmation !== true) {
    fieldErrors.chairpersonConfirmation = [
      "Peran psikolog memerlukan konfirmasi ketua/pihak berwenang",
    ];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError(
      "Peran psikolog belum dapat diberikan tanpa kredensial terverifikasi",
      fieldErrors,
    );
  }
}

export async function createStaffAccount(
  db: AppDatabase,
  params: { actor: StaffActor; input: CreateStaffInput },
): Promise<{ membershipId: string; authUserId: string }> {
  const { actor, input } = params;
  assertCan(actor.role, "admin.users");
  assertPsychologistCredentials(
    input.role,
    input.credentialReference,
    input.chairpersonConfirmation,
  );

  const existingUser = await findUserByEmail(db, input.email);
  if (existingUser) {
    throw new ConflictError("Email sudah terdaftar pada instalasi lokal ini");
  }

  return db.transaction(async (tx) => {
    const authUserId = await insertCredentialUser(tx, {
      email: input.email,
      name: input.name,
      password: input.password,
    });
    const now = new Date();
    const membershipId = randomUUID();
    const isPsychologist = input.role === "psikolog";

    await tx.insert(staffMemberships).values({
      id: membershipId,
      organizationId: actor.organizationId,
      authUserId,
      role: input.role,
      active: true,
      credentialReference: isPsychologist ? (input.credentialReference ?? null) : null,
      credentialVerifiedBy: isPsychologist ? actor.membershipId : null,
      credentialVerifiedAt: isPsychologist ? now : null,
      createdAt: now,
      updatedAt: now,
    });

    await recordAudit(tx, {
      organizationId: actor.organizationId,
      actor: { type: "staff", membershipId: actor.membershipId },
      action: "staff.create",
      entityType: "staff_membership",
      entityId: membershipId,
      metadata: { authUserId, role: input.role, active: true },
    });

    if (isPsychologist) {
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actor: { type: "staff", membershipId: actor.membershipId },
        action: "staff.credential_verify",
        entityType: "staff_membership",
        entityId: membershipId,
        metadata: {
          staffCredentialVerifiedBy: actor.membershipId,
          role: "psikolog",
        },
      });
    }

    return { membershipId, authUserId };
  });
}

export async function updateStaffAccount(
  db: AppDatabase,
  params: { actor: StaffActor; membershipId: string; input: UpdateStaffInput },
): Promise<StaffListRow> {
  const { actor, membershipId, input } = params;
  assertCan(actor.role, "admin.users");

  const target = await findStaffById(db, actor.organizationId, membershipId);
  if (!target) {
    throw new NotFoundError("Akun staf tidak ditemukan pada organisasi ini");
  }

  const isSelf = target.membershipId === actor.membershipId;
  const roleChange = input.role !== undefined && input.role !== target.role;
  const deactivation = input.active === false && target.active;

  if (isSelf && (roleChange || deactivation)) {
    throw new ConflictError(
      "Peran atau status akun sendiri tidak dapat diubah dari sesi ini; minta administrator lain",
    );
  }

  if (deactivation && target.role === "admin") {
    const activeAdmins = await db
      .select({ total: sql<number>`count(*)` })
      .from(staffMemberships)
      .where(
        and(
          eq(staffMemberships.organizationId, actor.organizationId),
          eq(staffMemberships.role, "admin"),
          eq(staffMemberships.active, true),
        ),
      );
    if ((activeAdmins[0]?.total ?? 0) <= 1) {
      throw new ConflictError(
        "Administrator aktif terakhir tidak boleh dinonaktifkan; buat administrator lain lebih dulu",
      );
    }
  }

  const nextRole = roleChange && input.role ? input.role : target.role;
  if (roleChange && nextRole === "psikolog") {
    assertPsychologistCredentials(
      nextRole,
      input.credentialReference ?? target.credentialReference,
      input.chairpersonConfirmation,
    );
  }

  const now = new Date();
  const credentialReference =
    nextRole === "psikolog"
      ? (input.credentialReference ?? target.credentialReference)
      : null;
  const credentialVerifiedBy = nextRole === "psikolog" ? actor.membershipId : null;
  const credentialVerifiedAt = nextRole === "psikolog" ? (target.credentialVerifiedAt ?? now) : null;

  await db.transaction(async (tx) => {
    await tx
      .update(staffMemberships)
      .set({
        role: nextRole,
        active: input.active ?? target.active,
        credentialReference,
        credentialVerifiedBy,
        credentialVerifiedAt,
        updatedAt: now,
      })
      .where(eq(staffMemberships.id, membershipId));

    if (roleChange) {
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actor: { type: "staff", membershipId: actor.membershipId },
        action: "staff.role_change",
        entityType: "staff_membership",
        entityId: membershipId,
        metadata: { role: nextRole, previousRole: target.role },
      });
      if (nextRole === "psikolog") {
        await recordAudit(tx, {
          organizationId: actor.organizationId,
          actor: { type: "staff", membershipId: actor.membershipId },
          action: "staff.credential_verify",
          entityType: "staff_membership",
          entityId: membershipId,
          metadata: { staffCredentialVerifiedBy: actor.membershipId, role: nextRole },
        });
      }
    }

    if (deactivation) {
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actor: { type: "staff", membershipId: actor.membershipId },
        action: "staff.deactivate",
        entityType: "staff_membership",
        entityId: membershipId,
        metadata: { active: false, role: target.role },
      });
    } else if (input.active === true && !target.active) {
      await recordAudit(tx, {
        organizationId: actor.organizationId,
        actor: { type: "staff", membershipId: actor.membershipId },
        action: "staff.reactivate",
        entityType: "staff_membership",
        entityId: membershipId,
        metadata: { active: true, role: nextRole },
      });
    }
  });

  // A role or activation change invalidates the existing session immediately.
  if (roleChange || deactivation || (input.active === true && !target.active)) {
    await deleteSessionsForAuthUser(db, target.authUserId);
  }

  const updated = await findStaffById(db, actor.organizationId, membershipId);
  if (!updated) {
    throw new NotFoundError("Akun staf tidak ditemukan setelah pembaruan");
  }
  return updated;
}

export async function listStaffForAdmin(
  db: AppDatabase,
  params: { actor: StaffActor },
): Promise<StaffListRow[]> {
  assertCan(params.actor.role, "admin.users");
  return listStaff(db, params.actor.organizationId);
}

/**
 * Psychologist writes require a verified credential, re-checked on every write
 * (FR-01, BR-20, U44). The permission matrix alone is not sufficient.
 */
export async function assertVerifiedPsychologist(
  db: AppDatabase,
  actor: StaffActor,
): Promise<void> {
  assertCan(actor.role, "psych.analysis.write");
  const row = await findStaffById(db, actor.organizationId, actor.membershipId);
  if (!row || row.role !== "psikolog" || row.credentialVerifiedAt === null) {
    throw new ForbiddenError(
      "Peran psikolog belum terverifikasi kredensialnya; penulisan hasil profesional ditolak",
    );
  }
}

/**
 * Used by `bootstrap:admin` and `db:seed`: creates the auth user, credential and
 * membership idempotently without exposing a public signup route.
 */
export async function ensureStaffAccount(
  db: AppDatabase,
  params: {
    organizationId: string;
    email: string;
    name: string;
    password: string;
    role: StaffRole;
    credentialReference?: string | null;
    actorLabel: string;
  },
): Promise<{ membershipId: string; authUserId: string; createdUser: boolean; createdMembership: boolean }> {
  const existingUser = await findUserByEmail(db, params.email);
  if (existingUser) {
    const existingMembership = await findMembershipByAuthUser(db, existingUser.id);
    if (existingMembership) {
      if (existingMembership.role !== params.role) {
        throw new ConflictError(
          `Akun ${params.email} sudah ada dengan peran ${existingMembership.role}; ubah peran lewat panel admin agar tercatat di audit`,
        );
      }
      if (existingMembership.organizationId !== params.organizationId) {
        throw new ConflictError(
          `Akun ${params.email} terhubung ke organisasi lain pada file database ini`,
        );
      }
      return {
        membershipId: existingMembership.id,
        authUserId: existingUser.id,
        createdUser: false,
        createdMembership: false,
      };
    }
    throw new ConflictError(
      `Akun ${params.email} ada tanpa membership staf; selesaikan manual agar tidak terjadi akses ganda`,
    );
  }

  return db.transaction(async (tx) => {
    const authUserId = await insertCredentialUser(tx, {
      email: params.email,
      name: params.name,
      password: params.password,
    });
    const now = new Date();
    const membershipId = randomUUID();
    const isPsychologist = params.role === "psikolog";

    await tx.insert(staffMemberships).values({
      id: membershipId,
      organizationId: params.organizationId,
      authUserId,
      role: params.role,
      active: true,
      credentialReference: isPsychologist
        ? (params.credentialReference ?? "Belum diverifikasi")
        : null,
      credentialVerifiedBy: null,
      credentialVerifiedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await recordAudit(tx, {
      organizationId: params.organizationId,
      actor: { type: "system", label: params.actorLabel },
      action: params.role === "admin" ? "staff.bootstrap_admin" : "staff.create",
      entityType: "staff_membership",
      entityId: membershipId,
      metadata: { authUserId, role: params.role, active: true },
    });

    return {
      membershipId,
      authUserId,
      createdUser: true,
      createdMembership: true,
    };
  });
}

export async function countStaffForOrganization(
  db: AppDatabase,
  organizationId: string,
): Promise<number> {
  return countMemberships(db, organizationId);
}
