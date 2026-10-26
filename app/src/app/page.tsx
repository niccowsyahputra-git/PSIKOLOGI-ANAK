import Link from "next/link";
import { Badge, primaryButtonClassName, secondaryButtonClassName } from "@/components/ui";

/**
 * The root URL is only an entry point: authenticated staff continue to the
 * dashboard, everyone else to the local login (no public signup route, FR-01).
 */
export default function Home() {
  return <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-8 px-6 py-14">
    <div><Badge tone="sage">LOCAL FIRST · PRIVAT</Badge><p className="mt-8 text-sm font-medium tracking-widest text-sage-700 uppercase">Asesmen psikososial anak & keluarga</p><h1 className="mt-4 max-w-3xl text-4xl leading-tight font-semibold text-ink-900 sm:text-6xl">Ruang bercerita untuk anak.<br />Ruang refleksi untuk wali.</h1><p className="mt-6 max-w-2xl text-lg text-ink-500">Kegiatan sesuai usia untuk anak asuh dan kuesioner terpisah untuk orang tua / wali. Bukan ujian, tidak ada nilai lulus atau gagal.</p></div>
    <div className="grid gap-4 sm:grid-cols-2"><section className="rounded-3xl bg-sage-100 p-6"><h2 className="text-xl font-semibold">Untuk anak asuh</h2><p className="mt-3 text-ink-700">Wajah emosi & menggambar (4–8), melengkapi cerita (9–12), atau pernyataan & refleksi (13–18). Setiap pertanyaan boleh dilewati.</p></section><section className="rounded-3xl bg-sky-soft-100 p-6"><h2 className="text-xl font-semibold">Untuk orang tua / wali</h2><p className="mt-3 text-ink-700">13 pertanyaan tentang pengalaman dan pendampingan anak. Jawaban anak tidak diperlihatkan kepada wali.</p></section></div>
    <div className="flex flex-wrap gap-3"><Link className={primaryButtonClassName} href="/login">Masuk sebagai staf</Link><Link className={secondaryButtonClassName} href="/intake">Masuk sesi peserta</Link></div><p className="text-sm text-ink-500">Peserta memerlukan tautan sesi dari staf. Demonstrasi memakai data fiktif; penggunaan nyata memerlukan pengesahan instrumen dan persetujuan. Tidak ada diagnosis atau keputusan penerimaan otomatis.</p>
  </main>;
}
