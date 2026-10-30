import { sha256Hex } from "@/lib/crypto";
import { ValidationError } from "@/lib/errors";
import { INSTRUMENTS, LIKERT_LABELS, type Answer, type Module } from "@/lib/instruments";
import type { SourceAnswerRef } from "./result.schema";

/**
 * Minimal pseudonymised payload for AI assistance (PRD section 11.1). Names,
 * birth dates, contacts, addresses, staff emails, storage keys and internal
 * UUIDs are never included — not even for a local model, because running on
 * localhost does not remove the privacy design.
 *
 * Aliases are positional within one snapshot (`ASS-1`, `WALI-1`), so they carry
 * no stable identifier that could be correlated across services. The server
 * maps aliases back to real ids only after the output validates.
 */
export const MAX_SNAPSHOT_CHARS = 30000;

export type SnapshotAnswer = {
  itemId: string;
  kind: Answer["kind"];
  question: string;
  state: Answer["state"];
  assistance: Answer["assistance"];
  /** Free text, chosen emotion, Likert label, or a note that media is not sent. */
  answer: string | null;
  skipReason: string | null;
};

export type SnapshotSource = {
  alias: string;
  target: "child" | "guardian";
  respondent: string;
  module: Module;
  submittedAt: string | null;
  answers: SnapshotAnswer[];
};

export type AnalysisSnapshot = {
  schemaVersion: "1";
  scope: "child" | "guardian" | "combined";
  subject: { pseudonym: string; ageAtStart: number; ageIsEstimated: boolean; module: Module };
  guardians: Array<{ pseudonym: string; relationship: string }>;
  cycle: { kind: string; partial: boolean; partialReason: string | null };
  sources: SnapshotSource[];
  limitations: string[];
};

export type SnapshotBundle = {
  snapshot: AnalysisSnapshot;
  /** `alias:itemId` pairs the output is allowed to cite. */
  allowedRefs: Set<string>;
  aliasToAssessmentId: Map<string, string>;
  inputHash: string;
};

export type SourceAssessment = {
  id: string;
  target: "child" | "guardian";
  module: Module;
  guardianId: string | null;
  respondentType: string;
  submittedAt: Date | null;
  answers: Answer[];
};

function questionText(module: Module, itemId: string): string {
  return INSTRUMENTS[module].find((item) => item.id === itemId)?.text ?? itemId;
}

/** Renders one stored answer as plain text; media files are described, never sent. */
function renderAnswer(answer: Answer): string | null {
  if (answer.state !== "answered") return null;
  if (answer.kind === "media") {
    return answer.activityMode === null ? null : `Aktivitas gambar dikerjakan (mode ${answer.activityMode}); berkas gambar tidak dikirim ke AI`;
  }
  if (answer.kind === "likert") {
    return answer.value === null ? null : `${LIKERT_LABELS[answer.value - 1]} (${answer.value} dari 5)`;
  }
  return answer.value === null ? null : String(answer.value);
}

/** Shared rendering rule, so chat context and analysis snapshot agree on what an answer looks like. */
export function toSnapshotAnswers(module: Module, answers: readonly Answer[]): SnapshotAnswer[] {
  return answers.map((answer) => ({
    itemId: answer.itemId,
    kind: answer.kind,
    question: questionText(module, answer.itemId),
    state: answer.state,
    assistance: answer.assistance,
    answer: renderAnswer(answer),
    skipReason: answer.skipReason ?? null,
  }));
}

/**
 * Builds the payload plus the alias map. Throws instead of truncating when the
 * input exceeds the documented maximum, so no answer is silently dropped.
 */
export function buildSnapshot(input: {
  scope: "child" | "guardian" | "combined";
  ageAtStart: number;
  ageIsEstimated: boolean;
  module: Module;
  cycleKind: string;
  partial: boolean;
  partialReason: string | null;
  guardianRelationships: readonly string[];
  sources: readonly SourceAssessment[];
}): SnapshotBundle {
  if (input.sources.length === 0) {
    throw new ValidationError("Tidak ada asesmen terkirim yang dapat dianalisis");
  }

  const allowedRefs = new Set<string>();
  const aliasToAssessmentId = new Map<string, string>();
  // Sorting by id keeps aliases stable for the same set of sources, so the same
  // input always produces the same hash and the same replayable snapshot.
  const ordered = [...input.sources].sort((left, right) => left.id.localeCompare(right.id));
  const sources: SnapshotSource[] = ordered.map((source, index) => {
    const alias = `ASS-${index + 1}`;
    aliasToAssessmentId.set(alias, source.id);
    const answers = toSnapshotAnswers(source.module, source.answers);
    for (const answer of answers) {
      allowedRefs.add(`${alias}:${answer.itemId}`);
    }
    return {
      alias,
      target: source.target,
      respondent: source.respondentType,
      module: source.module,
      submittedAt: source.submittedAt?.toISOString() ?? null,
      answers,
    };
  });

  const skipped = sources.flatMap((source) => source.answers.filter((answer) => answer.state !== "answered"));
  const limitations = [
    "Instrumen intake ini bukan alat ukur klinis tervalidasi; tidak ada skor, batas nilai, atau diagnosis.",
    "Analisis hanya memakai jawaban yang dikirim; wawancara, observasi lapangan, dan riwayat lengkap tidak tersedia.",
  ];
  if (skipped.length > 0) {
    limitations.push(`${skipped.length} item dilewati atau tidak berlaku, sehingga gambaran belum lengkap.`);
  }
  if (input.partial) {
    limitations.push("Sumber tidak lengkap: analisis dijalankan dalam mode sebagian atas keputusan ketua/psikolog.");
  }
  if (sources.some((source) => source.answers.some((answer) => answer.kind === "media"))) {
    limitations.push("Berkas gambar tidak dikirim ke AI dan tidak boleh ditafsirkan dari jawaban teks.");
  }

  const snapshot: AnalysisSnapshot = {
    schemaVersion: "1",
    scope: input.scope,
    subject: { pseudonym: "Anak", ageAtStart: input.ageAtStart, ageIsEstimated: input.ageIsEstimated, module: input.module },
    guardians: input.guardianRelationships.map((relationship, index) => ({ pseudonym: `WALI-${index + 1}`, relationship })),
    cycle: { kind: input.cycleKind, partial: input.partial, partialReason: input.partialReason },
    sources,
    limitations,
  };

  const serialized = JSON.stringify(snapshot);
  if (serialized.length > MAX_SNAPSHOT_CHARS) {
    throw new ValidationError(
      `Input analisis ${serialized.length} karakter melebihi batas ${MAX_SNAPSHOT_CHARS}; pilih lingkup lebih kecil daripada memotong jawaban`,
    );
  }

  return { snapshot, allowedRefs, aliasToAssessmentId, inputHash: sha256Hex(serialized) };
}

/**
 * Translates validated alias references back to real assessment ids. Unknown
 * aliases are refused rather than dropped, so a result can never be stored with
 * evidence that points nowhere.
 */
export function resolveRefs(refs: readonly SourceAnswerRef[], aliasToAssessmentId: ReadonlyMap<string, string>): SourceAnswerRef[] {
  return refs.map((ref) => {
    const assessmentId = aliasToAssessmentId.get(ref.assessmentId);
    if (!assessmentId) {
      throw new ValidationError("Hasil AI merujuk sumber yang tidak dikenal; hasil tidak disimpan");
    }
    return { assessmentId, itemId: ref.itemId };
  });
}
