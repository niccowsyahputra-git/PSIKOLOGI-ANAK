import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, getDbReady, type AppDatabase } from "@/lib/db";
import { aiSettings, auditLogs } from "@/lib/db/domain-schema";
import { resetEnvCacheForTests } from "@/lib/env";
import { ConflictError, ValidationError } from "@/lib/errors";
import { resolveFromProjectRoot } from "@/lib/paths";
import { PermissionDeniedError } from "@/lib/permissions";
import {
  createOrganization,
  type OrganizationRow,
} from "@/server/repositories/organization.repository";
import {
  MOCK_TEST_MESSAGE,
  getAiSettings,
  getOrganizationLetterhead,
  getOrganizationProfile,
  getReadiness,
  resetAiSettings,
  testAiSettings,
  updateAiSettings,
  updateOrganizationProfileSettings,
} from "@/server/services/settings.service";
import type { StaffActor } from "@/server/services/staff.service";

let tempDir: string;
let db: AppDatabase;
let organization: OrganizationRow;
let admin: StaffActor;
let pengasuh: StaffActor;

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

/** The admin screens always submit every field, so tests mirror that. */
function profileInput(
  overrides: Partial<Parameters<typeof updateOrganizationProfileSettings>[1]["input"]> & {
    revision: number;
  },
) {
  return {
    name: "Panti Asuhan Harapan Bunda",
    address: "Jl. Melati 12, Bandung",
    phone: "+62 22 1234 567",
    email: "kontak@panti.local",
    contact: null,
    leaderName: "Ibu Sari",
    leaderTitle: "Kepala Panti",
    registrationNumber: "AHU-001",
    printNote: null,
    timezone: "Asia/Jakarta",
    ...overrides,
  };
}

function aiInput(
  overrides: Partial<Parameters<typeof updateAiSettings>[1]["input"]> & { revision: number },
) {
  return {
    mode: "mock" as const,
    providerName: "Mock lokal",
    baseUrl: null,
    model: null,
    extension: "/v1/chat/completions",
    temperature: 0.2,
    maxTokens: 2000,
    timeoutSeconds: 45,
    dailyLimit: 20,
    enabled: false,
    ...overrides,
  };
}

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "panti-settings-"));
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
    LIVE_INTAKE_ENABLED: "false",
    ALLOW_LOCAL_AI_ENDPOINT: "true",
    LOCAL_AI_ALLOWED_ENDPOINTS: "http://127.0.0.1:11434",
    BETTER_AUTH_SECRET: "c".repeat(48),
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
  resetEnvCacheForTests();

  db = await getDbReady();
  await migrate(db, { migrationsFolder: resolveFromProjectRoot("migrations") });
  organization = await createOrganization(db, {
    name: "Panti Uji Lokal",
    timezone: "Asia/Jakarta",
  });
  admin = {
    membershipId: "membership-admin",
    authUserId: "auth-admin",
    organizationId: organization.id,
    role: "admin",
  };
  pengasuh = { ...admin, membershipId: "membership-pengasuh", role: "pengasuh" };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("panti letterhead profile (FR-17)", () => {
  it("starts from the seeded organization with empty letterhead fields", async () => {
    const profile = await getOrganizationProfile(db, { actor: admin });
    expect(profile.name).toBe("Panti Uji Lokal");
    expect(profile.address).toBeNull();
    expect(profile.phone).toBeNull();
    expect(profile.revision).toBe(1);
  });

  it("refuses non-admin roles", async () => {
    await expect(getOrganizationProfile(db, { actor: pengasuh })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(
      updateOrganizationProfileSettings(db, {
        actor: pengasuh,
        input: profileInput({ revision: 1 }),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("saves the letterhead, bumps the revision and audits field names only", async () => {
    const saved = await updateOrganizationProfileSettings(db, {
      actor: admin,
      input: profileInput({ revision: 1 }),
    });

    expect(saved.name).toBe("Panti Asuhan Harapan Bunda");
    expect(saved.address).toBe("Jl. Melati 12, Bandung");
    expect(saved.phone).toBe("+62 22 1234 567");
    expect(saved.email).toBe("kontak@panti.local");
    expect(saved.leaderName).toBe("Ibu Sari");
    expect(saved.revision).toBe(2);

    const audits = await auditRowsFor("settings.general_update");
    expect(audits).toHaveLength(1);
    // `sanitizeAuditMetadata` flattens a string array into a comma-joined value.
    const changedFields = String(audits[0]!.metadata.changedFields).split(",");
    expect(changedFields).toEqual(
      expect.arrayContaining(["name", "address", "phone", "email"]),
    );
    // Unchanged fields stay out of the trail.
    expect(changedFields).not.toContain("timezone");
    // FR-16: identity values must never reach the audit trail.
    expect(audits[0]!.safeMetadata).not.toContain("Harapan Bunda");
    expect(audits[0]!.safeMetadata).not.toContain("kontak@panti.local");
  });

  it("is visible to every staff member for the dashboard and print header", async () => {
    const letterhead = await getOrganizationLetterhead(db, { actor: pengasuh });
    expect(letterhead.name).toBe("Panti Asuhan Harapan Bunda");
    expect(letterhead.address).toBe("Jl. Melati 12, Bandung");
  });

  it("clears a field when the admin empties the input", async () => {
    const current = await getOrganizationProfile(db, { actor: admin });
    const cleared = await updateOrganizationProfileSettings(db, {
      actor: admin,
      input: profileInput({ revision: current.revision, registrationNumber: null }),
    });
    expect(cleared.registrationNumber).toBeNull();
    expect(cleared.revision).toBe(current.revision + 1);
  });

  it("does not bump the revision when nothing actually changed", async () => {
    const current = await getOrganizationProfile(db, { actor: admin });
    const again = await updateOrganizationProfileSettings(db, {
      actor: admin,
      input: profileInput({ revision: current.revision, registrationNumber: null }),
    });
    expect(again.revision).toBe(current.revision);
  });

  it("rejects a stale revision instead of overwriting a concurrent edit", async () => {
    await expect(
      updateOrganizationProfileSettings(db, {
        actor: admin,
        input: profileInput({ revision: 1, name: "Nama Lain" }),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("AI configuration (FR-10)", () => {
  it("lazily creates a disabled mock configuration", async () => {
    const settings = await getAiSettings(db, { actor: admin });
    expect(settings.mode).toBe("mock");
    expect(settings.enabled).toBe(false);
    expect(settings.lastTestStatus).toBe("untested");
    expect(settings.hasApiKey).toBe(false);
    expect(settings.apiKeyMask).toBeNull();
    expect(settings.runtime.remoteAllowed).toBe(false);
  });

  it("refuses non-admin roles", async () => {
    await expect(getAiSettings(db, { actor: pengasuh })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
    await expect(testAiSettings(db, { actor: pengasuh })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it("refuses the remote provider mode while LOCAL_ONLY is true", async () => {
    const current = await getAiSettings(db, { actor: admin });
    await expect(
      updateAiSettings(db, {
        actor: admin,
        input: aiInput({ revision: current.revision, mode: "remote_endpoint" }),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to enable AI before a passing test for the same configuration", async () => {
    const current = await getAiSettings(db, { actor: admin });
    await expect(
      updateAiSettings(db, {
        actor: admin,
        input: aiInput({ revision: current.revision, enabled: true }),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("passes the mock test without any outbound request", async () => {
    const outbound = vi.fn();
    vi.stubGlobal("fetch", outbound);
    const result = await testAiSettings(db, { actor: admin });
    expect(outbound).not.toHaveBeenCalled();
    expect(result.status).toBe("passed");
    expect(result.message).toBe(MOCK_TEST_MESSAGE);
    expect(result.settings.testMatchesCurrentConfig).toBe(true);
  });

  it("allows enabling once the saved configuration has passed", async () => {
    const current = await getAiSettings(db, { actor: admin });
    const enabled = await updateAiSettings(db, {
      actor: admin,
      input: aiInput({ revision: current.revision, enabled: true }),
    });
    expect(enabled.enabled).toBe(true);
    expect(enabled.lastTestStatus).toBe("passed");
  });

  it("stores an API key encrypted and only ever returns a mask", async () => {
    const current = await getAiSettings(db, { actor: admin });
    const saved = await updateAiSettings(db, {
      actor: admin,
      input: aiInput({
        revision: current.revision,
        providerName: "Ollama lokal",
        apiKey: "sk-super-secret-value",
      }),
    });

    expect(saved.hasApiKey).toBe(true);
    expect(saved.apiKeyMask).toContain("alue");
    expect(JSON.stringify(saved)).not.toContain("sk-super-secret-value");

    const [row] = await db
      .select()
      .from(aiSettings)
      .where(eq(aiSettings.organizationId, organization.id));
    expect(row!.keyCiphertext).toBeTruthy();
    expect(row!.keyCiphertext).not.toContain("sk-super-secret-value");
    expect(row!.keyFingerprint).not.toContain("sk-super-secret-value");
  });

  it("invalidates the passing test and switches AI off when the key changes", async () => {
    const settings = await getAiSettings(db, { actor: admin });
    expect(settings.enabled).toBe(false);
    expect(settings.lastTestStatus).toBe("untested");
    expect(settings.settingsVersion).toBeGreaterThan(1);
  });

  it("refuses a masked value pasted back as the API key", async () => {
    const current = await getAiSettings(db, { actor: admin });
    await expect(
      updateAiSettings(db, {
        actor: admin,
        input: aiInput({
          revision: current.revision,
          apiKey: current.apiKeyMask ?? "••••1234",
        }),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("preserves the stored key when no key field is submitted", async () => {
    const current = await getAiSettings(db, { actor: admin });
    const saved = await updateAiSettings(db, {
      actor: admin,
      input: aiInput({ revision: current.revision, dailyLimit: 30 }),
    });
    expect(saved.hasApiKey).toBe(true);
    expect(saved.dailyLimit).toBe(30);

    const audits = await auditRowsFor("settings.ai_update");
    expect(audits[0]!.metadata.credentialAction).toBe("preserved");
  });

  it("requires a URL and model for the local endpoint mode", async () => {
    const current = await getAiSettings(db, { actor: admin });
    await expect(
      updateAiSettings(db, {
        actor: admin,
        input: aiInput({ revision: current.revision, mode: "local_endpoint" }),
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      updateAiSettings(db, {
        actor: admin,
        input: aiInput({
          revision: current.revision,
          mode: "local_endpoint",
          baseUrl: "http://127.0.0.1:11434",
        }),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a local endpoint outside the server allowlist", async () => {
    const current = await getAiSettings(db, { actor: admin });
    await expect(
      updateAiSettings(db, {
        actor: admin,
        input: aiInput({
          revision: current.revision,
          mode: "local_endpoint",
          baseUrl: "http://127.0.0.1:9999",
          model: "llama3",
        }),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("accepts an allowlisted local endpoint but leaves it untested", async () => {
    const current = await getAiSettings(db, { actor: admin });
    const saved = await updateAiSettings(db, {
      actor: admin,
      input: aiInput({
        revision: current.revision,
        mode: "local_endpoint",
        providerName: "Ollama lokal",
        baseUrl: "http://127.0.0.1:11434",
        model: "llama3",
      }),
    });
    expect(saved.mode).toBe("local_endpoint");
    expect(saved.enabled).toBe(false);
    expect(saved.lastTestStatus).toBe("untested");
    expect(saved.testMatchesCurrentConfig).toBe(false);
  });

  it("tests the endpoint with a bounded synthetic prompt and enables the exact configuration", async () => {
    const outbound = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "siap" } }] })),
    );
    vi.stubGlobal("fetch", outbound);
    const result = await testAiSettings(db, { actor: admin });
    expect(result.status).toBe("passed");
    expect(result.settings.testMatchesCurrentConfig).toBe(true);
    expect(outbound).toHaveBeenCalledTimes(1);
    const [url, options] = outbound.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(options?.redirect).toBe("error");
    expect(options?.cache).toBe("no-store");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.headers).toMatchObject({ Authorization: "Bearer sk-super-secret-value" });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      model: "llama3", max_tokens: 64, stream: false,
      messages: [{ role: "system" }, { role: "user", content: "Balas dengan kata: siap" }],
    });
    const enabled = await updateAiSettings(db, {
      actor: admin, input: { ...result.settings, enabled: true },
    });
    expect(enabled.enabled).toBe(true);
  });

  it("rejects reusing a test after even a fractional option change", async () => {
    const current = await getAiSettings(db, { actor: admin });
    await expect(updateAiSettings(db, {
      actor: admin, input: { ...current, temperature: 0.201 },
    })).rejects.toBeInstanceOf(ValidationError);
    const saved = await updateAiSettings(db, {
      actor: admin, input: { ...current, temperature: 0.201, enabled: false },
    });
    expect(saved.lastTestStatus).toBe("untested");
    expect(saved.testMatchesCurrentConfig).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "siap" } }] })),
    ));
    const retested = await testAiSettings(db, { actor: admin });
    await updateAiSettings(db, { actor: admin, input: { ...retested.settings, enabled: true } });
  });

  it("records a failed test and switches enabled AI off when the endpoint is unreachable", async () => {
    expect((await getAiSettings(db, { actor: admin })).enabled).toBe(true);
    const outbound = vi.fn().mockRejectedValue(new Error("connection refused"));
    vi.stubGlobal("fetch", outbound);
    const result = await testAiSettings(db, { actor: admin });
    expect(outbound).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("failed");
    expect(result.settings.enabled).toBe(false);
    expect(result.settings.lastTestStatus).toBe("failed");
    // The message must stay short and must not leak the key or raw stack.
    expect(result.message).not.toContain("sk-");

    const audits = await auditRowsFor("settings.ai_test");
    expect(audits[0]!.metadata.testStatus).toBe("failed");
  });

  it("resets to mock while keeping the stored key unless asked", async () => {
    const reset = await resetAiSettings(db, { actor: admin, clearApiKey: false });
    expect(reset.mode).toBe("mock");
    expect(reset.baseUrl).toBeNull();
    expect(reset.model).toBeNull();
    expect(reset.enabled).toBe(false);
    expect(reset.hasApiKey).toBe(true);

    const audits = await auditRowsFor("settings.ai_reset");
    expect(audits[0]!.metadata.credentialAction).toBe("preserved");
  });

  it("clears the stored key when the admin confirms it", async () => {
    const reset = await resetAiSettings(db, { actor: admin, clearApiKey: true });
    expect(reset.hasApiKey).toBe(false);
    expect(reset.apiKeyMask).toBeNull();

    const [row] = await db
      .select()
      .from(aiSettings)
      .where(eq(aiSettings.organizationId, organization.id));
    expect(row!.keyCiphertext).toBeNull();
    expect(row!.keyVersion).toBeNull();
    expect(row!.keyFingerprint).toBeNull();
  });
});

describe("readiness report (FR-17)", () => {
  it("reports a complete letterhead, local storage and mock AI", async () => {
    const readiness = await getReadiness(db, { actor: admin });
    const byKey = new Map(readiness.checks.map((check) => [check.key, check]));

    expect(byKey.get("letterhead")?.status).toBe("ok");
    expect(byKey.get("storage")?.status).toBe("ok");
    expect(byKey.get("ai")?.status).toBe("ok");
    // Real intake stays off in this phase, which is the safe state.
    expect(readiness.liveIntakeEnabled).toBe(false);
    expect(byKey.get("live_intake")?.status).toBe("ok");
  });

  it("flags an incomplete letterhead", async () => {
    const current = await getOrganizationProfile(db, { actor: admin });
    await updateOrganizationProfileSettings(db, {
      actor: admin,
      input: profileInput({
        revision: current.revision,
        address: null,
        phone: null,
        email: null,
        registrationNumber: null,
      }),
    });

    const readiness = await getReadiness(db, { actor: admin });
    const letterhead = readiness.checks.find((check) => check.key === "letterhead");
    expect(letterhead?.status).toBe("attention");
  });

  it("refuses non-admin roles", async () => {
    await expect(getReadiness(db, { actor: pengasuh })).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });
});
