import { afterEach, describe, expect, it } from "vitest";
import { ConfigurationError, getEnv, resetEnvCacheForTests } from "@/lib/env";

const MANAGED_KEYS = [
  "NODE_ENV",
  "APP_MODE",
  "LOCAL_ONLY",
  "APP_BASE_URL",
  "BETTER_AUTH_URL",
  "DATABASE_PROVIDER",
  "DATABASE_URL",
  "STORAGE_PROVIDER",
  "LOCAL_STORAGE_ROOT",
  "BACKUP_ROOT",
  "AI_MODE",
  "ALLOW_LOCAL_AI_ENDPOINT",
  "LOCAL_AI_ALLOWED_ENDPOINTS",
  "LIVE_INTAKE_ENABLED",
  "BETTER_AUTH_SECRET",
  "APP_ENCRYPTION_KEY",
  "APP_ENCRYPTION_KEY_VERSION",
] as const;

const validConfig: Record<string, string | undefined> = {
  NODE_ENV: "test",
  APP_MODE: "local-development",
  LOCAL_ONLY: "true",
  APP_BASE_URL: "http://localhost:3000",
  BETTER_AUTH_URL: "http://localhost:3000",
  DATABASE_PROVIDER: "local",
  DATABASE_URL: "file:./var/db/test.db",
  STORAGE_PROVIDER: "local",
  LOCAL_STORAGE_ROOT: "./var/storage",
  BACKUP_ROOT: "./var/backups",
  AI_MODE: "mock",
  ALLOW_LOCAL_AI_ENDPOINT: "false",
  LOCAL_AI_ALLOWED_ENDPOINTS: "",
  LIVE_INTAKE_ENABLED: "false",
  BETTER_AUTH_SECRET: "a".repeat(48),
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
  APP_ENCRYPTION_KEY_VERSION: "1",
};

function applyEnv(overrides: Record<string, string | undefined> = {}): void {
  for (const key of MANAGED_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries({ ...validConfig, ...overrides })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetEnvCacheForTests();
}

afterEach(() => {
  for (const key of MANAGED_KEYS) delete process.env[key];
  resetEnvCacheForTests();
});

describe("local environment contract", () => {
  it("resolves relative paths to absolute ones and reports local-only mode", () => {
    applyEnv();
    const env = getEnv();

    expect(env.localOnly).toBe(true);
    expect(env.appMode).toBe("local-development");
    expect(env.database.url.startsWith("file:")).toBe(true);
    expect(env.database.absolutePath.startsWith("/")).toBe(true);
    expect(env.storage.rootAbsolutePath.startsWith("/")).toBe(true);
    expect(env.backup.rootAbsolutePath.startsWith("/")).toBe(true);
    expect(env.ai.mode).toBe("mock");
    expect(env.liveIntakeEnabled).toBe(false);
    expect(env.secrets.encryptionKey).toHaveLength(32);
  });

  it("caches the parsed configuration until the cache is reset", () => {
    applyEnv();
    const first = getEnv();
    process.env.APP_BASE_URL = "http://127.0.0.1:4000";
    expect(getEnv()).toBe(first);

    resetEnvCacheForTests();
    expect(getEnv().appBaseUrl).toBe("http://127.0.0.1:4000");
  });

  it("refuses to run with LOCAL_ONLY disabled", () => {
    applyEnv({ LOCAL_ONLY: "false" });
    expect(() => getEnv()).toThrow(ConfigurationError);
  });

  it("refuses a non-file database URL", () => {
    applyEnv({ DATABASE_URL: "libsql://remote-example.turso.io" });
    expect(() => getEnv()).toThrow(/file:/);
  });

  it("refuses a remote AI provider while local-only", () => {
    applyEnv({ AI_MODE: "remote_endpoint" });
    expect(() => getEnv()).toThrow(ConfigurationError);
  });

  it("refuses a local AI endpoint without an explicit opt-in", () => {
    applyEnv({ AI_MODE: "local_endpoint" });
    expect(() => getEnv()).toThrow(ConfigurationError);
  });

  it("accepts a local AI endpoint once it is allow-listed", () => {
    applyEnv({
      AI_MODE: "local_endpoint",
      ALLOW_LOCAL_AI_ENDPOINT: "true",
      LOCAL_AI_ALLOWED_ENDPOINTS: "http://127.0.0.1:11434",
    });
    const env = getEnv();
    expect(env.ai.mode).toBe("local_endpoint");
    expect(env.ai.allowedEndpointOrigins).toContain("http://127.0.0.1:11434");
  });

  it("rejects placeholder secrets", () => {
    applyEnv({ BETTER_AUTH_SECRET: "replace-with-local-secret" });
    expect(() => getEnv()).toThrow(/placeholder/);
  });

  it("rejects an encryption key that is not 32 bytes", () => {
    applyEnv({ APP_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString("base64") });
    expect(() => getEnv()).toThrow(/32 byte/);
  });
});
