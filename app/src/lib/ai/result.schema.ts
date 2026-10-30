import { z } from "zod";
import { ValidationError } from "@/lib/errors";

/**
 * Normative AI output contract (PRD Lampiran B section 18.2). Strict schema,
 * strings capped at 4.000 characters and arrays at 20 items. Valid JSON is not
 * proof of a safe answer, so `assertResultPolicy` runs the evidence and domain
 * checks afterwards and a human review stays mandatory either way.
 */
const MAX_TEXT = 4000;
const MAX_ITEMS = 20;

const text = (min = 1) => z.string().trim().min(min).max(MAX_TEXT);
const list = <T extends z.ZodTypeAny>(inner: T) => z.array(inner).max(MAX_ITEMS);

const sourceAnswerRef = z
  .object({ assessmentId: z.string().trim().min(1).max(100), itemId: z.string().trim().min(1).max(50) })
  .strict();

export const TIMEFRAMES = ["segera", "minggu_ini", "tindak_lanjut"] as const;
export const SUPPORT_PRIORITIES = ["belum_dapat_ditentukan", "rutin", "perlu_tinjauan", "segera"] as const;

export const aiResultSchema = z
  .object({
    schemaVersion: z.literal("1"),
    summary: text(),
    protectiveFactors: list(text()),
    attentionIndicators: list(
      z
        .object({ description: text(), sourceAnswerRefs: list(sourceAnswerRef).min(1), uncertainty: text() })
        .strict(),
    ),
    caregiverSuggestions: list(
      z.object({ action: text(), purpose: text(), timeframe: z.enum(TIMEFRAMES) }).strict(),
    ),
    guardianSuggestions: list(text()),
    psychologistFollowupPoints: list(text()),
    limitations: list(text()).min(1),
    supportPriority: z.enum(SUPPORT_PRIORITIES),
    safetyConcern: z
      .object({
        present: z.boolean(),
        reason: text().nullable(),
        sourceAnswerRefs: list(sourceAnswerRef),
      })
      .strict()
      // `present=false` must carry no reason and no evidence; `present=true` must carry both.
      .refine((value) => (value.present ? value.reason !== null && value.sourceAnswerRefs.length > 0 : value.reason === null && value.sourceAnswerRefs.length === 0), {
        message: "safetyConcern.present harus konsisten dengan alasan dan bukti",
      }),
  })
  .strict();

export type AiResult = z.infer<typeof aiResultSchema>;
export type SourceAnswerRef = z.infer<typeof sourceAnswerRef>;

/**
 * Advice the application refuses to store regardless of who produced it (PRD
 * section 18.1). Patterns deliberately target assertive wording rather than
 * bare topic words, so a legitimate disclaimer ("ini bukan diagnosis", "tidak
 * menghasilkan skor") is not rejected while an actual instruction is. This is a
 * safety net, not a claim of perfect semantic detection: PRD section 18.2 is
 * explicit that human review stays mandatory for every result.
 */
const FORBIDDEN_ADVICE: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(beri(?:kan)? obat|minum obat|resep(?:kan)?|dosis|antidepresan|obat penenang)\b/i, label: "saran pengobatan" },
  { pattern: /\b(terapi paparan|exposure therapy|flooding)\b/i, label: "terapi paparan" },
  { pattern: /\b(interogasi|diinterogasi|interogasilah|dipaksa mengaku|desak anak untuk mengaku)\b/i, label: "interogasi" },
  { pattern: /\b(hukuman fisik|pukul(?:lah)?|memukul|dipukul|cambuk|jewer|setrap)\b/i, label: "hukuman fisik" },
  { pattern: /\b(diisolasi|isolasikan|dikurung|kurung|dikucilkan|sel khusus)\b/i, label: "isolasi anak" },
  { pattern: /\b(dikeluarkan dari panti|keluarkan anak|tolak penerimaan|pindahkan paksa)\b/i, label: "keputusan penempatan" },
  { pattern: /\b(konfrontasi(?:kan)?|pertemukan)\b[^.]{0,40}\b(terduga )?pelaku\b/i, label: "konfrontasi terduga pelaku" },
  { pattern: /\b(mendiagnosis|didiagnosis|terdiagnosis|menderita|mengidap)\b/i, label: "klaim diagnosis" },
  { pattern: /\b(PTSD|skizofrenia|bipolar|depresi (?:mayor|klinis))\b/i, label: "label gangguan klinis" },
  { pattern: /\b(skor total|nilai total|total skor|cut[- ]?off|ambang klinis|tingkat risiko klinis)\b/i, label: "skor atau ambang klinis" },
];

function scanText(value: string, found: Set<string>): void {
  for (const rule of FORBIDDEN_ADVICE) {
    if (rule.pattern.test(value)) {
      found.add(rule.label);
    }
  }
}

/**
 * Verifies evidence references point at answers that were really sent, and that
 * the narrative stays inside the allowed support domain. A violation makes the
 * job fail with a safe error instead of persisting the output as a success.
 */
export function assertResultPolicy(result: AiResult, allowedRefs: ReadonlySet<string>): void {
  const refs = [
    ...result.attentionIndicators.flatMap((indicator) => indicator.sourceAnswerRefs),
    ...result.safetyConcern.sourceAnswerRefs,
  ];
  for (const ref of refs) {
    if (!allowedRefs.has(`${ref.assessmentId}:${ref.itemId}`)) {
      throw new ValidationError("Hasil AI merujuk jawaban yang tidak ada dalam input; hasil tidak disimpan");
    }
  }

  const found = new Set<string>();
  scanText(result.summary, found);
  for (const value of [...result.protectiveFactors, ...result.guardianSuggestions, ...result.psychologistFollowupPoints, ...result.limitations]) {
    scanText(value, found);
  }
  for (const indicator of result.attentionIndicators) {
    scanText(indicator.description, found);
    scanText(indicator.uncertainty, found);
  }
  for (const suggestion of result.caregiverSuggestions) {
    scanText(suggestion.action, found);
    scanText(suggestion.purpose, found);
  }
  if (result.safetyConcern.reason !== null) {
    scanText(result.safetyConcern.reason, found);
  }
  if (found.size > 0) {
    throw new ValidationError(`Hasil AI memuat ${[...found].join(", ")} yang dilarang; hasil tidak disimpan`);
  }
}

/** Parses and policy-checks raw model output in one step. */
export function parseAiResult(raw: unknown, allowedRefs: ReadonlySet<string>): AiResult {
  const parsed = aiResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Keluaran AI tidak sesuai schema; hasil tidak disimpan");
  }
  assertResultPolicy(parsed.data, allowedRefs);
  return parsed.data;
}
