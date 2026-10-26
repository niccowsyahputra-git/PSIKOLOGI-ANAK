import { z } from "zod";
import { ValidationError } from "./errors";

export type Module = "A" | "B" | "C" | "W";
export type Item = Readonly<{ id: string; kind: "emotion" | "media" | "text" | "likert"; text: string; sensitive: boolean; allowSkip: true }>;
const item = (id: string, kind: Item["kind"], text: string, sensitive = false): Item => Object.freeze({ id, kind, text, sensitive, allowSkip: true });
export const INSTRUMENT_VERSION = "intake-v1";
export const SKIP_REMINDER = "boleh dilewati jika belum ingin bercerita";
export const LIKERT_LABELS = ["Sangat tidak setuju", "Tidak setuju", "Ragu-ragu", "Setuju", "Sangat setuju"] as const;
export const EMOTIONS = [{ value: "senang", label: "Senang" }, { value: "biasa", label: "Biasa saja" }, { value: "sedih", label: "Sedih" }, { value: "marah", label: "Marah" }, { value: "takut", label: "Takut" }] as const;
export const INSTRUMENTS: Readonly<Record<Module, readonly Item[]>> = Object.freeze({
  A: Object.freeze([
    item("A01", "emotion", "Pilih wajah yang paling mirip dengan perasaanmu hari ini."),
    item("A02", "media", "Gambarlah dirimu sedang bermain bersama orang-orang atau hewan yang membuatmu nyaman."),
    item("A03", "text", "Kalau kamu punya tongkat ajaib, kamu ingin mengubah apa?"),
  ]),
  B: Object.freeze([
    item("B01", "text", "Saat aku sendirian di malam hari, aku merasa..."),
    item("B02", "text", "Hal yang paling membuatku marah adalah..."),
    item("B03", "text", "Aku sangat berharap ada orang dewasa yang mau..."),
    item("B04", "text", "Kalau aku bisa menjadi seekor hewan, aku ingin menjadi... karena..."),
    item("B05", "text", "Menurutku, orang dewasa itu..."),
    item("B06", "text", "Tempat yang paling membuatku merasa aman adalah..."),
    item("B07", "text", "Kalau aku bisa mengubah satu hal di keluargaku, aku ingin...", true),
    item("B08", "text", "Orang yang paling aku percaya adalah... karena..."),
    item("B09", "text", "Aku merasa dihargai ketika..."),
    item("B10", "text", "Hal yang membuatku takut tentang masa depan adalah..."),
    item("B11", "text", "Kalau aku bisa bicara dengan orang yang sudah tidak ada atau jauh dariku, aku ingin bilang...", true),
  ]),
  C: Object.freeze([
    item("C01", "likert", "Aku sering merasa masa depanku suram dan tidak ada harapan."),
    item("C02", "likert", "Aku merasa tidak ada satu orang pun yang benar-benar mengerti perasaanku."),
    item("C03", "likert", "Aku mudah sekali marah atau meledak-ledak padahal masalahnya sepele."),
    item("C04", "likert", "Kadang aku merasa aku adalah beban bagi orang lain."),
    item("C05", "likert", "Aku lebih suka menyendiri di kamar daripada berkumpul dengan orang banyak."),
    item("C06", "likert", "Aku merasa bersalah atas apa yang terjadi pada keluargaku."),
    item("C07", "likert", "Aku sulit mempercayai orang lain sepenuhnya."),
    item("C08", "likert", "Aku sering merasa kesepian meskipun ada orang di sekitarku."),
    item("C09", "likert", "Aku merasa harus menjadi kuat untuk orang lain, padahal aku juga butuh dukungan."),
    item("C10", "likert", "Aku khawatir tidak ada yang akan peduli padaku di masa depan."),
    item("C11", "text", "Jika kamu menemukan sebuah pintu ajaib yang bisa membawamu ke satu tempat atau satu waktu, ke mana kamu akan pergi dan kenapa?"),
    item("C12", "text", "Apa satu hal yang paling ingin kamu ubah dari dirimu atau dari masa lalumu?", true),
  ]),
  W: Object.freeze([
    item("W01", "likert", "Anak harus selalu menuruti kata orang tua tanpa banyak bertanya."),
    item("W02", "likert", "Saya sering merasa kehabisan energi dan hilang kesabaran saat menghadapi anak."),
    item("W03", "likert", "Lebih baik anak menangis sebentar karena dimarahi, daripada ia tumbuh jadi anak tidak sopan."),
    item("W04", "likert", "Saya merasa kesulitan menemani anak karena sibuk memikirkan kebutuhan sehari-hari."),
    item("W05", "text", "Anak Anda mengambil uang Rp 50.000 tanpa izin dan berbohong. Apa yang Anda katakan dan lakukan?"),
    item("W06", "text", "Anak Anda menangis di malam hari karena rindu masa lalu atau orang tuanya. Apa yang Anda lakukan?"),
    item("W07", "text", "Apa hal tersulit yang pernah Anda alami saat berusia sama dengan anak Anda sekarang?", true),
    item("W08", "text", "Apa harapan Anda menitipkan anak di sini dan apa rencana Anda untuknya saat dewasa?"),
    item("W09", "text", "Apa yang biasa Anda lakukan ketika Anda sendiri sedang stres atau banyak masalah? Apakah anak Anda melihatnya?"),
    item("W10", "text", "Seberapa sering Anda memeluk, memuji, atau mengatakan sayang kepada anak Anda dalam seminggu?"),
    item("W11", "text", "Apa ketakutan terbesar Anda tentang masa depan anak Anda?"),
    item("W12", "text", "Jika anak Anda melakukan kesalahan besar, siapa yang biasanya pertama kali ia cari atau takuti? Mengapa?"),
    item("W13", "text", "Apa satu hal yang Anda sesali dalam cara Anda mendidik anak selama ini?", true),
  ]),
});
export const INSTRUMENT_DEFINITION = Object.freeze({ version: INSTRUMENT_VERSION, modules: INSTRUMENTS, likertLabels: LIKERT_LABELS, emotions: EMOTIONS });

const base = { itemId: z.string(), state: z.enum(["answered", "skipped", "not_applicable"]), assistance: z.enum(["none", "read_aloud", "scribed"]), skipReason: z.string().max(500).optional() };
export const answerSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("text"), value: z.string().max(4000).nullable() }).strict(),
  z.object({ ...base, kind: z.literal("likert"), value: z.number().int().min(1).max(5).nullable() }).strict(),
  z.object({ ...base, itemId: z.literal("A01"), kind: z.literal("emotion"), value: z.enum(["senang", "biasa", "sedih", "marah", "takut"]).nullable() }).strict(),
  z.object({ ...base, itemId: z.literal("A02"), kind: z.literal("media"), activityMode: z.enum(["canvas", "photo", "paper_pending"]).nullable(), initialAttachmentId: z.uuid().nullable() }).strict(),
]);
export type Answer = z.infer<typeof answerSchema>;
export function validateAnswers(module: Module, input: unknown, final = false): Answer[] {
  const answers = z.array(answerSchema).max(13).parse(input);
  const ids = new Set<string>();
  for (const answer of answers) {
    const definition = INSTRUMENTS[module].find((entry) => entry.id === answer.itemId);
    if (!definition || definition.kind !== answer.kind || ids.has(answer.itemId)) throw new ValidationError("Item atau jenis jawaban tidak sesuai instrumen");
    ids.add(answer.itemId);
    if (answer.state !== "answered") {
      if (answer.kind === "media" ? answer.activityMode !== null || answer.initialAttachmentId !== null : answer.value !== null) throw new ValidationError("Jawaban yang dilewati tidak boleh memiliki nilai");
    } else if (answer.kind === "media") {
      if (!answer.activityMode || (answer.activityMode !== "paper_pending" && !answer.initialAttachmentId) || (answer.activityMode === "paper_pending" && answer.initialAttachmentId !== null)) throw new ValidationError("Aktivitas gambar belum lengkap");
    } else if (answer.value === null || (typeof answer.value === "string" && !answer.value.trim())) throw new ValidationError("Isi jawaban atau pilih dilewati");
  }
  if (final && ids.size !== INSTRUMENTS[module].length) throw new ValidationError("Setiap item perlu dijawab atau dipilih dilewati");
  return answers;
}

export function ageAtStart(birthDate: string | null, estimatedAge: number | null, referenceDate: string | null, startedAt: Date): { age: number; estimated: boolean } {
  const source = birthDate || referenceDate;
  if (!source || (!birthDate && estimatedAge === null)) throw new ValidationError("Tanggal lahir atau usia perkiraan beserta tanggal acuan diperlukan");
  const date = new Date(`${source}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date > startedAt) throw new ValidationError("Tanggal usia tidak valid");
  const elapsed = startedAt.getUTCFullYear() - date.getUTCFullYear() - (startedAt.getUTCMonth() < date.getUTCMonth() || (startedAt.getUTCMonth() === date.getUTCMonth() && startedAt.getUTCDate() < date.getUTCDate()) ? 1 : 0);
  return { age: birthDate ? elapsed : estimatedAge! + elapsed, estimated: !birthDate };
}
export function moduleForAge(age: number): Exclude<Module, "W"> {
  if (age >= 4 && age <= 8) return "A";
  if (age >= 9 && age <= 12) return "B";
  if (age >= 13 && age <= 18) return "C";
  throw new ValidationError("Instrumen anak hanya tersedia untuk usia 4–18 tahun");
}
