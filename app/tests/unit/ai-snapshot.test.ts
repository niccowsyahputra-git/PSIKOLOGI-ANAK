import { describe, expect, it } from "vitest";
import { MOCK_SIMULATION_NOTICE, runMockAnalysis } from "@/lib/ai/mock";
import { aiResultSchema, assertResultPolicy } from "@/lib/ai/result.schema";
import { buildSnapshot, MAX_SNAPSHOT_CHARS, resolveRefs, type SourceAssessment } from "@/lib/ai/snapshot";
import { ValidationError } from "@/lib/errors";
import type { Answer } from "@/lib/instruments";

const text = (itemId: string, value: string | null, state: Answer["state"] = "answered"): Answer => ({ itemId, kind: "text", value, state, assistance: "none" });
const likert = (itemId: string, value: number | null, state: Answer["state"] = "answered"): Answer => ({ itemId, kind: "likert", value, state, assistance: "none" });
const emotion = (value: "senang" | "biasa" | "sedih" | "marah" | "takut"): Answer => ({ itemId: "A01", kind: "emotion", value, state: "answered", assistance: "none" });
const media = (activityMode: "canvas" | "photo" | "paper_pending" | null): Answer => ({ itemId: "A02", kind: "media", activityMode, initialAttachmentId: null, state: "answered", assistance: "none" });

const childSource: SourceAssessment = {
  id: "11111111-1111-4111-8111-111111111111",
  target: "child",
  module: "C",
  guardianId: null,
  respondentType: "child",
  submittedAt: new Date("2026-03-01T02:00:00.000Z"),
  answers: [likert("C01", 5), likert("C02", 2), text("C11", "Ke rumah nenek"), text("C12", null, "skipped")],
};

const guardianSource: SourceAssessment = {
  id: "22222222-2222-4222-8222-222222222222",
  target: "guardian",
  module: "W",
  guardianId: "33333333-3333-4333-8333-333333333333",
  respondentType: "guardian",
  submittedAt: new Date("2026-03-02T02:00:00.000Z"),
  answers: [likert("W02", 4), text("W08", "Semoga bisa sekolah"), text("W13", null, "skipped")],
};

const baseInput = {
  scope: "combined" as const,
  ageAtStart: 12,
  ageIsEstimated: false,
  module: "C" as const,
  cycleKind: "intake",
  partial: false,
  partialReason: null,
  guardianRelationships: ["ibu"],
  sources: [childSource, guardianSource],
};

describe("analysis snapshot", () => {
  it("refuses to build anything when no source was supplied", () => {
    expect(() => buildSnapshot({ ...baseInput, sources: [] })).toThrow(ValidationError);
  });

  it("carries no names, contacts, birth dates or internal ids", () => {
    const serialized = JSON.stringify(buildSnapshot(baseInput).snapshot);
    expect(serialized).not.toContain(childSource.id);
    expect(serialized).not.toContain(guardianSource.id);
    expect(serialized).not.toContain(guardianSource.guardianId as string);
    expect(serialized).toContain("ASS-1");
    expect(serialized).toContain("WALI-1");
    expect(serialized).toContain("\"pseudonym\":\"Anak\"");
  });

  it("assigns aliases by sorted source id, so the same input always maps the same way", () => {
    const forward = buildSnapshot(baseInput);
    const reversed = buildSnapshot({ ...baseInput, sources: [guardianSource, childSource] });
    expect(forward.inputHash).toBe(reversed.inputHash);
    expect(forward.aliasToAssessmentId.get("ASS-1")).toBe(childSource.id);
    expect(reversed.aliasToAssessmentId.get("ASS-1")).toBe(childSource.id);
  });

  it("changes the hash when an answer changes, so a replay cannot reuse a stale result", () => {
    const changed: SourceAssessment = { ...childSource, answers: [likert("C01", 4), likert("C02", 2), text("C11", "Ke rumah nenek"), text("C12", null, "skipped")] };
    expect(buildSnapshot({ ...baseInput, sources: [changed, guardianSource] }).inputHash).not.toBe(buildSnapshot(baseInput).inputHash);
  });

  it("allows citing exactly the items that were sent, including skipped ones", () => {
    const { allowedRefs } = buildSnapshot(baseInput);
    expect(allowedRefs.has("ASS-1:C01")).toBe(true);
    expect(allowedRefs.has("ASS-1:C12")).toBe(true);
    expect(allowedRefs.has("ASS-2:W08")).toBe(true);
    expect(allowedRefs.has("ASS-1:C05")).toBe(false);
  });

  it("renders Likert answers with their label and never ships a media file", () => {
    const { snapshot } = buildSnapshot({
      ...baseInput,
      scope: "child",
      module: "A",
      guardianRelationships: [],
      sources: [{ ...childSource, module: "A", answers: [emotion("sedih"), media("canvas"), text("A03", "Ingin bertemu ayah")] }],
    });
    const answers = snapshot.sources[0].answers;
    expect(answers[0].answer).toBe("sedih");
    expect(answers[1].answer).toContain("berkas gambar tidak dikirim ke AI");
    expect(JSON.stringify(snapshot)).not.toContain("initialAttachmentId");
  });

  it("states the question text so the model does not have to guess what an item id means", () => {
    const { snapshot } = buildSnapshot(baseInput);
    expect(snapshot.sources[0].answers[0].question).toContain("masa depanku suram");
  });

  it("always declares the non-clinical limitation, and adds one per real gap", () => {
    const { snapshot } = buildSnapshot({ ...baseInput, partial: true, partialReason: "wali belum hadir" });
    expect(snapshot.limitations[0]).toContain("bukan alat ukur klinis tervalidasi");
    expect(snapshot.limitations.some((entry) => entry.includes("dilewati"))).toBe(true);
    expect(snapshot.limitations.some((entry) => entry.includes("mode sebagian"))).toBe(true);
  });

  it("refuses an oversized input instead of silently dropping answers", () => {
    const huge: SourceAssessment = { ...childSource, answers: [text("C11", "x".repeat(MAX_SNAPSHOT_CHARS + 1000))] };
    try {
      buildSnapshot({ ...baseInput, sources: [huge] });
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain("melebihi batas");
    }
  });
});

describe("alias resolution", () => {
  it("maps validated aliases back to the real assessment ids", () => {
    const { aliasToAssessmentId } = buildSnapshot(baseInput);
    expect(resolveRefs([{ assessmentId: "ASS-2", itemId: "W08" }], aliasToAssessmentId)).toEqual([
      { assessmentId: guardianSource.id, itemId: "W08" },
    ]);
  });

  it("refuses an unknown alias rather than dropping the reference", () => {
    const { aliasToAssessmentId } = buildSnapshot(baseInput);
    expect(() => resolveRefs([{ assessmentId: "ASS-7", itemId: "W08" }], aliasToAssessmentId)).toThrow(ValidationError);
  });
});

describe("mock analysis", () => {
  it("produces output that passes the same schema and policy checks as a real model", () => {
    const { snapshot, allowedRefs } = buildSnapshot(baseInput);
    const result = runMockAnalysis(snapshot);
    expect(aiResultSchema.safeParse(result).success).toBe(true);
    expect(() => assertResultPolicy(result, allowedRefs)).not.toThrow();
  });

  it("is deterministic for the same snapshot", () => {
    const { snapshot } = buildSnapshot(baseInput);
    expect(JSON.stringify(runMockAnalysis(snapshot))).toBe(JSON.stringify(runMockAnalysis(snapshot)));
  });

  it("labels itself as a simulation in the summary and the limitations", () => {
    const result = runMockAnalysis(buildSnapshot(baseInput).snapshot);
    expect(result.summary).toContain(MOCK_SIMULATION_NOTICE);
    expect(result.limitations[0]).toBe(MOCK_SIMULATION_NOTICE);
  });

  it("never raises a safety concern on its own, because that decision belongs to humans", () => {
    const alarming: SourceAssessment = {
      ...childSource,
      answers: [likert("C01", 5), likert("C02", 5), likert("C04", 5), likert("C06", 5), text("C12", null, "skipped")],
    };
    const result = runMockAnalysis(buildSnapshot({ ...baseInput, sources: [alarming] }).snapshot);
    expect(result.safetyConcern).toEqual({ present: false, reason: null, sourceAnswerRefs: [] });
  });

  it("flags only structural facts, citing the items it counted", () => {
    const { snapshot, allowedRefs } = buildSnapshot(baseInput);
    const result = runMockAnalysis(snapshot);
    const cited = result.attentionIndicators.flatMap((indicator) => indicator.sourceAnswerRefs.map((ref) => `${ref.assessmentId}:${ref.itemId}`));
    expect(cited).toContain("ASS-1:C01");
    expect(cited).toContain("ASS-1:C12");
    for (const reference of cited) expect(allowedRefs.has(reference)).toBe(true);
  });

  it("keeps the priority away from any clinical reading when nothing is flagged", () => {
    const calm: SourceAssessment = { ...childSource, answers: [likert("C01", 1), likert("C02", 2), text("C11", "Ke pantai")] };
    const result = runMockAnalysis(buildSnapshot({ ...baseInput, sources: [calm] }).snapshot);
    expect(result.attentionIndicators).toHaveLength(0);
    expect(result.supportPriority).toBe("rutin");
  });

  it("omits guardian communication suggestions when no guardian answered", () => {
    const result = runMockAnalysis(buildSnapshot({ ...baseInput, scope: "child", sources: [childSource] }).snapshot);
    expect(result.guardianSuggestions).toHaveLength(0);
    expect(result.psychologistFollowupPoints.some((entry) => entry.includes("Belum ada asesmen wali"))).toBe(true);
  });
});
