import path from "node:path";
import { z } from "zod";
import { resolveFromProjectRoot } from "./paths";

/**
 * Configuration for the local-first phase (PRD-PANTI-001 section 1.2 DEC-02,
 * DEC-04, DEC-05 and section 20.2). Every value here is deliberately local:
 * a `file:` database, a filesystem storage root and a mock/local AI runtime.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const PLACEHOLDER_PATTERNS = [
  /replace-with/i,
  /generate-strong-local-secret/i,
  /generate-32-byte-key/i,
  /^changeme$/i,
  /^secret$/i,
  /^password$/i,
];

const booleanString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const trimmedString = z.string().trim();

function decodeBase64Key(value: string): Buffer {
  return Buffer.from(value, "base64");
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_MODE: z.literal("local-development"),
  LOCAL_ONLY: booleanString.default(true),
  APP_BASE_URL: trimmedString.default("http://localhost:3000"),
  BETTER_AUTH_URL: trimmedString.default("http://localhost:3000"),

  DATABASE_PROVIDER: z.literal("local"),
  DATABASE_URL: trimmedString.refine(
    (value) => value.startsWith("file:"),
    "DATABASE_URL must be a local `file:` URL while LOCAL_ONLY=true",
  ),

  STORAGE_PROVIDER: z.literal("local"),
  LOCAL_STORAGE_ROOT: trimmedString.default("./var/storage"),
  BACKUP_ROOT: trimmedString.default("./var/backups"),

  AI_MODE: z.enum(["mock", "local_endpoint", "remote_endpoint"]).default("mock"),
  ALLOW_LOCAL_AI_ENDPOINT: booleanString.default(false),
  LOCAL_AI_ALLOWED_ENDPOINTS: trimmedString.default(""),

  LIVE_INTAKE_ENABLED: booleanString.default(false),

  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters")
    .refine(
      (value) => !PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value)),
      "BETTER_AUTH_SECRET still contains a placeholder value",
    ),
  APP_ENCRYPTION_KEY: z
    .string()
    .refine(
      (value) => decodeBase64Key(value).length === 32,
      "APP_ENCRYPTION_KEY must be a base64 encoded 32 byte key",
    )
    .refine(
      (value) => !PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value)),
      "APP_ENCRYPTION_KEY still contains a placeholder value",
    ),
  APP_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),
});

export type AppEnv = {
  nodeEnv: "development" | "test" | "production";
  appMode: "local-development";
  localOnly: true;
  appBaseUrl: string;
  betterAuthUrl: string;
  database: {
    provider: "local";
    /** Absolute `file:` URL, stable across dev, build, start and scripts. */
    url: string;
    absolutePath: string;
  };
  storage: {
    provider: "local";
    rootAbsolutePath: string;
  };
  backup: {
    rootAbsolutePath: string;
  };
  ai: {
    mode: "mock" | "local_endpoint" | "remote_endpoint";
    allowLocalEndpoint: boolean;
    allowedEndpointOrigins: readonly string[];
  };
  liveIntakeEnabled: boolean;
  secrets: {
    betterAuthSecret: string;
    encryptionKey: Buffer;
    encryptionKeyVersion: number;
  };
};

let cachedEnv: AppEnv | null = null;

function parseAllowedEndpoints(raw: string): string[] {
  if (raw.length === 0) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(entry);
      } catch {
        throw new ConfigurationError(
          `LOCAL_AI_ALLOWED_ENDPOINTS entry is not a valid URL: ${entry}`,
        );
      }
      if (parsedUrl.username || parsedUrl.password) {
        throw new ConfigurationError(
          "LOCAL_AI_ALLOWED_ENDPOINTS must not embed credentials in the URL",
        );
      }
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new ConfigurationError(
          "LOCAL_AI_ALLOWED_ENDPOINTS only supports http:// or https:// loopback origins",
        );
      }
      return parsedUrl.origin;
    });
}

function assertLocalOnlyAppliance(env: AppEnv): void {
  if (env.database.provider !== "local") {
    throw new ConfigurationError(
      "DATABASE_PROVIDER must be `local`; remote Turso databases are refused while LOCAL_ONLY=true",
    );
  }
  if (env.storage.provider !== "local") {
    throw new ConfigurationError(
      "STORAGE_PROVIDER must be `local`; cloud storage adapters are not part of this phase",
    );
  }
  if (env.ai.mode === "remote_endpoint") {
    throw new ConfigurationError(
      "AI_MODE=remote_endpoint is refused while LOCAL_ONLY=true; only mock and loopback endpoints are allowed",
    );
  }
  if (env.ai.mode === "local_endpoint" && !env.ai.allowLocalEndpoint) {
    throw new ConfigurationError(
      "AI_MODE=local_endpoint requires ALLOW_LOCAL_AI_ENDPOINT=true and an allowlisted loopback origin",
    );
  }
}

function buildEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new ConfigurationError(
      `Invalid local configuration. Check .env.local against .env.example. ${details}`,
    );
  }
  const raw = parsed.data;

  // The local-only switch is checked on the raw value, before `AppEnv` pins it
  // to `true`, so a mistaken `.env.local` can never start a cloud-capable build.
  if (!raw.LOCAL_ONLY) {
    throw new ConfigurationError(
      "LOCAL_ONLY=false is not supported by this build; cloud phases require a separate approved change",
    );
  }

  const databaseUrlPath = raw.DATABASE_URL.replace(/^file:/, "");
  const databaseAbsolutePath = path.isAbsolute(databaseUrlPath)
    ? databaseUrlPath
    : resolveFromProjectRoot(databaseUrlPath);

  const env: AppEnv = {
    nodeEnv: raw.NODE_ENV,
    appMode: raw.APP_MODE,
    localOnly: true,
    appBaseUrl: raw.APP_BASE_URL,
    betterAuthUrl: raw.BETTER_AUTH_URL,
    database: {
      provider: "local",
      url: `file:${databaseAbsolutePath}`,
      absolutePath: databaseAbsolutePath,
    },
    storage: {
      provider: "local",
      rootAbsolutePath: resolveFromProjectRoot(raw.LOCAL_STORAGE_ROOT),
    },
    backup: {
      rootAbsolutePath: resolveFromProjectRoot(raw.BACKUP_ROOT),
    },
    ai: {
      mode: raw.AI_MODE,
      allowLocalEndpoint: raw.ALLOW_LOCAL_AI_ENDPOINT,
      allowedEndpointOrigins: parseAllowedEndpoints(raw.LOCAL_AI_ALLOWED_ENDPOINTS),
    },
    liveIntakeEnabled: raw.LIVE_INTAKE_ENABLED,
    secrets: {
      betterAuthSecret: raw.BETTER_AUTH_SECRET,
      encryptionKey: decodeBase64Key(raw.APP_ENCRYPTION_KEY),
      encryptionKeyVersion: raw.APP_ENCRYPTION_KEY_VERSION,
    },
  };

  assertLocalOnlyAppliance(env);
  return Object.freeze(env);
}

export function getEnv(): AppEnv {
  if (cachedEnv === null) {
    cachedEnv = buildEnv();
  }
  return cachedEnv;
}

/** Test helper: allows a fresh read after mutating `process.env` or `.env.local`. */
export function resetEnvCacheForTests(): void {
  cachedEnv = null;
}
