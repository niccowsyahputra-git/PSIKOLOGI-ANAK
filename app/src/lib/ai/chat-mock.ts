import type { ChatContext } from "./chat-context";

/**
 * Deterministic local simulation of a discussion turn, the chat counterpart of
 * `mock.ts`. It performs no language understanding at all: it restates what the
 * context pack contains so the whole thread workflow (permission, consent gate,
 * quota, grounding, storage, display) can be exercised with zero network calls.
 *
 * Every answer produced here is stored with `result_origin=mock` and carries
 * the simulation notice, so it can never be mistaken for a real answer (BR-26).
 */
export const MOCK_CHAT_NOTICE =
  "SIMULASI LOKAL — BUKAN JAWABAN AI. Balasan ini dirangkai aturan tetap di laptop ini untuk menguji alur diskusi, bukan oleh model bahasa, dan bukan penilaian psikologis.";

export const MOCK_CHAT_PROVIDER = "Mock lokal";

const MAX_LINES = 14;

function counts(label: string, values: Record<string, number>): string | null {
  const parts = Object.entries(values)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${key} ${value}`);
  return parts.length === 0 ? null : `- ${label}: ${parts.join(", ")}.`;
}

function childLines(context: ChatContext): string[] {
  const child = context.child;
  if (!child) return [];
  const lines = [`- Anak asuh ini berstatus profil ${child.profileState} dengan ${child.cycles.length} siklus pada basis data.`];
  if (child.guardians.length > 0) {
    lines.push(`- Wali terhubung: ${child.guardians.map((guardian) => `${guardian.alias} (${guardian.relationship})`).join(", ")}.`);
  }
  for (const cycle of child.cycles) {
    const withheld = cycle.assessments.filter((assessment) => assessment.answers === null).length;
    const answered = cycle.assessments.reduce(
      (total, assessment) => total + (assessment.answers?.filter((answer) => answer.state === "answered").length ?? 0),
      0,
    );
    lines.push(
      `- ${cycle.alias}: ${cycle.kind}, modul ${cycle.module}, status ${cycle.status}, ${cycle.assessments.length} asesmen, ${answered} jawaban terisi yang dikirim ke konteks${withheld > 0 ? `, ${withheld} asesmen jawabannya tidak disertakan` : ""}, ${cycle.analyses.length} analisis AI.`,
    );
  }
  return lines;
}

function organizationLines(context: ChatContext): string[] {
  const facts = context.organization;
  return [
    counts("Anak asuh per status profil", facts.childrenByState),
    `- Wali tercatat: ${facts.guardianTotal}, hubungan anak–wali aktif: ${facts.linkTotal}.`,
    counts("Siklus per status", facts.cyclesByStatus),
    counts("Asesmen per status", facts.assessmentsByStatus),
    counts("Asesmen per sasaran", facts.assessmentsByTarget),
    counts("Analisis AI per asal hasil", facts.analysesByOrigin),
    counts("Keputusan review", facts.reviewsByDisposition),
    `- Catatan pengamatan staf: ${facts.observationTotal} (isinya tidak dikirim). Tautan intake aktif: ${facts.liveIntakeSessions}.`,
  ].filter((line): line is string => line !== null);
}

/**
 * The simulation never answers the question itself: pretending to understand it
 * would teach staff to trust a rule engine for exactly the reading that a human
 * has to do.
 */
export function runMockChat(context: ChatContext): string {
  const lines = [
    MOCK_CHAT_NOTICE,
    "Simulasi tidak memahami pertanyaan Anda. Yang dapat ditampilkan hanyalah isi konteks yang dibaca dari basis data panti ini:",
    ...(context.child ? childLines(context) : organizationLines(context)),
    `Keterbatasan: seluruh angka di atas berasal dari basis data lokal ini pada ${context.generatedAt}; tidak ada sumber luar, dan jawaban nyata baru tersedia setelah admin mengaktifkan model lokal di halaman Konfigurasi AI.`,
  ];
  return lines.slice(0, MAX_LINES).join("\n");
}
