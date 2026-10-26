import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { ageAtStart, INSTRUMENTS, moduleForAge, validateAnswers } from "@/lib/instruments";
import { childInput } from "@/lib/validation/assessment.schema";

describe("intake-v1 instrument content", () => {
  it("keeps the exact item ids per module", () => {
    expect(INSTRUMENTS.A.map((item) => item.id)).toEqual(["A01", "A02", "A03"]);
    expect(INSTRUMENTS.B.map((item) => item.id)).toEqual(Array.from({ length: 11 }, (_, i) => `B${String(i + 1).padStart(2, "0")}`));
    expect(INSTRUMENTS.C.map((item) => item.id)).toEqual(Array.from({ length: 12 }, (_, i) => `C${String(i + 1).padStart(2, "0")}`));
    expect(INSTRUMENTS.W.map((item) => item.id)).toEqual(Array.from({ length: 13 }, (_, i) => `W${String(i + 1).padStart(2, "0")}`));
  });

  it("pins the normative question wording from PRD section 17", () => {
    expect(Object.values(INSTRUMENTS).flat().map((item) => item.text)).toEqual([
      "Pilih wajah yang paling mirip dengan perasaanmu hari ini.",
      "Gambarlah dirimu sedang bermain bersama orang-orang atau hewan yang membuatmu nyaman.",
      "Kalau kamu punya tongkat ajaib, kamu ingin mengubah apa?",
      "Saat aku sendirian di malam hari, aku merasa...",
      "Hal yang paling membuatku marah adalah...",
      "Aku sangat berharap ada orang dewasa yang mau...",
      "Kalau aku bisa menjadi seekor hewan, aku ingin menjadi... karena...",
      "Menurutku, orang dewasa itu...",
      "Tempat yang paling membuatku merasa aman adalah...",
      "Kalau aku bisa mengubah satu hal di keluargaku, aku ingin...",
      "Orang yang paling aku percaya adalah... karena...",
      "Aku merasa dihargai ketika...",
      "Hal yang membuatku takut tentang masa depan adalah...",
      "Kalau aku bisa bicara dengan orang yang sudah tidak ada atau jauh dariku, aku ingin bilang...",
      "Aku sering merasa masa depanku suram dan tidak ada harapan.",
      "Aku merasa tidak ada satu orang pun yang benar-benar mengerti perasaanku.",
      "Aku mudah sekali marah atau meledak-ledak padahal masalahnya sepele.",
      "Kadang aku merasa aku adalah beban bagi orang lain.",
      "Aku lebih suka menyendiri di kamar daripada berkumpul dengan orang banyak.",
      "Aku merasa bersalah atas apa yang terjadi pada keluargaku.",
      "Aku sulit mempercayai orang lain sepenuhnya.",
      "Aku sering merasa kesepian meskipun ada orang di sekitarku.",
      "Aku merasa harus menjadi kuat untuk orang lain, padahal aku juga butuh dukungan.",
      "Aku khawatir tidak ada yang akan peduli padaku di masa depan.",
      "Jika kamu menemukan sebuah pintu ajaib yang bisa membawamu ke satu tempat atau satu waktu, ke mana kamu akan pergi dan kenapa?",
      "Apa satu hal yang paling ingin kamu ubah dari dirimu atau dari masa lalumu?",
      "Anak harus selalu menuruti kata orang tua tanpa banyak bertanya.",
      "Saya sering merasa kehabisan energi dan hilang kesabaran saat menghadapi anak.",
      "Lebih baik anak menangis sebentar karena dimarahi, daripada ia tumbuh jadi anak tidak sopan.",
      "Saya merasa kesulitan menemani anak karena sibuk memikirkan kebutuhan sehari-hari.",
      "Anak Anda mengambil uang Rp 50.000 tanpa izin dan berbohong. Apa yang Anda katakan dan lakukan?",
      "Anak Anda menangis di malam hari karena rindu masa lalu atau orang tuanya. Apa yang Anda lakukan?",
      "Apa hal tersulit yang pernah Anda alami saat berusia sama dengan anak Anda sekarang?",
      "Apa harapan Anda menitipkan anak di sini dan apa rencana Anda untuknya saat dewasa?",
      "Apa yang biasa Anda lakukan ketika Anda sendiri sedang stres atau banyak masalah? Apakah anak Anda melihatnya?",
      "Seberapa sering Anda memeluk, memuji, atau mengatakan sayang kepada anak Anda dalam seminggu?",
      "Apa ketakutan terbesar Anda tentang masa depan anak Anda?",
      "Jika anak Anda melakukan kesalahan besar, siapa yang biasanya pertama kali ia cari atau takuti? Mengapa?",
      "Apa satu hal yang Anda sesali dalam cara Anda mendidik anak selama ini?",
    ]);
  });

  it("uses the expected item kinds and keeps every item skippable", () => {
    expect(INSTRUMENTS.A.map((item) => item.kind)).toEqual(["emotion", "media", "text"]);
    expect(INSTRUMENTS.C.slice(0, 10).every((item) => item.kind === "likert")).toBe(true);
    expect(INSTRUMENTS.C.slice(10).every((item) => item.kind === "text")).toBe(true);
    expect(INSTRUMENTS.W.slice(0, 4).every((item) => item.kind === "likert")).toBe(true);
    expect(Object.values(INSTRUMENTS).flat().every((item) => item.allowSkip)).toBe(true);
  });

  it("marks the sensitive items", () => {
    const sensitive = Object.values(INSTRUMENTS).flat().filter((item) => item.sensitive).map((item) => item.id);
    expect(sensitive).toEqual(["B07", "B11", "C12", "W07", "W13"]);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(INSTRUMENTS)).toBe(true);
    expect(Object.isFrozen(INSTRUMENTS.W)).toBe(true);
  });
});

describe("age and module selection", () => {
  it("maps ages to modules on the boundaries", () => {
    expect(moduleForAge(4)).toBe("A");
    expect(moduleForAge(8)).toBe("A");
    expect(moduleForAge(9)).toBe("B");
    expect(moduleForAge(12)).toBe("B");
    expect(moduleForAge(13)).toBe("C");
    expect(moduleForAge(18)).toBe("C");
    expect(() => moduleForAge(3)).toThrow(ValidationError);
    expect(() => moduleForAge(19)).toThrow(ValidationError);
  });

  it("computes age at start from birth date, a day before and on the birthday", () => {
    const start = new Date("2026-06-15T08:00:00Z");
    expect(ageAtStart("2017-06-16", null, null, start)).toEqual({ age: 8, estimated: false });
    expect(ageAtStart("2017-06-15", null, null, start)).toEqual({ age: 9, estimated: false });
  });

  it("advances an estimated age from its reference date", () => {
    const start = new Date("2026-06-15T08:00:00Z");
    expect(ageAtStart(null, 10, "2024-06-15", start)).toEqual({ age: 12, estimated: true });
    expect(() => ageAtStart(null, null, null, start)).toThrow(ValidationError);
  });
});

describe("answer validation", () => {
  it("accepts answered, skipped and assisted answers", () => {
    const answers = validateAnswers("A", [
      { itemId: "A01", kind: "emotion", state: "answered", assistance: "read_aloud", value: "senang" },
      { itemId: "A02", kind: "media", state: "answered", assistance: "none", activityMode: "paper_pending", initialAttachmentId: null },
      { itemId: "A03", kind: "text", state: "skipped", assistance: "scribed", value: null },
    ], true);
    expect(answers).toHaveLength(3);
  });

  it("rejects items from another module, wrong kinds and duplicates", () => {
    expect(() => validateAnswers("B", [{ itemId: "C01", kind: "likert", state: "answered", assistance: "none", value: 3 }])).toThrow(ValidationError);
    expect(() => validateAnswers("C", [{ itemId: "C01", kind: "text", state: "answered", assistance: "none", value: "x" }])).toThrow(ValidationError);
    const twice = { itemId: "W01", kind: "likert", state: "answered", assistance: "none", value: 2 };
    expect(() => validateAnswers("W", [twice, twice])).toThrow(ValidationError);
  });

  it("rejects out-of-range likert values and values on skipped items", () => {
    expect(() => validateAnswers("C", [{ itemId: "C01", kind: "likert", state: "answered", assistance: "none", value: 6 }])).toThrow();
    expect(() => validateAnswers("C", [{ itemId: "C01", kind: "likert", state: "skipped", assistance: "none", value: 2 }])).toThrow(ValidationError);
  });

  it("rejects blank text and incomplete drawings", () => {
    expect(() => validateAnswers("B", [{ itemId: "B01", kind: "text", state: "answered", assistance: "none", value: "   " }])).toThrow(ValidationError);
    expect(() => validateAnswers("A", [{ itemId: "A02", kind: "media", state: "answered", assistance: "none", activityMode: "canvas", initialAttachmentId: null }])).toThrow(ValidationError);
  });

  it("allows partial drafts but requires every item on submit", () => {
    const one = [{ itemId: "W05", kind: "text", state: "answered", assistance: "none", value: "Saya ajak bicara" }];
    expect(validateAnswers("W", one)).toHaveLength(1);
    expect(() => validateAnswers("W", one, true)).toThrow(ValidationError);
  });
});

describe("child profile family context", () => {
  const base = { name: "Anak Fiktif", fictional: true, estimatedAge: 7, ageReferenceDate: "2026-01-01" };
  it("accepts the fixed family context values", () => {
    expect(childInput.parse({ ...base, background: ["kehilangan_ayah", "keterbatasan_ekonomi"] }).background).toEqual(["kehilangan_ayah", "keterbatasan_ekonomi"]);
  });
  it("rejects free text and duplicates", () => {
    expect(() => childInput.parse({ ...base, background: ["lainnya"] })).toThrow();
    expect(() => childInput.parse({ ...base, background: ["konflik_keluarga", "konflik_keluarga"] })).toThrow();
  });
  it("requires either a birth date or an estimated age with reference date", () => {
    expect(() => childInput.parse({ name: "Anak", fictional: true })).toThrow();
    expect(() => childInput.parse({ ...base, birthDate: "2018-01-01" })).toThrow();
  });
});
