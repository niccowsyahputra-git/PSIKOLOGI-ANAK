import { sha256Hex } from "@/lib/crypto";
import type { Module } from "@/lib/instruments";
import type { SnapshotAnswer } from "./snapshot";

/**
 * Context pack for the staff discussion assistant (the chat counterpart of
 * `snapshot.ts`). Everything the assistant may use when answering one turn is
 * assembled here from rows of this local database only — there is no retrieval
 * from the web, no file outside the installation, and no other organization.
 *
 * The privacy design of the analysis snapshot is kept unchanged: names, birth
 * dates, contacts, addresses, staff identities, storage keys and internal UUIDs
 * stay out, participants appear as positional aliases, and image files are only
 * described. One rule is added for this feature: free text written by staff
 * (profile notes, accessibility needs, observations, contact review notes) is
 * only flagged, never sent, because it routinely names real people.
 */
export const CHAT_CONTEXT_SCHEMA_VERSION = "1";

/**
 * Bound on the serialized pack. Unlike the analysis snapshot this never throws:
 * a thread about a child with a long history must stay usable, so the oldest
 * material is dropped and the omission is declared inside the pack itself.
 */
export const MAX_CHAT_CONTEXT_CHARS = 24000;

export type ChatCounts = Record<string, number>;

export type ChatOrganizationFacts = {
  timezone: string;
  childrenByState: ChatCounts;
  guardianTotal: number;
  linkTotal: number;
  cyclesByStatus: ChatCounts;
  assessmentsByStatus: ChatCounts;
  assessmentsByTarget: ChatCounts;
  analysesByOrigin: ChatCounts;
  reviewsByDisposition: ChatCounts;
  observationTotal: number;
  liveIntakeSessions: number;
};

export type ChatContextAssessment = {
  alias: string;
  target: "child" | "guardian";
  guardianAlias: string | null;
  module: Module;
  status: string;
  respondent: string;
  assistance: string;
  submittedAt: string | null;
  observationCount: number;
  /** `null` means the answers exist in the database but were not sent. */
  answers: SnapshotAnswer[] | null;
};

export type ChatContextAnalysis = {
  alias: string;
  scope: string;
  resultOrigin: string;
  createdAt: string;
  supportPriority: string;
  summary: string;
  disposition: string | null;
};

export type ChatContextCycle = {
  alias: string;
  kind: string;
  module: Module;
  status: string;
  startedAt: string;
  fictional: boolean;
  ageAtStart: number;
  ageIsEstimated: boolean;
  aiConsentGranted: boolean;
  consents: Array<{ type: string; status: string; subject: string }>;
  assessments: ChatContextAssessment[];
  analyses: ChatContextAnalysis[];
};

export type ChatContextChild = {
  pseudonym: string;
  profileState: string;
  fictional: boolean;
  backgroundContext: string[];
  accessibilityRecorded: boolean;
  notesRecorded: boolean;
  guardians: Array<{ alias: string; relationship: string; isPrimary: boolean; authorityStatus: string; contactSafety: string }>;
  cycles: ChatContextCycle[];
};

export type ChatContext = {
  schemaVersion: typeof CHAT_CONTEXT_SCHEMA_VERSION;
  scope: "organization" | "child";
  generatedAt: string;
  organization: ChatOrganizationFacts;
  child: ChatContextChild | null;
  /** Machine-readable statement of what this pack does and does not contain. */
  dataBoundary: string[];
};

export type ChatContextBundle = {
  context: ChatContext;
  serialized: string;
  contextHash: string;
};

const BASE_BOUNDARY = [
  "Semua fakta di konteks ini dibaca langsung dari basis data lokal panti ini.",
  "Tidak ada sumber lain yang tersedia: tidak ada internet, tidak ada berkas di luar instalasi ini, dan tidak ada data panti lain.",
  "Nama, tanggal lahir, kontak, alamat, identitas staf, dan id internal tidak disertakan.",
  "Teks bebas yang ditulis staf (catatan profil, kebutuhan pendampingan, catatan pengamatan, catatan review kontak) tidak dikirim; hanya penanda bahwa catatan itu ada, agar nama yang mungkin tertulis di dalamnya tidak keluar dari basis data.",
  "Berkas gambar tidak dikirim dan tidak boleh ditafsirkan.",
];

/** Newest cycle first: a discussion almost always starts from the current one. */
function byNewest(left: ChatContextCycle, right: ChatContextCycle): number {
  return right.startedAt.localeCompare(left.startedAt);
}

/**
 * Trims the pack until it fits, oldest material first, and declares every
 * omission. Answers of older cycles go before whole cycles, because the status
 * of a cycle stays useful even once its answers are no longer attached.
 */
function fit(context: ChatContext): string {
  let serialized = JSON.stringify(context);
  if (serialized.length <= MAX_CHAT_CONTEXT_CHARS || !context.child) return serialized;

  const cycles = context.child.cycles;
  let strippedAnswers = 0;
  for (let index = cycles.length - 1; index >= 0 && serialized.length > MAX_CHAT_CONTEXT_CHARS; index -= 1) {
    for (const assessment of cycles[index].assessments) {
      if (assessment.answers !== null) {
        assessment.answers = null;
        strippedAnswers += 1;
      }
    }
    serialized = JSON.stringify(context);
  }
  if (strippedAnswers > 0) {
    context.dataBoundary.push(
      `Konteks terlalu besar, sehingga jawaban ${strippedAnswers} asesmen pada siklus terlama tidak disertakan. Buka halaman asesmennya untuk membacanya sendiri.`,
    );
    serialized = JSON.stringify(context);
  }

  let droppedCycles = 0;
  while (serialized.length > MAX_CHAT_CONTEXT_CHARS && cycles.length > 1) {
    cycles.pop();
    droppedCycles += 1;
    serialized = JSON.stringify(context);
  }
  if (droppedCycles > 0) {
    context.dataBoundary.push(`${droppedCycles} siklus terlama tidak disertakan dalam konteks ini.`);
    serialized = JSON.stringify(context);
  }
  return serialized;
}

/**
 * Assembles the pack from rows the caller has already authorized and fetched.
 * Free of database access on purpose, so the data boundary is testable on its
 * own. The cycles are copied before trimming, so a caller never sees its own
 * input emptied out.
 */
export function buildChatContext(input: {
  generatedAt: Date;
  organization: ChatOrganizationFacts;
  child: ChatContextChild | null;
}): ChatContextBundle {
  const child = input.child
    ? {
        ...input.child,
        cycles: [...input.child.cycles]
          .sort(byNewest)
          .map((cycle) => ({ ...cycle, assessments: cycle.assessments.map((assessment) => ({ ...assessment })) })),
      }
    : null;
  const dataBoundary = [...BASE_BOUNDARY];

  if (child) {
    dataBoundary.push("Konteks ini terbatas pada satu anak asuh beserta siklus, asesmen, dan analisis miliknya.");
    const withheld = child.cycles.filter((cycle) => cycle.assessments.some((assessment) => assessment.answers === null));
    for (const cycle of withheld) {
      dataBoundary.push(
        `Jawaban pada siklus ${cycle.alias} tidak disertakan karena persetujuan penggunaan AI untuk siklus itu belum diberikan atau sudah ditarik.`,
      );
    }
  } else {
    dataBoundary.push("Konteks ini hanya memuat jumlah agregat panti; tidak ada jawaban asesmen maupun data satu anak di dalamnya.");
  }

  const context: ChatContext = {
    schemaVersion: CHAT_CONTEXT_SCHEMA_VERSION,
    scope: child ? "child" : "organization",
    generatedAt: input.generatedAt.toISOString(),
    organization: input.organization,
    child,
    dataBoundary,
  };

  const serialized = fit(context);
  return { context, serialized, contextHash: sha256Hex(serialized) };
}
