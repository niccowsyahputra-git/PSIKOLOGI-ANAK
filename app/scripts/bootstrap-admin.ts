import { closeDb, getDbReady } from "../src/lib/db";
import { resolveFromProjectRoot } from "../src/lib/paths";
import {
  createOrganization,
  findPrimaryOrganization,
} from "../src/server/repositories/organization.repository";
import { recordAudit } from "../src/server/services/audit.service";
import { ensureStaffAccount } from "../src/server/services/staff.service";
import {
  fail,
  optionalStringArg,
  parseArgs,
  printDone,
  printHeader,
  printStep,
} from "./lib/cli";
import { mkdirSync } from "node:fs";

/**
 * Creates the first local administrator without exposing a public signup route
 * (FR-01). Safe to re-run: an existing account/role is reported, never changed.
 *
 *   npm run bootstrap:admin -- --email admin@panti.local --password "..." --name "Nama"
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const email = optionalStringArg(args, "email");
  const password = optionalStringArg(args, "password") ?? process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = optionalStringArg(args, "name") ?? "Administrator Panti";
  const organizationName =
    optionalStringArg(args, "org-name") ?? "Panti Asuhan (instalasi lokal)";
  const timezone = optionalStringArg(args, "timezone") ?? "Asia/Jakarta";

  if (!email) {
    fail(
      "Gunakan: npm run bootstrap:admin -- --email <email> --password <min-12-karakter> [--name <nama>] [--org-name <nama panti>]",
    );
  }
  if (!password || password.length < 12) {
    fail("Kata sandi minimal 12 karakter dan tidak dicetak ulang oleh skrip ini");
  }

  printHeader("bootstrap:admin (local)");
  mkdirSync(resolveFromProjectRoot("var/db"), { recursive: true, mode: 0o700 });

  const db = await getDbReady();
  let organization = await findPrimaryOrganization(db);
  if (!organization) {
    organization = await createOrganization(db, {
      name: organizationName,
      timezone,
    });
    await recordAudit(db, {
      organizationId: organization.id,
      actor: { type: "system", label: "bootstrap:admin" },
      action: "organization.create",
      entityType: "organization",
      entityId: organization.id,
      metadata: { timezone },
    });
    printStep(`Organisasi lokal dibuat: ${organization.name}`);
  } else {
    printStep(`Menggunakan organisasi yang sudah ada: ${organization.name}`);
  }

  const result = await ensureStaffAccount(db, {
    organizationId: organization.id,
    email,
    name,
    password,
    role: "admin",
    actorLabel: "bootstrap:admin",
  });

  printDone(
    result.createdUser
      ? `Administrator dibuat: ${email}`
      : `Akun ${email} sudah ada; peran admin dipertahankan`,
  );
  printStep(`membership: ${result.membershipId}`);
  printStep("Jalankan `npm run dev` lalu login di http://localhost:3000/login");
}

main()
  .catch((error: unknown) => {
    console.error(
      `✖ bootstrap gagal: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(
      "  Pastikan `npm run db:migrate` sudah dijalankan dan .env.local berisi secret yang valid.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
