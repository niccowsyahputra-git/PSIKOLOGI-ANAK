import { describe, expect, it } from "vitest";
import {
  SecretCryptoError,
  constantTimeEquals,
  generateOpaqueToken,
  hashOpaqueToken,
  maskSecret,
  openSecret,
  sealSecret,
  sha256Hex,
  type SecretKeyMaterial,
} from "@/lib/crypto";

const key: SecretKeyMaterial = { key: Buffer.alloc(32, 7), keyVersion: 2 };
const otherKey: SecretKeyMaterial = { key: Buffer.alloc(32, 9), keyVersion: 2 };

describe("AES-256-GCM secret sealing", () => {
  it("round-trips a value and records the key version", () => {
    const sealed = sealSecret("sk-lokal-rahasia", key);
    expect(sealed.startsWith("v2:")).toBe(true);
    expect(sealed.split(":")).toHaveLength(3);
    expect(sealed).not.toContain("sk-lokal-rahasia");
    expect(openSecret(sealed, key)).toBe("sk-lokal-rahasia");
  });

  it("produces a different ciphertext for the same plaintext (random IV)", () => {
    const first = sealSecret("sama", key);
    const second = sealSecret("sama", key);
    expect(first).not.toBe(second);
  });

  it("rejects tampered ciphertext", () => {
    const sealed = sealSecret("nilai", key);
    const [version, iv, payload] = sealed.split(":") as [string, string, string];
    const flipped = `${payload.slice(0, -2)}${payload.slice(-2) === "AA" ? "BB" : "AA"}`;
    expect(() => openSecret(`${version}:${iv}:${flipped}`, key)).toThrow(
      SecretCryptoError,
    );
  });

  it("rejects a different key and a different key version", () => {
    const sealed = sealSecret("nilai", key);
    expect(() => openSecret(sealed, otherKey)).toThrow(SecretCryptoError);
    expect(() => openSecret(sealed, { key: key.key, keyVersion: 3 })).toThrow(
      SecretCryptoError,
    );
  });

  it("rejects malformed input", () => {
    expect(() => openSecret("not-a-sealed-value", key)).toThrow(SecretCryptoError);
    expect(() => sealSecret("x", { key: Buffer.alloc(16), keyVersion: 1 })).toThrow(
      SecretCryptoError,
    );
  });
});

describe("masking and hashing helpers", () => {
  it("masks all but the last four characters", () => {
    expect(maskSecret("abcdefgh1234")).toBe("••••••••1234");
    expect(maskSecret(null)).toBeNull();
    expect(maskSecret("")).toBeNull();
  });

  it("hashes tokens deterministically without storing the plaintext", () => {
    const token = generateOpaqueToken();
    const hash = hashOpaqueToken(token);
    expect(hash).toBe(hashOpaqueToken(token));
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("compares values in constant time semantics", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
    expect(constantTimeEquals("abc", "abd")).toBe(false);
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
  });
});
