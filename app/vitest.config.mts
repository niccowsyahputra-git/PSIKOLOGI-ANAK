import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

/**
 * Unit tests run against plain modules (no Next.js runtime); integration tests
 * open a throwaway SQLite file and apply the real migrations from `migrations/`.
 * The `.mts` extension keeps this file ESM regardless of `package.json`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": srcDir },
  },
});
