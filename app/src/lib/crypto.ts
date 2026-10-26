import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getEnv } from "./env";

/**
 * AES-256-GCM helpers (PRD-PANTI-001 section 12.4). Ciphertext is stored as
 * `v<keyVersion>:<iv>:<ciphertext+tag>`, all base64url, so a master key can be
 * rotated by version without rewriting the schema.
 */
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const CIPHERTEXT_PREFIX = "v";

export class SecretCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretCryptoError";
  }
}

export type SecretKeyMaterial = {
  key: Buffer;
  keyVersion: number;
};

function resolveKeyMaterial(override?: SecretKeyMaterial): SecretKeyMaterial {
  if (override) return override;
  const env = getEnv();
  return {
    key: env.secrets.encryptionKey,
    keyVersion: env.secrets.encryptionKeyVersion,
  };
}

export function sealSecret(plaintext: string, override?: SecretKeyMaterial): string {
  const { key, keyVersion } = resolveKeyMaterial(override);
  if (key.length !== 32) {
    throw new SecretCryptoError("Encryption key must be 32 bytes for AES-256-GCM");
  }
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([ciphertext, authTag]).toString("base64url");
  return `${CIPHERTEXT_PREFIX}${keyVersion}:${iv.toString("base64url")}:${payload}`;
}

export function openSecret(sealed: string, override?: SecretKeyMaterial): string {
  const parts = sealed.split(":");
  if (parts.length !== 3) {
    throw new SecretCryptoError("Sealed secret has an unexpected format");
  }
  const [versionPart, ivPart, payloadPart] = parts as [string, string, string];
  const sealedVersion = Number.parseInt(versionPart.slice(1), 10);
  if (!Number.isInteger(sealedVersion) || sealedVersion < 1) {
    throw new SecretCryptoError("Sealed secret has an invalid key version");
  }
  const { key, keyVersion } = resolveKeyMaterial(override);
  if (sealedVersion !== keyVersion) {
    throw new SecretCryptoError(
      `Sealed secret was written with key version ${sealedVersion}, current key version is ${keyVersion}`,
    );
  }
  const iv = Buffer.from(ivPart, "base64url");
  const payload = Buffer.from(payloadPart, "base64url");
  if (iv.length !== IV_LENGTH_BYTES || payload.length <= 16) {
    throw new SecretCryptoError("Sealed secret payload is malformed");
  }
  const authTag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(0, payload.length - 16);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new SecretCryptoError("Sealed secret could not be decrypted with the current key");
  }
}

/** Only used for admin GET responses: never return the plaintext or the mask as a key. */
export function maskSecret(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  return `••••••••${plaintext.slice(-4)}`;
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Participant intake tokens are stored hashed only (PRD section 9.2 intake_sessions). */
export function hashOpaqueToken(token: string): string {
  return sha256Hex(token);
}

export function generateOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
