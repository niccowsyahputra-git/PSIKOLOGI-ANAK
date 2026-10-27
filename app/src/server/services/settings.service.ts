import {
  aiConfigFingerprint,
  apiKeyFingerprint,
  assertSafeLocalAiEndpoint,
  buildAiRequestUrl,
  looksLikeMaskedKey,
} from "@/lib/ai/config";
import { maskSecret, openSecret, sealSecret } from "@/lib/crypto";
import type { AppDatabase } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertCan } from "@/lib/permissions";
import type {
  AiSettingsUpdateInput,
  GeneralSettingsInput,
} from "@/lib/validation/settings.schema";
import {
  ensureAiSettings,
  updateAiSettingsRow,
  type AiSettingsPatch,
  type AiSettingsRow,
} from "@/server/repositories/ai-settings.repository";
import {
  findOrganizationById,
  updateOrganizationProfile,
  type OrganizationProfilePatch,
  type OrganizationRow,
} from "@/server/repositories/organization.repository";
import { recordAudit } from "./audit.service";
import type { StaffActor } from "./staff.service";

/**
 * Admin configuration services: the panti letterhead (FR-17) and the dynamic AI
 * configuration stored in the local database (FR-10). Nothing here performs an
 * outbound request except the explicit loopback connection test.
 */

export const MOCK_TEST_MESSAGE =
  "Mock lokal siap — tidak menguji provider AI nyata";

export type OrganizationProfileView = {
  id: string;
  name: string;
  address: string | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  leaderName: string | null;
  leaderTitle: string | null;
  registrationNumber: string | null;
  printNote: string | null;
  timezone: string;
  revision: number;
  updatedAt: string;
};

export type AiSettingsView = {
  mode: AiSettingsRow["mode"];
  providerName: string;
  baseUrl: string | null;
  model: string | null;
  extension: string;
  temperature: number;
  maxTokens: number;
  timeoutSeconds: number;
  dailyLimit: number;
  enabled: boolean;
  settingsVersion: number;
  promptVersion: string;
  revision: number;
  /** PRD section 10.2: metadata only, never the key or a usable substitute. */
  hasApiKey: boolean;
  apiKeyMask: string | null;
  lastTestStatus: AiSettingsRow["lastTestStatus"];
  lastTestAt: string | null;
  testMatchesCurrentConfig: boolean;
  runtime: {
    envMode: string;
    localOnly: boolean;
    remoteAllowed: boolean;
    allowLocalEndpoint: boolean;
    allowedEndpointOrigins: string[];
  };
};

export type AiTestResult = {
  status: "passed" | "failed";
  message: string;
  mode: AiSettingsRow["mode"];
  settings: AiSettingsView;
};

function toProfileView(row: OrganizationRow): OrganizationProfileView {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    contact: row.contact,
    phone: row.phone,
    email: row.email,
    leaderName: row.leaderName,
    leaderTitle: row.leaderTitle,
    registrationNumber: row.registrationNumber,
    printNote: row.printNote,
    timezone: row.timezone,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function fingerprintOf(row: AiSettingsRow): string {
  return aiConfigFingerprint({
    mode: row.mode,
    baseUrl: row.baseUrl,
    model: row.model,
    extension: row.extension,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    timeoutSeconds: row.timeoutSeconds,
    keyFingerprint: row.keyFingerprint,
  });
}

/** Decryption happens server-side only, to build the mask for the admin screen. */
function maskStoredKey(row: AiSettingsRow): string | null {
  if (!row.keyCiphertext) return null;
  try {
    return maskSecret(openSecret(row.keyCiphertext));
  } catch {
    // A rotated master key leaves the ciphertext unreadable; say so instead of
    // pretending the stored key is usable.
    return "tidak dapat dibaca dengan kunci saat ini";
  }
}

function toAiView(row: AiSettingsRow): AiSettingsView {
  const env = getEnv();
  return {
    mode: row.mode,
    providerName: row.providerName,
    baseUrl: row.baseUrl,
    model: row.model,
    extension: row.extension,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    timeoutSeconds: row.timeoutSeconds,
    dailyLimit: row.dailyLimit,
    enabled: row.enabled,
    settingsVersion: row.settingsVersion,
    promptVersion: row.promptVersion,
    revision: row.revision,
    hasApiKey: row.keyCiphertext !== null,
    apiKeyMask: maskStoredKey(row),
    lastTestStatus: row.lastTestStatus,
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
    testMatchesCurrentConfig:
      row.lastTestStatus === "passed" && row.lastTestFingerprint === fingerprintOf(row),
    runtime: {
      envMode: env.ai.mode,
      localOnly: env.localOnly,
      remoteAllowed: false,
      allowLocalEndpoint: env.ai.allowLocalEndpoint,
      allowedEndpointOrigins: [...env.ai.allowedEndpointOrigins],
    },
  };
}

export async function getOrganizationProfile(
  db: AppDatabase,
  params: { actor: StaffActor },
): Promise<OrganizationProfileView> {
  assertCan(params.actor.role, "admin.general_settings");
  const row = await findOrganizationById(db, params.actor.organizationId);
  if (!row) {
    throw new NotFoundError("Profil panti tidak ditemukan pada instalasi ini");
  }
  return toProfileView(row);
}

export async function updateOrganizationProfileSettings(
  db: AppDatabase,
  params: { actor: StaffActor; input: GeneralSettingsInput },
): Promise<OrganizationProfileView> {
  const { actor, input } = params;
  assertCan(actor.role, "admin.general_settings");

  const current = await findOrganizationById(db, actor.organizationId);
  if (!current) {
    throw new NotFoundError("Profil panti tidak ditemukan pada instalasi ini");
  }
  if (current.revision !== input.revision) {
    throw new ConflictError(
      "Profil panti sudah diubah di sesi lain. Muat ulang halaman sebelum menyimpan.",
    );
  }

  const patch: OrganizationProfilePatch = {
    name: input.name,
    address: input.address,
    contact: input.contact,
    phone: input.phone,
    email: input.email,
    leaderName: input.leaderName,
    leaderTitle: input.leaderTitle,
    registrationNumber: input.registrationNumber,
    printNote: input.printNote,
    timezone: input.timezone,
  };
  const changedFields = (Object.keys(patch) as Array<keyof OrganizationProfilePatch>).filter(
    (field) => current[field] !== patch[field],
  );
  if (changedFields.length === 0) {
    return toProfileView(current);
  }

  const updated = await updateOrganizationProfile(db, {
    organizationId: actor.organizationId,
    expectedRevision: input.revision,
    patch,
  });
  if (!updated) {
    throw new ConflictError(
      "Profil panti sudah diubah di sesi lain. Muat ulang halaman sebelum menyimpan.",
    );
  }

  await recordAudit(db, {
    organizationId: actor.organizationId,
    actor: { type: "staff", membershipId: actor.membershipId },
    action: "settings.general_update",
    entityType: "organization",
    entityId: updated.id,
    // Field names only; the values themselves are panti identity data (FR-16).
    metadata: { changedFields, revision: updated.revision },
  });

  return toProfileView(updated);
}

export async function getAiSettings(
  db: AppDatabase,
  params: { actor: StaffActor },
): Promise<AiSettingsView> {
  assertCan(params.actor.role, "admin.ai_settings");
  const row = await ensureAiSettings(db, params.actor.organizationId);
  return toAiView(row);
}

function assertModeIsAvailable(mode: AiSettingsRow["mode"]): void {
  const env = getEnv();
  if (mode === "remote_endpoint") {
    throw new ValidationError(
      "Mode penyedia AI jarak jauh ditolak selama LOCAL_ONLY=true. Fase remote memerlukan persetujuan terpisah.",
      {
        mode: [
          "Hanya mode mock dan endpoint lokal yang tersedia pada instalasi ini.",
        ],
      },
    );
  }
  if (mode === "local_endpoint" && !env.ai.allowLocalEndpoint) {
    throw new ValidationError(
      "Endpoint AI lokal belum diizinkan oleh konfigurasi server.",
      {
        mode: [
          "Setel ALLOW_LOCAL_AI_ENDPOINT=true dan LOCAL_AI_ALLOWED_ENDPOINTS di .env.local, lalu mulai ulang server.",
        ],
      },
    );
  }
}

function assertRealEndpointConfig(row: {
  baseUrl: string | null;
  model: string | null;
  extension: string;
}): URL {
  const env = getEnv();
  const base = assertSafeLocalAiEndpoint(row.baseUrl, env.ai.allowedEndpointOrigins);
  if (!row.model || row.model.trim().length === 0) {
    throw new ValidationError("Nama model wajib diisi untuk endpoint lokal", {
      model: ["Isi nama model yang dilayani endpoint lokal Anda."],
    });
  }
  return buildAiRequestUrl(base, row.extension);
}

export async function updateAiSettings(
  db: AppDatabase,
  params: { actor: StaffActor; input: AiSettingsUpdateInput },
): Promise<AiSettingsView> {
  const { actor, input } = params;
  assertCan(actor.role, "admin.ai_settings");

  const current = await ensureAiSettings(db, actor.organizationId);
  if (current.revision !== input.revision) {
    throw new ConflictError(
      "Konfigurasi AI sudah diubah di sesi lain. Muat ulang halaman sebelum menyimpan.",
    );
  }

  assertModeIsAvailable(input.mode);

  let keyCiphertext = current.keyCiphertext;
  let keyVersion = current.keyVersion;
  let keyFingerprint = current.keyFingerprint;
  let credentialAction: "preserved" | "replaced" | "cleared" = "preserved";

  if (input.clearApiKey === true) {
    keyCiphertext = null;
    keyVersion = null;
    keyFingerprint = null;
    credentialAction = "cleared";
  } else if (input.apiKey !== undefined) {
    if (looksLikeMaskedKey(input.apiKey)) {
      throw new ValidationError("Nilai bertopeng bukan API key", {
        apiKey: [
          "Tempelkan API key asli, atau biarkan kosong untuk mempertahankan key yang tersimpan.",
        ],
      });
    }
    keyCiphertext = sealSecret(input.apiKey);
    keyVersion = getEnv().secrets.encryptionKeyVersion;
    keyFingerprint = apiKeyFingerprint(input.apiKey);
    credentialAction = "replaced";
  }

  const next = {
    mode: input.mode,
    providerName: input.providerName,
    baseUrl: input.baseUrl,
    model: input.model,
    extension: input.extension,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    timeoutSeconds: input.timeoutSeconds,
    keyFingerprint,
  };

  if (input.mode === "local_endpoint") {
    assertRealEndpointConfig(next);
  }

  const previousFingerprint = fingerprintOf(current);
  const nextFingerprint = aiConfigFingerprint(next);
  const configChanged = nextFingerprint !== previousFingerprint;

  // FR-10: enabling requires a passed test for exactly this configuration.
  const testStillValid =
    !configChanged &&
    current.lastTestStatus === "passed" &&
    current.lastTestFingerprint === nextFingerprint;

  if (input.enabled && !testStillValid) {
    throw new ValidationError(
      "Konfigurasi ini belum lulus uji, jadi AI tidak dapat diaktifkan.",
      {
        enabled: [
          "Simpan konfigurasi, jalankan tombol uji koneksi, lalu aktifkan setelah hasilnya lulus.",
        ],
      },
    );
  }

  const patch: AiSettingsPatch = {
    ...next,
    keyCiphertext,
    keyVersion,
    dailyLimit: input.dailyLimit,
    enabled: input.enabled,
    settingsVersion: configChanged
      ? current.settingsVersion + 1
      : current.settingsVersion,
    lastTestStatus: configChanged ? "untested" : current.lastTestStatus,
    lastTestFingerprint: configChanged ? null : current.lastTestFingerprint,
    lastTestAt: configChanged ? null : current.lastTestAt,
  };

  const updated = await updateAiSettingsRow(db, {
    organizationId: actor.organizationId,
    expectedRevision: input.revision,
    patch,
  });
  if (!updated) {
    throw new ConflictError(
      "Konfigurasi AI sudah diubah di sesi lain. Muat ulang halaman sebelum menyimpan.",
    );
  }

  await recordAudit(db, {
    organizationId: actor.organizationId,
    actor: { type: "staff", membershipId: actor.membershipId },
    action: "settings.ai_update",
    entityType: "ai_settings",
    entityId: updated.id,
    metadata: {
      aiMode: updated.mode,
      aiEnabledState: updated.enabled ? "enabled" : "disabled",
      credentialAction,
      settingsVersion: updated.settingsVersion,
      testStatus: updated.lastTestStatus,
      revision: updated.revision,
    },
  });

  return toAiView(updated);
}

type ProbeOutcome = { ok: boolean; message: string };

/**
 * Bounded synthetic request to the allowlisted loopback endpoint (PRD 11.2):
 * one call, no retry, redirects refused, fictional prompt, short output.
 */
async function probeLocalEndpoint(row: AiSettingsRow): Promise<ProbeOutcome> {
  const target = assertRealEndpointConfig(row);
  let apiKey: string | null = null;
  if (row.keyCiphertext) {
    try {
      apiKey = openSecret(row.keyCiphertext);
    } catch {
      return {
        ok: false,
        message:
          "API key tersimpan tidak dapat dibaca dengan kunci enkripsi saat ini. Masukkan ulang key.",
      };
    }
  }

  try {
    const response = await fetch(target, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(row.timeoutSeconds * 1000),
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: row.model,
        temperature: row.temperature,
        max_tokens: Math.min(row.maxTokens, 64),
        stream: false,
        messages: [
          {
            role: "system",
            content:
              "Ini uji koneksi konfigurasi lokal, bukan permintaan analisis. Jawab satu kata.",
          },
          { role: "user", content: "Balas dengan kata: siap" },
        ],
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        message: `Layanan lokal menjawab status ${response.status}. Periksa model dan API key.`,
      };
    }

    const payload: unknown = await response.json();
    const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
      ?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return {
        ok: false,
        message:
          "Layanan merespons tetapi formatnya tidak sesuai API chat completions.",
      };
    }
    return {
      ok: true,
      message: `Endpoint lokal ${target.origin} merespons dengan model ${row.model}. Hasil nyata tetap bukan diagnosis dan tetap perlu review.`,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return {
        ok: false,
        message: `Tidak ada respons dalam ${row.timeoutSeconds} detik. Pastikan layanan lokal berjalan.`,
      };
    }
    return {
      ok: false,
      message: `Endpoint ${target.origin} tidak dapat dihubungi dari server lokal ini.`,
    };
  }
}

/**
 * Tests the saved configuration. The prompt is synthetic and fictional, and the
 * result is bound to the configuration fingerprint so a later change to the
 * URL, model, key or tested options invalidates it (PRD section 10.2).
 */
export async function testAiSettings(
  db: AppDatabase,
  params: { actor: StaffActor },
): Promise<AiTestResult> {
  const { actor } = params;
  assertCan(actor.role, "admin.ai_settings");

  const current = await ensureAiSettings(db, actor.organizationId);
  assertModeIsAvailable(current.mode);

  const outcome: ProbeOutcome =
    current.mode === "mock"
      ? { ok: true, message: MOCK_TEST_MESSAGE }
      : await probeLocalEndpoint(current);

  const fingerprint = fingerprintOf(current);
  const status = outcome.ok ? "passed" : "failed";
  const updated = await updateAiSettingsRow(db, {
    organizationId: actor.organizationId,
    expectedRevision: current.revision,
    patch: {
      lastTestStatus: status,
      lastTestFingerprint: outcome.ok ? fingerprint : null,
      lastTestAt: new Date(),
      // A failed test can never leave AI switched on.
      enabled: outcome.ok ? current.enabled : false,
    },
  });
  if (!updated) {
    throw new ConflictError(
      "Konfigurasi AI berubah saat pengujian berjalan. Muat ulang halaman lalu uji kembali.",
    );
  }

  await recordAudit(db, {
    organizationId: actor.organizationId,
    actor: { type: "staff", membershipId: actor.membershipId },
    action: "settings.ai_test",
    entityType: "ai_settings",
    entityId: updated.id,
    metadata: {
      aiMode: updated.mode,
      testStatus: status,
      settingsVersion: updated.settingsVersion,
    },
  });

  return {
    status,
    message: outcome.message,
    mode: updated.mode,
    settings: toAiView(updated),
  };
}

/**
 * FR-10: the reset turns AI off and clears the non-secret configuration. The
 * stored key is only removed when the admin confirms it explicitly.
 */
export async function resetAiSettings(
  db: AppDatabase,
  params: { actor: StaffActor; clearApiKey: boolean },
): Promise<AiSettingsView> {
  const { actor } = params;
  assertCan(actor.role, "admin.ai_settings");

  const current = await ensureAiSettings(db, actor.organizationId);
  const updated = await updateAiSettingsRow(db, {
    organizationId: actor.organizationId,
    expectedRevision: current.revision,
    patch: {
      mode: "mock",
      providerName: "Mock lokal",
      baseUrl: null,
      model: null,
      extension: "/v1/chat/completions",
      temperature: 0.2,
      maxTokens: 2000,
      timeoutSeconds: 45,
      dailyLimit: 20,
      enabled: false,
      settingsVersion: current.settingsVersion + 1,
      lastTestStatus: "untested",
      lastTestFingerprint: null,
      lastTestAt: null,
      ...(params.clearApiKey
        ? { keyCiphertext: null, keyVersion: null, keyFingerprint: null }
        : {}),
    },
  });
  if (!updated) {
    throw new ConflictError(
      "Konfigurasi AI sudah diubah di sesi lain. Muat ulang halaman sebelum mereset.",
    );
  }

  await recordAudit(db, {
    organizationId: actor.organizationId,
    actor: { type: "staff", membershipId: actor.membershipId },
    action: "settings.ai_reset",
    entityType: "ai_settings",
    entityId: updated.id,
    metadata: {
      aiMode: updated.mode,
      credentialAction: params.clearApiKey ? "cleared" : "preserved",
      settingsVersion: updated.settingsVersion,
    },
  });

  return toAiView(updated);
}

export type ReadinessCheck = {
  key: string;
  label: string;
  status: "ok" | "attention";
  detail: string;
};

/**
 * FR-17 readiness: operational status only. Local access and a complete
 * letterhead do not make real intake lawful; the gate stays with the
 * instrument, authority and privacy SOP.
 */
export async function getReadiness(
  db: AppDatabase,
  params: { actor: StaffActor },
): Promise<{ checks: ReadinessCheck[]; liveIntakeEnabled: boolean }> {
  const { actor } = params;
  assertCan(actor.role, "admin.general_settings");

  const organization = await findOrganizationById(db, actor.organizationId);
  if (!organization) {
    throw new NotFoundError("Profil panti tidak ditemukan pada instalasi ini");
  }
  const ai = await ensureAiSettings(db, actor.organizationId);
  const env = getEnv();

  const letterheadComplete =
    organization.address !== null &&
    (organization.phone !== null || organization.email !== null);

  const checks: ReadinessCheck[] = [
    {
      key: "letterhead",
      label: "Kop panti",
      status: letterheadComplete ? "ok" : "attention",
      detail: letterheadComplete
        ? "Nama, alamat dan kontak sudah terisi untuk tampilan dasbor dan cetak."
        : "Lengkapi alamat dan minimal satu kontak agar kop cetak tidak kosong.",
    },
    {
      key: "storage",
      label: "Penyimpanan lokal",
      status: "ok",
      detail: `Berkas dan database tersimpan di perangkat ini (${env.storage.provider}).`,
    },
    {
      key: "ai",
      label: "Konfigurasi AI",
      status: ai.mode === "mock" || ai.enabled ? "ok" : "attention",
      detail:
        ai.mode === "mock"
          ? "Mode mock lokal: tidak ada permintaan keluar dan hasilnya berlabel simulasi."
          : ai.enabled
            ? "Endpoint lokal aktif dengan konfigurasi yang sudah lulus uji."
            : "Endpoint lokal tersimpan tetapi belum aktif; jalankan uji koneksi lebih dulu.",
    },
    {
      key: "live_intake",
      label: "Pengisian data nyata",
      status: env.liveIntakeEnabled ? "attention" : "ok",
      detail: env.liveIntakeEnabled
        ? "LIVE_INTAKE_ENABLED=true. Pastikan instrumen approved, dasar kewenangan dan SOP privasi sudah ada."
        : "Masih nonaktif: hanya data fiktif berlabel demonstrasi yang boleh diisi.",
    },
  ];

  return { checks, liveIntakeEnabled: env.liveIntakeEnabled };
}
