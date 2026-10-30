"use client";

import { useState } from "react";
import {
  Badge,
  Card,
  Field,
  inputClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { AiSettingsView as AiSettings } from "@/server/services/settings.service";

type ApiFailure = {
  error?: { message?: string; fieldErrors?: Record<string, string[]> };
};

type TestResult = { status: "passed" | "failed"; message: string; settings: AiSettings };

const MODE_LABELS: Record<AiSettings["mode"], string> = {
  mock: "Mock lokal (simulasi, tanpa permintaan keluar)",
  local_endpoint: "Endpoint model lokal (OpenAI-compatible di loopback)",
  remote_endpoint: "Penyedia jarak jauh (dinonaktifkan)",
};

type FormState = {
  mode: AiSettings["mode"];
  providerName: string;
  baseUrl: string;
  model: string;
  extension: string;
  temperature: string;
  maxTokens: string;
  timeoutSeconds: string;
  dailyLimit: string;
  enabled: boolean;
  apiKey: string;
  clearApiKey: boolean;
};

const TESTED_FIELDS = [
  "mode", "baseUrl", "model", "extension", "temperature", "maxTokens", "timeoutSeconds",
  "apiKey", "clearApiKey",
] as const;

function toFormState(settings: AiSettings): FormState {
  return {
    mode: settings.mode,
    providerName: settings.providerName,
    baseUrl: settings.baseUrl ?? "",
    model: settings.model ?? "",
    extension: settings.extension,
    temperature: String(settings.temperature),
    maxTokens: String(settings.maxTokens),
    timeoutSeconds: String(settings.timeoutSeconds),
    dailyLimit: String(settings.dailyLimit),
    enabled: settings.enabled,
    apiKey: "",
    clearApiKey: false,
  };
}

export function AiSettingsForm({
  initial,
  timezone,
}: {
  initial: AiSettings;
  timezone: string;
}) {
  const [settings, setSettings] = useState(initial);
  const [form, setForm] = useState<FormState>(() => toFormState(initial));
  const [pending, setPending] = useState<"save" | "test" | "reset" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const isLocalEndpoint = form.mode === "local_endpoint";
  const savedForm = toFormState(settings);
  const hasUnsavedChanges = JSON.stringify(form) !== JSON.stringify(savedForm);
  const needsRetest = TESTED_FIELDS.some((key) => form[key] !== savedForm[key]);

  function update<TKey extends keyof FormState>(key: TKey, value: FormState[TKey]) {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(TESTED_FIELDS.some((field) => field === key) ? { enabled: false } : {}),
    }));
  }

  function applySettings(next: AiSettings) {
    setSettings(next);
    setForm(toFormState(next));
  }

  async function call(
    action: "save" | "test" | "reset",
    request: { url: string; method: string; body?: unknown },
  ): Promise<unknown | null> {
    if (pending) return null;
    setPending(action);
    setMessage(null);
    setSuccess(null);
    setFieldErrors({});
    if (action !== "test") setTestResult(null);

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body ?? {}),
      });
      const body = (await response.json().catch(() => ({}))) as
        | ApiFailure
        | { data: unknown };

      if (!response.ok) {
        const failure = body as ApiFailure;
        setMessage(failure.error?.message ?? "Permintaan ditolak oleh server.");
        setFieldErrors(failure.error?.fieldErrors ?? {});
        return null;
      }
      return (body as { data: unknown }).data;
    } catch {
      setMessage("Server lokal tidak merespons.");
      return null;
    } finally {
      setPending(null);
    }
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = await call("save", {
      url: "/api/admin/ai-settings",
      method: "PUT",
      body: {
        mode: form.mode,
        providerName: form.providerName,
        baseUrl: form.baseUrl,
        model: form.model,
        extension: form.extension,
        temperature: Number(form.temperature),
        maxTokens: Number(form.maxTokens),
        timeoutSeconds: Number(form.timeoutSeconds),
        dailyLimit: Number(form.dailyLimit),
        enabled: form.enabled,
        // An untouched key field preserves the stored key (PRD 10.2).
        ...(form.clearApiKey
          ? { clearApiKey: true }
          : form.apiKey.length > 0
            ? { apiKey: form.apiKey }
            : {}),
        revision: settings.revision,
      },
    });
    if (!data) return;
    applySettings(data as AiSettings);
    setSuccess(
      "Konfigurasi tersimpan di database lokal. Jalankan uji koneksi sebelum mengaktifkan AI.",
    );
  }

  async function handleTest() {
    if (hasUnsavedChanges) return;
    const data = await call("test", {
      url: "/api/admin/ai-settings/test",
      method: "POST",
    });
    if (!data) return;
    const result = data as TestResult;
    setTestResult(result);
    applySettings(result.settings);
  }

  async function handleReset(clearApiKey: boolean) {
    const data = await call("reset", {
      url: "/api/admin/ai-settings/reset",
      method: "POST",
      body: { clearApiKey },
    });
    if (!data) return;
    applySettings(data as AiSettings);
    setSuccess(
      clearApiKey
        ? "Konfigurasi dikembalikan ke mock lokal dan API key tersimpan dihapus."
        : "Konfigurasi dikembalikan ke mock lokal. API key tersimpan tidak dihapus.",
    );
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={settings.enabled ? "sage" : "neutral"}>
            {settings.enabled ? "AI aktif" : "AI nonaktif"}
          </Badge>
          <Badge tone={settings.mode === "mock" ? "clay" : "sky"}>
            {settings.mode === "mock" ? "Mode mock (simulasi)" : "Endpoint lokal"}
          </Badge>
          <Badge
            tone={
              settings.lastTestStatus === "passed"
                ? settings.testMatchesCurrentConfig
                  ? "sage"
                  : "clay"
                : settings.lastTestStatus === "failed"
                  ? "clay"
                  : "neutral"
            }
          >
            {settings.lastTestStatus === "passed"
              ? settings.testMatchesCurrentConfig
                ? "Uji lulus untuk konfigurasi ini"
                : "Uji lulus pada konfigurasi lama"
              : settings.lastTestStatus === "failed"
                ? "Uji terakhir gagal"
                : "Belum diuji"}
          </Badge>
          <Badge tone="neutral">Versi konfigurasi {settings.settingsVersion}</Badge>
        </div>
        <dl className="grid gap-2 text-sm">
          <div>
            <dt className="text-ink-500">API key tersimpan</dt>
            <dd className="text-ink-900">
              {settings.hasApiKey ? (settings.apiKeyMask ?? "tersimpan") : "belum ada"}
            </dd>
          </div>
          <div>
            <dt className="text-ink-500">Uji terakhir</dt>
            <dd className="text-ink-900">{formatDateTime(settings.lastTestAt, timezone)}</dd>
          </div>
          <div>
            <dt className="text-ink-500">Mode AI pada konfigurasi server</dt>
            <dd className="text-ink-900">{settings.runtime.envMode}</dd>
          </div>
          <div>
            <dt className="text-ink-500">Endpoint loopback yang diizinkan server</dt>
            <dd className="text-ink-900">
              {settings.runtime.allowLocalEndpoint
                ? settings.runtime.allowedEndpointOrigins.length > 0
                  ? settings.runtime.allowedEndpointOrigins.join(", ")
                  : "belum diisi di LOCAL_AI_ALLOWED_ENDPOINTS"
                : "ALLOW_LOCAL_AI_ENDPOINT=false"}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-ink-500">
          Hasil mode mock selalu berlabel simulasi dan tidak dapat menjadi dukungan nyata.
          Hasil endpoint lokal pun bukan diagnosis dan tetap memerlukan review profesional.
        </p>
      </Card>

      {message ? (
        <p
          className="rounded-xl border border-clay-500/30 bg-clay-100 px-3 py-2 text-sm text-clay-600"
          role="alert"
        >
          {message}
        </p>
      ) : null}
      {success ? (
        <p
          className="rounded-xl border border-sage-200 bg-sage-50 px-3 py-2 text-sm text-sage-700"
          role="status"
        >
          {success}
        </p>
      ) : null}
      {testResult ? (
        <p
          className={
            testResult.status === "passed"
              ? "rounded-xl border border-sage-200 bg-sage-50 px-3 py-2 text-sm text-sage-700"
              : "rounded-xl border border-clay-500/30 bg-clay-100 px-3 py-2 text-sm text-clay-600"
          }
          role="status"
        >
          {testResult.message}
        </p>
      ) : null}

      <Card>
        <h2 className="text-sm font-semibold text-ink-900">Konfigurasi penyedia</h2>
        <p className="mt-1 text-xs text-ink-500">
          Semua nilai tersimpan di database laptop ini dan berlaku tanpa restart. Mock tidak
          memerlukan URL, model atau API key.
        </p>

        <form onSubmit={handleSave} className="mt-4 grid gap-4">
          <Field label="Mode" htmlFor="ai-mode" error={fieldErrors.mode?.[0]}>
            <select
              id="ai-mode"
              value={form.mode}
              onChange={(event) => update("mode", event.target.value as AiSettings["mode"])}
              className={inputClassName}
            >
              <option value="mock">{MODE_LABELS.mock}</option>
              <option value="local_endpoint">{MODE_LABELS.local_endpoint}</option>
              <option value="remote_endpoint" disabled>
                {MODE_LABELS.remote_endpoint}
              </option>
            </select>
          </Field>

          <Field
            label="Nama penyedia"
            htmlFor="ai-provider"
            error={fieldErrors.providerName?.[0]}
            hint="Label untuk catatan Anda, misalnya “Ollama lokal”."
          >
            <input
              id="ai-provider"
              value={form.providerName}
              onChange={(event) => update("providerName", event.target.value)}
              className={inputClassName}
              autoComplete="off"
              required
              minLength={2}
              maxLength={80}
            />
          </Field>

          <Field
            label="Base URL layanan lokal"
            htmlFor="ai-base-url"
            error={fieldErrors.baseUrl?.[0]}
            hint="Hanya alamat loopback yang diizinkan server, contoh http://127.0.0.1:11434."
          >
            <input
              id="ai-base-url"
              value={form.baseUrl}
              onChange={(event) => update("baseUrl", event.target.value)}
              className={inputClassName}
              autoComplete="off"
              maxLength={200}
              placeholder={isLocalEndpoint ? "http://127.0.0.1:11434" : "tidak dipakai pada mode mock"}
            />
          </Field>

          <Field
            label="Path permintaan"
            htmlFor="ai-extension"
            error={fieldErrors.extension?.[0]}
            hint="Jalur API chat completions pada layanan tersebut."
          >
            <input
              id="ai-extension"
              value={form.extension}
              onChange={(event) => update("extension", event.target.value)}
              className={inputClassName}
              autoComplete="off"
              required
              maxLength={120}
            />
          </Field>

          <Field
            label="Nama model"
            htmlFor="ai-model"
            error={fieldErrors.model?.[0]}
            hint="Wajib untuk endpoint lokal; aplikasi tidak mengunduh model apa pun."
          >
            <input
              id="ai-model"
              value={form.model}
              onChange={(event) => update("model", event.target.value)}
              className={inputClassName}
              autoComplete="off"
              maxLength={120}
              placeholder={isLocalEndpoint ? "llama3.1:8b" : "tidak dipakai pada mode mock"}
            />
          </Field>

          <Field
            label="API key layanan"
            htmlFor="ai-key"
            error={fieldErrors.apiKey?.[0]}
            hint={
              settings.hasApiKey
                ? "Biarkan kosong untuk mempertahankan key yang tersimpan."
                : "Boleh kosong bila layanan lokal tidak memerlukannya."
            }
          >
            <input
              id="ai-key"
              type="password"
              value={form.apiKey}
              onChange={(event) => update("apiKey", event.target.value)}
              className={inputClassName}
              autoComplete="new-password"
              maxLength={400}
              disabled={form.clearApiKey}
            />
          </Field>

          <Field
            label="Temperature"
            htmlFor="ai-temperature"
            error={fieldErrors.temperature?.[0]}
          >
            <input
              id="ai-temperature"
              type="number"
              step="0.1"
              min="0"
              max="1"
              value={form.temperature}
              onChange={(event) => update("temperature", event.target.value)}
              className={inputClassName}
              required
            />
          </Field>

          <Field
            label="Panjang keluaran maksimal (token)"
            htmlFor="ai-max-tokens"
            error={fieldErrors.maxTokens?.[0]}
          >
            <input
              id="ai-max-tokens"
              type="number"
              min="1"
              max="2000"
              value={form.maxTokens}
              onChange={(event) => update("maxTokens", event.target.value)}
              className={inputClassName}
              required
            />
          </Field>

          <Field
            label="Timeout (detik)"
            htmlFor="ai-timeout"
            error={fieldErrors.timeoutSeconds?.[0]}
          >
            <input
              id="ai-timeout"
              type="number"
              min="5"
              max="60"
              value={form.timeoutSeconds}
              onChange={(event) => update("timeoutSeconds", event.target.value)}
              className={inputClassName}
              required
            />
          </Field>

          <Field
            label="Kuota permintaan nyata per hari"
            htmlFor="ai-daily-limit"
            error={fieldErrors.dailyLimit?.[0]}
            hint="Berlaku untuk permintaan nyata; mock dihitung terpisah."
          >
            <input
              id="ai-daily-limit"
              type="number"
              min="1"
              max="100"
              value={form.dailyLimit}
              onChange={(event) => update("dailyLimit", event.target.value)}
              className={inputClassName}
              required
            />
          </Field>

          {settings.hasApiKey ? (
            <label className="flex items-start gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={form.clearApiKey}
                onChange={(event) => update("clearApiKey", event.target.checked)}
                className="mt-1"
              />
              <span>
                Hapus API key yang tersimpan saat menyimpan konfigurasi ini.
              </span>
            </label>
          ) : null}

          <label className="flex items-start gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => update("enabled", event.target.checked)}
              className="mt-1"
              disabled={!settings.testMatchesCurrentConfig || needsRetest}
            />
            <span>
              Aktifkan bantuan AI untuk konfigurasi ini.
              <span className="mt-1 block text-xs text-ink-500">
                {settings.testMatchesCurrentConfig && !needsRetest
                  ? "Konfigurasi tersimpan sudah lulus uji."
                  : "Tersedia setelah konfigurasi tersimpan diuji dan lulus."}
              </span>
              {fieldErrors.enabled?.[0] ? (
                <span className="mt-1 block text-xs text-clay-600">
                  {fieldErrors.enabled[0]}
                </span>
              ) : null}
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={pending !== null} className={primaryButtonClassName}>
              {pending === "save" ? "Menyimpan…" : "Simpan konfigurasi"}
            </button>
            <button
              type="button"
              disabled={pending !== null || hasUnsavedChanges}
              className={secondaryButtonClassName}
              onClick={handleTest}
            >
              {pending === "test" ? "Menguji…" : "Uji konfigurasi"}
            </button>
            <span className="text-xs text-ink-500">
              {hasUnsavedChanges
                ? "Simpan perubahan terlebih dahulu. Uji memakai konfigurasi tersimpan."
                : `Revisi tersimpan: ${settings.revision}`}
            </span>
          </div>
        </form>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-ink-900">Reset konfigurasi</h2>
        <p className="text-sm text-ink-500">
          Reset mengembalikan mode ke mock lokal, mematikan AI dan menghapus URL serta model.
          API key tersimpan hanya dihapus bila Anda memilihnya secara eksplisit.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending !== null}
            className={secondaryButtonClassName}
            onClick={() => handleReset(false)}
          >
            Reset ke mock, simpan API key
          </button>
          <button
            type="button"
            disabled={pending !== null || !settings.hasApiKey}
            className={secondaryButtonClassName}
            onClick={() => {
              if (
                window.confirm(
                  "Hapus API key tersimpan? Key harus dimasukkan ulang untuk memakai endpoint lokal.",
                )
              ) {
                void handleReset(true);
              }
            }}
          >
            Reset dan hapus API key
          </button>
        </div>
      </Card>
    </div>
  );
}
