/** Display labels shared by staff and participant screens (client-safe). */
export const FAMILY_CONTEXT = [
  { value: "kehilangan_ayah", label: "Kehilangan ayah" },
  { value: "kehilangan_ibu", label: "Kehilangan ibu" },
  { value: "kehilangan_keduanya", label: "Kehilangan ayah dan ibu" },
  { value: "konflik_keluarga", label: "Konflik keluarga" },
  { value: "keterbatasan_ekonomi", label: "Keterbatasan ekonomi" },
] as const;
export const familyContextLabel = (value: string) => FAMILY_CONTEXT.find((entry) => entry.value === value)?.label ?? value;
export const SEX_LABELS: Record<string, string> = { female: "Perempuan", male: "Laki-laki", unknown: "Tidak dicatat" };
export const MODULE_LABELS: Record<string, string> = {
  A: "Modul A · usia 4–8 · wajah emosi & menggambar",
  B: "Modul B · usia 9–12 · melengkapi cerita",
  C: "Modul C · usia 13–18 · pernyataan & refleksi",
  W: "Modul W · orang tua / wali",
};
export const ASSESSMENT_STATUS: Record<string, string> = { draft: "Belum dikirim", submitted: "Terkirim", withdrawn: "Ditarik" };
export const CYCLE_STATUS: Record<string, string> = { draft: "Persiapan", active: "Berjalan", closed: "Ditutup" };
export const CONTACT_SAFETY: Record<string, string> = { safe: "Kontak aman (terverifikasi)", unsafe: "Kontak tidak aman", unknown: "Keamanan kontak belum diketahui" };
export const CONSENT_TYPES: Record<string, string> = { intake: "Persetujuan intake", assent: "Kesediaan anak (assent)", media: "Persetujuan gambar/foto", ai: "Persetujuan AI" };
export const CONSENT_STATUS: Record<string, string> = { granted: "Diberikan", declined: "Ditolak", withdrawn: "Ditarik", pending_authority_review: "Menunggu review kewenangan" };
export const ASSISTANCE_LABELS: Record<string, string> = { none: "Dijawab sendiri", read_aloud: "Pertanyaan dibacakan", scribed: "Jawaban dituliskan pendamping" };
export const RELATIONSHIPS = ["Ibu", "Ayah", "Nenek", "Kakek", "Bibi", "Paman", "Kakak", "Wali lain"] as const;
export const AI_SCOPE_LABELS: Record<string, string> = { child: "Jawaban anak asuh", guardian: "Jawaban orang tua / wali", combined: "Gabungan anak dan wali" };
export const AI_TIMEFRAME_LABELS: Record<string, string> = { segera: "Segera", minggu_ini: "Minggu ini", tindak_lanjut: "Tindak lanjut" };
/** Deliberately about how much a human should read, never a clinical risk level. */
export const AI_PRIORITY_LABELS: Record<string, string> = { belum_dapat_ditentukan: "Belum dapat ditentukan", rutin: "Pendampingan rutin", perlu_tinjauan: "Perlu ditinjau staf", segera: "Perlu perhatian segera" };
export const AI_DISPOSITION_LABELS: Record<string, string> = { support_approved: "Disetujui sebagai bahan dukungan", needs_revision: "Perlu perbaikan", rejected: "Ditolak" };
export const AI_ORIGIN_LABELS: Record<string, string> = { mock: "Simulasi lokal (bukan AI nyata)", local_model: "Model lokal", remote_model: "Model jarak jauh" };
