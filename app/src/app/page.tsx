import Link from "next/link";
import { AppContainer, ScrollableContent } from "@/components/app-shell";
import { ChildIcon, GuardianIcon } from "@/components/icons";
import { Badge, primaryButtonClassName, secondaryButtonClassName } from "@/components/ui";

/**
 * The root URL is only an entry point: authenticated staff continue to the
 * dashboard, everyone else to the local login (no public signup route, FR-01).
 * Styled as the app's launch screen, not a marketing page.
 */
export default function Home() {
  return (
    <AppContainer>
      <ScrollableContent roomy>
        <div className="flex min-h-full flex-col justify-center gap-5 py-6">
          <div className="text-center">
            <span className="gradient-brand shadow-float mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[22px] text-xl font-semibold text-white">
              AP
            </span>
            <Badge tone="sage">LOCAL FIRST · PRIVAT</Badge>
            <h1 className="mt-3 text-[26px] leading-tight font-semibold tracking-tight text-ink-900">
              Ruang bercerita untuk anak.
              <br />
              Ruang refleksi untuk wali.
            </h1>
            <p className="mt-2.5 text-[13px] leading-relaxed text-ink-500">
              Kegiatan sesuai usia untuk anak asuh dan kuesioner terpisah untuk
              orang tua / wali. Bukan ujian, tidak ada nilai lulus atau gagal.
            </p>
          </div>

          <div className="space-y-2.5">
            <div className="shadow-card flex items-start gap-3 rounded-3xl bg-sage-50 p-3.5">
              <span className="gradient-brand flex h-10 w-10 flex-none items-center justify-center rounded-2xl text-white">
                <ChildIcon size={20} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-ink-900">Untuk anak asuh</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-ink-700">
                  Wajah emosi &amp; menggambar (4–8), melengkapi cerita (9–12),
                  atau pernyataan &amp; refleksi (13–18). Setiap pertanyaan boleh
                  dilewati.
                </span>
              </span>
            </div>
            <div className="shadow-card flex items-start gap-3 rounded-3xl bg-sky-soft-50 p-3.5">
              <span className="gradient-brand flex h-10 w-10 flex-none items-center justify-center rounded-2xl text-white">
                <GuardianIcon size={20} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-ink-900">
                  Untuk orang tua / wali
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-ink-700">
                  13 pertanyaan tentang pengalaman dan pendampingan anak. Jawaban
                  anak tidak diperlihatkan kepada wali.
                </span>
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Link className={`${primaryButtonClassName} w-full`} href="/login">
              Masuk sebagai staf
            </Link>
            <Link className={`${secondaryButtonClassName} w-full`} href="/intake">
              Masuk sesi peserta
            </Link>
          </div>

          <p className="text-center text-[11px] leading-relaxed text-ink-500">
            Peserta memerlukan tautan sesi dari staf. Demonstrasi memakai data
            fiktif; penggunaan nyata memerlukan pengesahan instrumen dan
            persetujuan. Tidak ada diagnosis atau keputusan penerimaan otomatis.
          </p>
        </div>
      </ScrollableContent>
    </AppContainer>
  );
}
