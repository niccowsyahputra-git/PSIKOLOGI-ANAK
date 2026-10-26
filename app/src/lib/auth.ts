import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "./db";
import * as schema from "./db/schema";
import { getEnv } from "./env";

/**
 * Better Auth is the only owner of credentials and sessions (DEC-03).
 * Public signup is disabled: staff accounts are created by an authorized admin
 * or by `npm run bootstrap:admin` (FR-01).
 */
/**
 * Single source of truth for auth options. Exported so the schema generator
 * (scripts/auth-schema-config.ts) cannot drift from the runtime configuration.
 */
export function createAuthOptions() {
  const env = getEnv();
  const isHttps = new URL(env.appBaseUrl).protocol === "https:";

  return {
    appName: "Asesmen Psikososial Panti",
    baseURL: env.betterAuthUrl,
    basePath: "/api/auth",
    secret: env.secrets.betterAuthSecret,
    trustedOrigins: [env.appBaseUrl],
    database: drizzleAdapter(getDb(), {
      provider: "sqlite",
      schema,
      transaction: true,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      // Short lived sessions: role or activation changes must take effect at
      // the next request, so no cookie cache is used (FR-01, FR-16).
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 30,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-out": { window: 60, max: 10 },
      },
    },
    advanced: {
      useSecureCookies: isHttps,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax" as const,
        secure: isHttps,
        path: "/",
      },
      database: { generateId: () => randomUUID() },
    },
    plugins: [nextCookies()],
  };
}

function buildAuth() {
  return betterAuth(createAuthOptions());
}

export type AuthInstance = ReturnType<typeof buildAuth>;

let authInstance: AuthInstance | null = null;

/**
 * Lazily built so `next build`, scripts and tests never touch the database or
 * secrets at module import time.
 */
export function getAuth(): AuthInstance {
  if (authInstance === null) {
    authInstance = buildAuth();
  }
  return authInstance;
}

export function resetAuthForTests(): void {
  authInstance = null;
}
