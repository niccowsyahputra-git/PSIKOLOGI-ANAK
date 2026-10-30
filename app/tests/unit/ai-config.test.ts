import { describe, expect, it } from "vitest";
import {
  aiConfigFingerprint,
  apiKeyFingerprint,
  assertSafeLocalAiEndpoint,
  buildAiRequestUrl,
  isLoopbackHostname,
  looksLikeMaskedKey,
  type AiFingerprintInput,
} from "@/lib/ai/config";
import { ValidationError } from "@/lib/errors";
import {
  aiSettingsUpdateSchema,
  generalSettingsSchema,
} from "@/lib/validation/settings.schema";

const allowed = ["http://127.0.0.1:11434"];

function expectRejection(baseUrl: string | null, origins = allowed) {
  try {
    assertSafeLocalAiEndpoint(baseUrl, origins);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error(`expected ${String(baseUrl)} to be refused`);
}

describe("local AI endpoint allowlist", () => {
  it("accepts an allowlisted loopback origin", () => {
    const url = assertSafeLocalAiEndpoint("http://127.0.0.1:11434", allowed);
    expect(url.origin).toBe("http://127.0.0.1:11434");
  });

  it("treats loopback aliases as loopback and other hosts as not", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("LOCALHOST")).toBe(true);
    expect(isLoopbackHostname("example.com")).toBe(false);
    // A deceptive subdomain must not be read as loopback.
    expect(isLoopbackHostname("localhost.evil.test")).toBe(false);
  });

  it("refuses a missing or unparseable URL", () => {
    expectRejection(null);
    expectRejection("");
    expectRejection("not a url");
  });

  it("refuses non-http schemes, credentials, query strings and fragments", () => {
    expectRejection("file:///etc/passwd");
    expectRejection("ftp://127.0.0.1:11434");
    expectRejection("http://user:pass@127.0.0.1:11434");
    expectRejection("http://127.0.0.1:11434/?token=abc");
    expectRejection("http://127.0.0.1:11434/#frag");
  });

  it("refuses hosts outside the loopback range even when allowlisted", () => {
    expectRejection("http://example.com", ["http://example.com"]);
    expectRejection("http://169.254.169.254", ["http://169.254.169.254"]);
    expectRejection("http://10.0.0.5:11434", ["http://10.0.0.5:11434"]);
  });

  it("refuses a loopback origin that the server did not allowlist", () => {
    // Same host, different port: the allowlist is matched by origin.
    expectRejection("http://127.0.0.1:9999");
    expectRejection("http://localhost:11434");
  });

  it("refuses everything when the allowlist is empty", () => {
    const error = expectRejection("http://127.0.0.1:11434", []);
    expect(error.message).toContain("LOCAL_AI_ALLOWED_ENDPOINTS");
  });

  it("reports the offending field so the admin form can show it inline", () => {
    const error = expectRejection("http://example.com", ["http://example.com"]);
    expect(error.fieldErrors?.baseUrl?.[0]).toBeTruthy();
  });
});

describe("AI request URL", () => {
  it("pins the request to the allowlisted origin", () => {
    const base = new URL("http://127.0.0.1:11434");
    expect(buildAiRequestUrl(base, "/v1/chat/completions").href).toBe(
      "http://127.0.0.1:11434/v1/chat/completions",
    );
    expect(buildAiRequestUrl(base, "v1/chat/completions").href).toBe(
      "http://127.0.0.1:11434/v1/chat/completions",
    );
  });

  it("ignores any path trying to escape to another host", () => {
    const base = new URL("http://127.0.0.1:11434");
    // "//evil.test/x" would be protocol-relative if it were resolved naively.
    expect(buildAiRequestUrl(base, "//evil.test/x").origin).toBe(
      "http://127.0.0.1:11434",
    );
  });
});

const baseFingerprint: AiFingerprintInput = {
  mode: "local_endpoint",
  baseUrl: "http://127.0.0.1:11434",
  model: "llama3",
  extension: "/v1/chat/completions",
  temperature: 0.2,
  maxTokens: 2000,
  timeoutSeconds: 45,
  keyFingerprint: null,
};

describe("AI config fingerprint", () => {
  it("is stable for an unchanged configuration", () => {
    expect(aiConfigFingerprint(baseFingerprint)).toBe(
      aiConfigFingerprint({ ...baseFingerprint }),
    );
  });

  it.each([
    ["mode", { mode: "mock" as const }],
    ["baseUrl", { baseUrl: "http://127.0.0.1:1234" }],
    ["model", { model: "mistral" }],
    ["extension", { extension: "/v1/completions" }],
    ["temperature", { temperature: 0.3 }],
    ["fractional temperature", { temperature: 0.201 }],
    ["maxTokens", { maxTokens: 1000 }],
    ["timeoutSeconds", { timeoutSeconds: 30 }],
    ["keyFingerprint", { keyFingerprint: "abc" }],
  ])("changes when %s changes, invalidating a prior passing test", (_label, patch) => {
    expect(aiConfigFingerprint({ ...baseFingerprint, ...patch })).not.toBe(
      aiConfigFingerprint(baseFingerprint),
    );
  });

  it("never contains the API key itself", () => {
    const keyFingerprint = apiKeyFingerprint("sk-secret-value");
    expect(keyFingerprint).not.toContain("sk-secret-value");
    expect(keyFingerprint).toHaveLength(32);
    expect(
      aiConfigFingerprint({ ...baseFingerprint, keyFingerprint }),
    ).not.toContain("sk-secret-value");
  });

  it("recognises a masked key so it is never stored as a real key", () => {
    expect(looksLikeMaskedKey("••••••••3f9a")).toBe(true);
    expect(looksLikeMaskedKey("sk-real-key")).toBe(false);
  });
});

const validProfile = {
  name: "Panti Asuhan Harapan Bunda",
  address: "Jl. Melati 12, Bandung",
  phone: "+62 22 1234 567",
  email: "kontak@panti.local",
  contact: null,
  leaderName: "Ibu Sari",
  leaderTitle: "Kepala Panti",
  registrationNumber: "AHU-001",
  printNote: "Arsip internal",
  timezone: "Asia/Jakarta",
  revision: 1,
};

describe("general settings schema", () => {
  it("accepts a complete letterhead", () => {
    const parsed = generalSettingsSchema.parse(validProfile);
    expect(parsed.name).toBe("Panti Asuhan Harapan Bunda");
    expect(parsed.phone).toBe("+62 22 1234 567");
  });

  it("treats an emptied field as a request to clear the stored value", () => {
    const parsed = generalSettingsSchema.parse({
      ...validProfile,
      address: "",
      printNote: "   ",
      registrationNumber: null,
    });
    expect(parsed.address).toBeNull();
    expect(parsed.printNote).toBeNull();
    expect(parsed.registrationNumber).toBeNull();
  });

  it("requires a usable panti name", () => {
    expect(generalSettingsSchema.safeParse({ ...validProfile, name: "A" }).success).toBe(false);
    expect(generalSettingsSchema.safeParse({ ...validProfile, name: "   " }).success).toBe(false);
  });

  it("rejects a malformed email and phone", () => {
    expect(generalSettingsSchema.safeParse({ ...validProfile, email: "bukan-email" }).success).toBe(false);
    expect(generalSettingsSchema.safeParse({ ...validProfile, phone: "telepon kantor" }).success).toBe(false);
  });

  it("rejects an unknown time zone but accepts the Indonesian zones", () => {
    expect(generalSettingsSchema.safeParse({ ...validProfile, timezone: "Asia/Nowhere" }).success).toBe(false);
    for (const timezone of ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"]) {
      expect(generalSettingsSchema.safeParse({ ...validProfile, timezone }).success).toBe(true);
    }
  });
});

const validAi = {
  mode: "local_endpoint" as const,
  providerName: "Ollama lokal",
  baseUrl: "http://127.0.0.1:11434",
  model: "llama3",
  extension: "/v1/chat/completions",
  temperature: 0.2,
  maxTokens: 1200,
  timeoutSeconds: 45,
  dailyLimit: 20,
  enabled: false,
  revision: 1,
};

describe("AI settings schema", () => {
  it("accepts a configuration without a key, preserving whatever is stored", () => {
    const parsed = aiSettingsUpdateSchema.parse(validAi);
    expect(parsed.apiKey).toBeUndefined();
    expect(parsed.clearApiKey).toBeUndefined();
  });

  it("refuses an empty API key string instead of silently clearing it", () => {
    expect(aiSettingsUpdateSchema.safeParse({ ...validAi, apiKey: "" }).success).toBe(false);
  });

  it("refuses replacing and clearing the key in the same request", () => {
    const result = aiSettingsUpdateSchema.safeParse({
      ...validAi,
      apiKey: "sk-new",
      clearApiKey: true,
    });
    expect(result.success).toBe(false);
  });

  it("keeps numeric options inside the documented bounds", () => {
    expect(aiSettingsUpdateSchema.safeParse({ ...validAi, temperature: 1.5 }).success).toBe(false);
    expect(aiSettingsUpdateSchema.safeParse({ ...validAi, temperature: -0.1 }).success).toBe(false);
    expect(aiSettingsUpdateSchema.safeParse({ ...validAi, maxTokens: 5000 }).success).toBe(false);
    expect(aiSettingsUpdateSchema.safeParse({ ...validAi, timeoutSeconds: 1 }).success).toBe(false);
    expect(aiSettingsUpdateSchema.safeParse({ ...validAi, timeoutSeconds: 600 }).success).toBe(false);
    expect(aiSettingsUpdateSchema.safeParse({ ...validAi, dailyLimit: 0 }).success).toBe(false);
  });

  it("rejects an unknown mode and a path that could escape the origin", () => {
    expect(aiSettingsUpdateSchema.safeParse({ ...validAi, mode: "telepathy" }).success).toBe(false);
    expect(aiSettingsUpdateSchema.safeParse({ ...validAi, extension: "//evil.test/x" }).success).toBe(false);
  });
});
