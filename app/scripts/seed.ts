import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDb, getDbReady } from "../src/lib/db";
import { staffMemberships } from "../src/lib/db/domain-schema";
import type { StaffRole } from "../src/lib/roles";
import {
  createOrganization,
  findPrimaryOrganization,
} from "../src/server/repositories/organization.repository";
import { recordAudit } from "../src/server/services/audit.service";
import { ensureStaffAccount } from "../src/server/services/staff.service";
import {
  optionalStringArg,
  parseArgs,
  printDone,
  printHeader,
  printStep,
} from "./lib/cli";

/**
 * Idempotent demo seed with fictitious data only (section 14.1). It never
 * truncates or resets user data and never prints an existing password.
 *
 *   npm run db:seed
 */
const DEMO_ACCOUNTS: Array<{ email: string; name: string; role: StaffRole }> = [
  { email: "pengasuh@demo.local", name: "Pengasuh Demo", role: "pengasuh" },
  { email: "ketua@demo.local", name: "Ketua Panti Demo", role: "ketua" },
  { email: "psikolog@demo.local", name: "Psikolog Demo", role: "psikolog" },
  { email: "admin@demo.local", name: "Administrator Demo", role: "admin" },
];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const providedPassword = optionalStringArg(args, "password") ?? process.env.SEED_DEMO_PASSWORD;
  const demoPassword = providedPassword ?? `${randomBytes(9).toString("base64url")}Aa1!`;

  if (demoPassword.length < 12) {
    throw new Error("Kata sandi demo minimal 12 karakter");
  }

  printHeader("db:seed (data fiktif lokal)");
  const db = await getDbReady();

  let organization = await findPrimaryOrganization(db);
  if (!organization) {
    organization = await createOrganization(db, {
      name: "Panti Asuhan Demo (fiktif)",
      address: "Alamat fiktif untuk UAT",
      timezone: "Asia/Jakarta",
    });
    await recordAudit(db, {
      organizationId: organization.id,
      actor: { type: "system", label: "db:seed" },
      action: "organization.create",
      entityType: "organization",
      entityId: organization.id,
      metadata: { timezone: "Asia/Jakarta" },
    });
    printStep(`Organisasi demo dibuat: ${organization.name}`);
  } else {
    printStep(`Organisasi tersedia: ${organization.name}`);
  }

  const created: string[] = [];
  for (const account of DEMO_ACCOUNTS) {
    const result = await ensureStaffAccount(db, {
      organizationId: organization.id,
      email: account.email,
      name: account.name,
      password: demoPassword,
      role: account.role,
      credentialReference:
        account.role === "psikolog" ? "DEMO-SIPP-0000 (fiktif)" : null,
      actorLabel: "db:seed",
    });
    if (result.createdUser) created.push(account.email);

    if (account.role === "psikolog" && result.createdMembership) {
      await db
        .update(staffMemberships)
        .set({ credentialVerifiedAt: new Date() })
        .where(eq(staffMemberships.id, result.membershipId));
      await recordAudit(db, {
        organizationId: organization.id,
        actor: { type: "system", label: "db:seed" },
        action: "staff.credential_verify",
        entityType: "staff_membership",
        entityId: result.membershipId,
        metadata: { role: "psikolog", credentialReferenceField: true },
      });
    }
  }

  printDone(
    created.length > 0
      ? `Akun demo dibuat: ${created.join(", ")}`
      : "Semua akun demo sudah ada; kata sandi lama tidak diubah",
  );

  if (created.length > 0) {
    console.log("\nKata sandi demo (hanya ditampilkan sekali, data fiktif):");
    console.log(`  ${demoPassword}`);
    console.log("\nGanti kata sandi ini sebelum memakai data anak nyata.");
  }
  printStep("LIVE_INTAKE_ENABLED tetap false; gunakan data fiktif untuk UAT.");
}

main()
  .catch((error: unknown) => {
    console.error(
      `✖ Seed gagal: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
