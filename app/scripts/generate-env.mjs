#!/usr/bin/env node
/**
 * Generates `.env.local` with fresh local secrets from `.env.example`.
 * Local-only by design: no cloud tokens, no OAuth credentials.
 *
 *   node scripts/generate-env.mjs [--force]
 */
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const examplePath = path.join(projectRoot, ".env.example");
const targetPath = path.join(projectRoot, ".env.local");
const force = process.argv.includes("--force");

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (!existsSync(examplePath)) {
  fail(".env.example tidak ditemukan. Jalankan dari root project aplikasi.");
}

if (existsSync(targetPath) && !force) {
  fail(".env.local sudah ada. Gunakan --force untuk membuat ulang (file lama dibackup).");
}

if (existsSync(targetPath) && force) {
  const backupPath = `${targetPath}.bak-${Date.now()}`;
  copyFileSync(targetPath, backupPath);
  console.log(`• .env.local lama dibackup ke ${path.basename(backupPath)}`);
}

const betterAuthSecret = randomBytes(32).toString("base64url");
const encryptionKey = randomBytes(32).toString("base64");

let content = readFileSync(examplePath, "utf8");
content = content.replace(
  /^BETTER_AUTH_SECRET=.*$/m,
  `BETTER_AUTH_SECRET=${betterAuthSecret}`,
);
content = content.replace(
  /^APP_ENCRYPTION_KEY=.*$/m,
  `APP_ENCRYPTION_KEY=${encryptionKey}`,
);

if (content.includes("replace-with-")) {
  fail("Gagal menyuntikkan secret ke template .env.example");
}

writeFileSync(targetPath, content, { mode: 0o600 });

for (const directory of ["var/db", "var/storage", "var/backups"]) {
  mkdirSync(path.join(projectRoot, directory), { recursive: true, mode: 0o700 });
}

console.log("✔ .env.local dibuat dengan secret lokal baru (mode 600).");
console.log("• Folder privat var/db, var/storage, var/backups siap.");
console.log("• Jangan commit .env.local; secret ini tidak boleh dibagikan.");
