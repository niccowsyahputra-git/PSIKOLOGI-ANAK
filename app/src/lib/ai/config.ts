import { sha256Hex } from "@/lib/crypto";
import { ValidationError } from "@/lib/errors";

/**
 * Outbound policy for the local-development phase (PRD section 11.2): deny all
 * except the exact loopback host/port the server allowlists. The loopback
 * exception is not a removal of SSRF protection, so credentials in the URL,
 * query strings, redirects and non-loopback hosts stay refused here.
 */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export type AiMode = "mock" | "local_endpoint" | "remote_endpoint";

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

function fieldError(field: string, message: string): never {
  throw new ValidationError(message, { [field]: [message] });
}

/**
 * Validates an operator-supplied base URL for `local_endpoint` mode against the
 * server allowlist (`LOCAL_AI_ALLOWED_ENDPOINTS`). Returns the parsed URL.
 */
export function assertSafeLocalAiEndpoint(
  baseUrl: string | null,
  allowedOrigins: readonly string[],
): URL {
  if (!baseUrl) {
    fieldError("baseUrl", "URL layanan AI lokal wajib diisi untuk mode endpoint lokal");
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    fieldError("baseUrl", "URL layanan AI lokal tidak valid");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fieldError("baseUrl", "URL layanan AI hanya boleh memakai http:// atau https://");
  }
  if (url.username !== "" || url.password !== "") {
    fieldError("baseUrl", "URL tidak boleh menyertakan nama pengguna atau kata sandi");
  }
  if (url.search !== "" || url.hash !== "") {
    fieldError("baseUrl", "URL tidak boleh memuat query string atau fragmen");
  }
  if (!isLoopbackHostname(url.hostname)) {
    fieldError(
      "baseUrl",
      "Hanya alamat loopback (localhost atau 127.0.0.1) yang diizinkan pada fase lokal ini",
    );
  }
  if (allowedOrigins.length === 0) {
    fieldError(
      "baseUrl",
      "Belum ada endpoint lokal yang diizinkan server. Isi LOCAL_AI_ALLOWED_ENDPOINTS di .env.local lebih dulu",
    );
  }
  if (!allowedOrigins.includes(url.origin)) {
    fieldError(
      "baseUrl",
      `Alamat ${url.origin} tidak ada pada daftar izin server (LOCAL_AI_ALLOWED_ENDPOINTS)`,
    );
  }
  return url;
}

/** Joins the allowlisted origin with the configured request path, nothing else. */
export function buildAiRequestUrl(baseUrl: URL, extension: string): URL {
  const path = extension.startsWith("/") ? extension : `/${extension}`;
  const target = new URL(`${baseUrl.origin}${path}`);
  if (target.origin !== baseUrl.origin) {
    fieldError("extension", "Path permintaan tidak boleh berpindah ke host lain");
  }
  return target;
}

export type AiFingerprintInput = {
  mode: AiMode;
  baseUrl: string | null;
  model: string | null;
  extension: string;
  temperature: number;
  maxTokens: number;
  timeoutSeconds: number;
  /** One-way digest of the API key, never the key itself. */
  keyFingerprint: string | null;
};

/**
 * PRD section 10.2: the test fingerprint changes whenever the URL, model, key
 * or tested options change, so a stale "passed" result can never enable AI.
 * Quota (`dailyLimit`) and the enable flag are deliberately excluded.
 */
export function aiConfigFingerprint(input: AiFingerprintInput): string {
  return sha256Hex(
    [
      input.mode,
      input.baseUrl ?? "",
      input.model ?? "",
      input.extension,
      String(input.temperature),
      String(input.maxTokens),
      String(input.timeoutSeconds),
      input.keyFingerprint ?? "",
    ].join("\u0000"),
  );
}

/** The API key is only ever digested, never logged or returned. */
export function apiKeyFingerprint(plaintext: string): string {
  return sha256Hex(plaintext).slice(0, 32);
}

export const MASKED_KEY_PREFIX = "••••";

export function looksLikeMaskedKey(value: string): boolean {
  return value.startsWith(MASKED_KEY_PREFIX);
}
