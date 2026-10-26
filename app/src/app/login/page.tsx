import type { Metadata } from "next";
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
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold tracking-[0.18em] text-sage-600 uppercase">
            Asesmen Psikososial Panti
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">
            Masuk ke sistem lokal
          </h1>
          <p className="mt-2 text-sm text-ink-500">
            Aplikasi ini berjalan sepenuhnya di komputer panti. Tidak ada data
            yang dikirim ke internet.
          </p>
        </div>

        <Card className="bg-white">
          <LoginForm />
        </Card>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-ink-500">
          <Badge tone="sage">LOCAL ONLY</Badge>
          <Badge tone="sky">AI dalam mode simulasi</Badge>
          <Badge tone="neutral">Cetak laporan A4</Badge>
        </div>
      </div>
    </main>
  );
}
