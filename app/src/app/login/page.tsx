import type { Metadata } from "next";
import { AppContainer, ScrollableContent } from "@/components/app-shell";
import { Badge, Card } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Masuk",
};

/**
 * Static shell: no session read, so this page prerenders and stays available
 * even before the local database is ready.
 */
export default function LoginPage() {
  return (
    <AppContainer>
      <ScrollableContent roomy>
        <div className="flex min-h-full flex-col justify-center py-6">
          <div className="mb-5 text-center">
            <span className="gradient-brand shadow-float mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[20px] text-lg font-semibold text-white">
              AP
            </span>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-sage-600 uppercase">
              Asesmen Psikososial Panti
            </p>
            <h1 className="mt-1.5 text-[22px] font-semibold tracking-tight text-ink-900">
              Masuk ke sistem lokal
            </h1>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-500">
              Aplikasi ini berjalan sepenuhnya di komputer panti. Tidak ada data
              yang dikirim ke internet.
            </p>
          </div>

          <Card>
            <LoginForm />
          </Card>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
            <Badge tone="sage">LOCAL ONLY</Badge>
            <Badge tone="sky">AI dalam mode simulasi</Badge>
            <Badge tone="neutral">Cetak laporan A4</Badge>
          </div>
        </div>
      </ScrollableContent>
    </AppContainer>
  );
}
