import type { AiResult, SourceAnswerRef } from "./result.schema";
import type { AnalysisSnapshot, SnapshotAnswer, SnapshotSource } from "./snapshot";

/**
 * Deterministic local simulation (PRD section 11.1). It exercises the whole
 * generate/validate/store/review workflow with zero network calls, and it does
 * NOT assess anyone: the rules below are structural (which items were answered,
 * which Likert positions were chosen) and never interpret meaning.
 *
 * Every result produced here is stored with `result_origin=mock` and carries
 * the simulation badge, so it can never be mistaken for or approved as real
 * support (BR-26).
 */
export const MOCK_SIMULATION_NOTICE =
  "SIMULASI DEVELOPMENT — BUKAN ANALISIS NYATA. Keluaran ini dihasilkan aturan tetap di laptop untuk menguji alur kerja, bukan oleh model AI dan bukan penilaian psikologis.";

export const MOCK_PROVIDER = "Mock lokal";

const MAX_ITEMS = 20;

/** Items whose wording invites the respondent to name a source of support. */
const SUPPORT_ITEMS = new Set(["A03", "B03", "B06", "B08", "B09", "C11", "W08", "W10"]);
/** Items the instrument itself marks as sensitive in wording. */
const SENSITIVE_ITEMS = new Set(["B07", "B11", "C06", "C12", "W07", "W13"]);
/** Emotions that the simulation treats as worth a human looking at the answer. */
const ATTENTION_EMOTIONS = new Set(["sedih", "marah", "takut"]);

type Ref = SourceAnswerRef;

function ref(source: SnapshotSource, answer: SnapshotAnswer): Ref {
  return { assessmentId: source.alias, itemId: answer.itemId };
}

function answered(source: SnapshotSource): SnapshotAnswer[] {
  return source.answers.filter((answer) => answer.state === "answered" && answer.answer !== null);
}

/** Likert position 4 or 5 means the respondent agreed with the statement. */
function isHighAgreement(answer: SnapshotAnswer): boolean {
  return answer.kind === "likert" && /\((4|5) dari 5\)$/.test(answer.answer ?? "");
}

export function runMockAnalysis(snapshot: AnalysisSnapshot): AiResult {
  const childSources = snapshot.sources.filter((source) => source.target === "child");
  const guardianSources = snapshot.sources.filter((source) => source.target === "guardian");

  const agreementRefs: Ref[] = [];
  const supportRefs: Ref[] = [];
  const sensitiveSkippedRefs: Ref[] = [];
  const emotionRefs: Ref[] = [];
  const skippedCount = { value: 0 };

  for (const source of snapshot.sources) {
    for (const answer of source.answers) {
      if (answer.state !== "answered") {
        skippedCount.value += 1;
        if (SENSITIVE_ITEMS.has(answer.itemId)) sensitiveSkippedRefs.push(ref(source, answer));
        continue;
      }
      if (isHighAgreement(answer)) agreementRefs.push(ref(source, answer));
      if (SUPPORT_ITEMS.has(answer.itemId) && answer.answer !== null) supportRefs.push(ref(source, answer));
      if (answer.kind === "emotion" && ATTENTION_EMOTIONS.has((answer.answer ?? "").toLowerCase())) {
        emotionRefs.push(ref(source, answer));
      }
    }
  }

  const protectiveFactors: string[] = [];
  if (supportRefs.length > 0) {
    protectiveFactors.push(
      `Simulasi mencatat ${supportRefs.length} jawaban pada item yang menanyakan sumber dukungan, tempat nyaman, atau harapan. Isi jawabannya perlu dibaca sendiri oleh staf.`,
    );
  }
  for (const source of snapshot.sources) {
    const filled = answered(source).length;
    if (filled > 0) {
      protectiveFactors.push(
        `Sumber ${source.alias} (${source.target === "child" ? "anak" : "wali"}, modul ${source.module}) terisi ${filled} dari ${source.answers.length} item, sehingga ada bahan untuk dibicarakan bersama.`,
      );
    }
  }
  if (guardianSources.length > 0) {
    protectiveFactors.push("Wali bersedia mengisi asesmen, yang memberi pengasuh pintu masuk untuk berdiskusi.");
  }

  const attentionIndicators: AiResult["attentionIndicators"] = [];
  if (agreementRefs.length > 0) {
    attentionIndicators.push({
      description: `Simulasi menandai ${agreementRefs.length} pernyataan yang disetujui pada posisi 4–5. Penandaan ini murni posisi pilihan, bukan penilaian keadaan anak.`,
      sourceAnswerRefs: agreementRefs.slice(0, MAX_ITEMS),
      uncertainty: "Aturan tetap tidak memahami isi jawaban; staf harus membaca teks aslinya sebelum menyimpulkan apa pun.",
    });
  }
  if (emotionRefs.length > 0) {
    attentionIndicators.push({
      description: "Pilihan wajah pada item emosi berada di luar pilihan senang atau biasa saja pada hari pengisian.",
      sourceAnswerRefs: emotionRefs.slice(0, MAX_ITEMS),
      uncertainty: "Satu pilihan emosi hanya menggambarkan hari itu dan tidak menggambarkan keadaan anak secara umum.",
    });
  }
  if (sensitiveSkippedRefs.length > 0) {
    attentionIndicators.push({
      description: `${sensitiveSkippedRefs.length} item bertopik sensitif dilewati. Melewati item adalah hak peserta dan bukan tanda adanya masalah.`,
      sourceAnswerRefs: sensitiveSkippedRefs.slice(0, MAX_ITEMS),
      uncertainty: "Alasan melewati tidak diketahui; jangan menafsirkan kekosongan sebagai bukti apa pun.",
    });
  }

  const caregiverSuggestions: AiResult["caregiverSuggestions"] = [
    {
      action: "Baca sendiri seluruh jawaban asli pada halaman rekaman asesmen.",
      purpose: "Keluaran simulasi ini tidak menilai isi jawaban, sehingga pembacaan manusia tetap sumber utama.",
      timeframe: "segera",
    },
    {
      action: "Sediakan waktu bercakap santai tanpa menanyai anak soal jawabannya secara beruntun.",
      purpose: "Menjaga rasa aman peserta setelah mengisi instrumen.",
      timeframe: "minggu_ini",
    },
  ];
  if (attentionIndicators.length > 0) {
    caregiverSuggestions.push({
      action: "Catat pengamatan harian secukupnya pada catatan perkembangan dan bawa ke pertemuan staf berikutnya.",
      purpose: "Menyiapkan bahan nyata untuk dibahas psikolog, bukan menambah kesimpulan dari keluaran simulasi.",
      timeframe: "tindak_lanjut",
    });
  }

  const guardianSuggestions: string[] =
    guardianSources.length > 0
      ? [
          "Sampaikan terima kasih kepada wali atas kesediaannya mengisi dan jelaskan bahwa hasil ini belum ditinjau profesional.",
          "Tanyakan kebutuhan praktis wali yang dapat dibantu panti tanpa membahas jawaban anak.",
        ]
      : [];

  const psychologistFollowupPoints: string[] = [
    "Verifikasi apakah seluruh sumber yang relevan sudah terkirim sebelum menyusun penilaian profesional.",
    "Keluaran ini simulasi aturan tetap; psikolog perlu memakai wawancara dan observasi sendiri.",
  ];
  if (snapshot.cycle.partial) {
    psychologistFollowupPoints.push("Analisis dijalankan dalam mode sebagian; pertimbangkan menunggu sumber yang belum masuk.");
  }
  if (childSources.length > 0 && guardianSources.length === 0) {
    psychologistFollowupPoints.push("Belum ada asesmen wali pada siklus ini, sehingga sudut pandang pengasuh utama belum terwakili.");
  }

  const limitations = [MOCK_SIMULATION_NOTICE, ...snapshot.limitations];
  if (skippedCount.value > 0) {
    limitations.push(`${skippedCount.value} item tidak terisi; simulasi tidak menebak isinya.`);
  }

  // Priority reflects how much material a human should look at, never a risk level.
  const supportPriority: AiResult["supportPriority"] =
    attentionIndicators.length === 0
      ? "rutin"
      : agreementRefs.length >= 4
        ? "perlu_tinjauan"
        : "belum_dapat_ditentukan";

  return {
    schemaVersion: "1",
    summary: `${MOCK_SIMULATION_NOTICE} Ringkasan struktural: ${snapshot.sources.length} sumber terkirim (${childSources.length} anak, ${guardianSources.length} wali) pada modul ${snapshot.subject.module}, usia ${snapshot.subject.ageAtStart} tahun${snapshot.subject.ageIsEstimated ? " (perkiraan)" : ""}. Simulasi hanya menghitung pola pengisian dan tidak menafsirkan isi jawaban.`,
    protectiveFactors: protectiveFactors.slice(0, MAX_ITEMS),
    attentionIndicators: attentionIndicators.slice(0, MAX_ITEMS),
    caregiverSuggestions: caregiverSuggestions.slice(0, MAX_ITEMS),
    guardianSuggestions: guardianSuggestions.slice(0, MAX_ITEMS),
    psychologistFollowupPoints: psychologistFollowupPoints.slice(0, MAX_ITEMS),
    limitations: limitations.slice(0, MAX_ITEMS),
    supportPriority,
    // The simulation never raises a safety concern on its own: inventing one
    // would teach staff to trust a rule engine for exactly the decision that
    // PRD section 12.2 reserves for humans following the local SOP.
    safetyConcern: { present: false, reason: null, sourceAnswerRefs: [] },
  };
}
