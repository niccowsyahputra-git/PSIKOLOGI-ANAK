import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated as plain SQL into `migrations/` so the same files can
 * later be applied to a cloud libSQL database after a separately approved cloud
 * phase (section 20.5). Applying them locally is done by
 * `npm run db:migrate` (drizzle-orm/libsql/migrator), not by drizzle-kit.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./migrations",
  strict: true,
  verbose: true,
});
