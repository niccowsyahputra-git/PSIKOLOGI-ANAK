import { describe, expect, it } from "vitest";
import { aiResultSchema, assertResultPolicy, parseAiResult, type AiResult } from "@/lib/ai/result.schema";
import { ValidationError } from "@/lib/errors";

/** A minimal result that satisfies the contract, used as the base for mutations. */
const valid: AiResult = {
  schemaVersion: "1",
  summary: "Ringkasan struktural dari jawaban yang dikirim.",
  protectiveFactors: ["Anak menyebut satu orang dewasa yang ia percaya."],
  attentionIndicators: [
    {
      description: "Beberapa pernyataan disetujui pada posisi tinggi.",
      sourceAnswerRefs: [{ assessmentId: "ASS-1", itemId: "C01" }],
      uncertainty: "Posisi pilihan bukan penilaian keadaan anak.",
    },
  ],
  caregiverSuggestions: [{ action: "Baca jawaban aslinya.", purpose: "Pembacaan manusia tetap sumber utama.", timeframe: "segera" }],
  guardianSuggestions: ["Sampaikan terima kasih atas kesediaan mengisi."],
  psychologistFollowupPoints: ["Verifikasi kelengkapan sumber."],
  limitations: ["Bukan alat ukur klinis tervalidasi."],
  supportPriority: "rutin",
  safetyConcern: { present: false, reason: null, sourceAnswerRefs: [] },
};

const allowed = new Set(["ASS-1:C01", "ASS-1:C02"]);

function expectPolicyRejection(result: AiResult, refs: ReadonlySet<string> = allowed): ValidationError {
  try {
    assertResultPolicy(result, refs);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error("expected the result to be refused");
}

describe("AI result schema", () => {
  it("accepts a complete result", () => {
    expect(aiResultSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an unknown field instead of storing it silently", () => {
    expect(aiResultSchema.safeParse({ ...valid, riskScore: 7 }).success).toBe(false);
  });

  it("rejects a wrong schema version, so a changed contract cannot be mistaken for this one", () => {
    expect(aiResultSchema.safeParse({ ...valid, schemaVersion: "2" }).success).toBe(false);
  });

  it("requires every attention indicator to cite evidence and state its uncertainty", () => {
    const noRefs = { ...valid, attentionIndicators: [{ ...valid.attentionIndicators[0], sourceAnswerRefs: [] }] };
    expect(aiResultSchema.safeParse(noRefs).success).toBe(false);
    const noUncertainty = { ...valid, attentionIndicators: [{ description: "x", sourceAnswerRefs: [{ assessmentId: "ASS-1", itemId: "C01" }] }] };
    expect(aiResultSchema.safeParse(noUncertainty).success).toBe(false);
  });

  it("requires at least one stated limitation", () => {
    expect(aiResultSchema.safeParse({ ...valid, limitations: [] }).success).toBe(false);
  });

  it("rejects an invented priority or timeframe", () => {
    expect(aiResultSchema.safeParse({ ...valid, supportPriority: "gawat_darurat" }).success).toBe(false);
    expect(aiResultSchema.safeParse({ ...valid, caregiverSuggestions: [{ ...valid.caregiverSuggestions[0], timeframe: "besok" }] }).success).toBe(false);
  });

  it("keeps safetyConcern internally consistent in both directions", () => {
    const presentWithoutEvidence = { ...valid, safetyConcern: { present: true, reason: "ada laporan", sourceAnswerRefs: [] } };
    expect(aiResultSchema.safeParse(presentWithoutEvidence).success).toBe(false);
    const absentWithReason = { ...valid, safetyConcern: { present: false, reason: "ada laporan", sourceAnswerRefs: [] } };
    expect(aiResultSchema.safeParse(absentWithReason).success).toBe(false);
    const consistent = { ...valid, safetyConcern: { present: true, reason: "ada laporan", sourceAnswerRefs: [{ assessmentId: "ASS-1", itemId: "C02" }] } };
    expect(aiResultSchema.safeParse(consistent).success).toBe(true);
  });

  it("caps text length so one field cannot flood the stored record", () => {
    expect(aiResultSchema.safeParse({ ...valid, summary: "a".repeat(4001) }).success).toBe(false);
  });

  it("caps array length", () => {
    expect(aiResultSchema.safeParse({ ...valid, guardianSuggestions: Array.from({ length: 21 }, () => "saran") }).success).toBe(false);
  });
});

describe("evidence policy", () => {
  it("accepts references to answers that were really sent", () => {
    expect(() => assertResultPolicy(valid, allowed)).not.toThrow();
  });

  it("refuses an indicator citing an item that was never part of the input", () => {
    const fabricated = { ...valid, attentionIndicators: [{ ...valid.attentionIndicators[0], sourceAnswerRefs: [{ assessmentId: "ASS-1", itemId: "C09" }] }] };
    expect(expectPolicyRejection(fabricated).message).toContain("tidak ada dalam input");
  });

  it("refuses a safety concern citing a source that was never part of the input", () => {
    const fabricated: AiResult = {
      ...valid,
      safetyConcern: { present: true, reason: "ada indikasi", sourceAnswerRefs: [{ assessmentId: "ASS-9", itemId: "C01" }] },
    };
    expectPolicyRejection(fabricated);
  });
});

describe("forbidden advice policy", () => {
  it.each([
    ["medication", "Berikan obat penenang sebelum tidur."],
    ["dosage", "Naikkan dosis setiap malam."],
    ["exposure therapy", "Lakukan terapi paparan terhadap kenangan itu."],
    ["interrogation", "Anak sebaiknya diinterogasi sampai mengaku."],
    ["physical punishment", "Beri hukuman fisik bila membantah."],
    ["isolation", "Anak perlu diisolasi dari teman sekamarnya."],
    ["placement decision", "Sebaiknya anak dikeluarkan dari panti."],
    ["diagnosis claim", "Anak ini menderita gangguan kecemasan."],
    ["clinical label", "Gejalanya mengarah ke PTSD."],
    ["clinical threshold", "Skor total berada di atas cut-off."],
  ])("refuses %s wording wherever it appears", (_label, sentence) => {
    expectPolicyRejection({ ...valid, summary: sentence });
    expectPolicyRejection({ ...valid, guardianSuggestions: [sentence] });
    expectPolicyRejection({ ...valid, caregiverSuggestions: [{ action: sentence, purpose: "tujuan", timeframe: "segera" }] });
    expectPolicyRejection({ ...valid, attentionIndicators: [{ ...valid.attentionIndicators[0], uncertainty: sentence }] });
  });

  it("names the violated rule so the saved error explains itself", () => {
    expect(expectPolicyRejection({ ...valid, summary: "Beri obat penenang." }).message).toContain("saran pengobatan");
  });

  it("keeps legitimate disclaimers usable, since they mention the same topics", () => {
    const disclaimers: AiResult = {
      ...valid,
      limitations: [
        "Keluaran ini bukan diagnosis dan tidak menghasilkan skor apa pun.",
        "Bukan alat ukur klinis tervalidasi; tidak ada batas nilai.",
      ],
      summary: "Ringkasan pendukung, bukan diagnosis dan bukan keputusan penempatan.",
    };
    expect(() => assertResultPolicy(disclaimers, allowed)).not.toThrow();
  });
});

describe("parseAiResult", () => {
  it("returns the parsed result when schema and policy both pass", () => {
    expect(parseAiResult(valid, allowed).summary).toBe(valid.summary);
  });

  it("reports a schema failure without leaking the raw model output", () => {
    try {
      parseAiResult({ schemaVersion: "1" }, allowed);
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe("Keluaran AI tidak sesuai schema; hasil tidak disimpan");
    }
  });

  it("applies the policy check too, not only the schema", () => {
    expect(() => parseAiResult({ ...valid, summary: "Anak ini mengidap depresi klinis." }, allowed)).toThrow(ValidationError);
  });
});
