import Link from "next/link";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { can } from "@/lib/permissions";
import { workspaceStats, listResults } from "@/server/services/assessment.service";
import { getOrganizationLetterhead } from "@/server/services/settings.service";
import { OrganizationSummary } from "./letterhead";
import { ChildIcon, GuardianIcon, ResultIcon, ChevronRightIcon } from "./icons";
import {
  Badge,
  Card,
  EmptyState,
  FeatureCard,
  StatusBadge,
  SummaryCard,
  primaryButtonClassName,
  secondaryButtonClassName,
} from "./ui";
import { formatDateTime } from "@/lib/format";

/** Home screen: one scrolling column of stacked cards, no desktop grid. */
export async function AssessmentDashboard() {
  const session = await requireStaffSession();
  const actor = toStaffActor(session);
  const stats = await workspaceStats(actor);
  const recent = await listResults(actor);
  const db = await getDbReady();
  const profile = await getOrganizationLetterhead(db, { actor });

  return (
    <div className="space-y-4">
      <section className="gradient-brand shadow-float rounded-3xl p-5 text-white">
        <Badge tone="clay">DEMONSTRASI — DATA FIKTIF</Badge>
        <h2 className="mt-3 text-[22px] leading-tight font-semibold">
          Memahami anak, mendampingi keluarga.
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-white/85">
          Anak asuh dan orang tua / wali menjawab secara terpisah. Jawaban
          tersimpan hanya di perangkat ini.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <Link
            href="/children/new"
            prefetch={false}
            className="flex min-h-[44px] items-center justify-center rounded-2xl bg-white px-4 text-sm font-semibold text-sage-700 active:bg-cream-100"
          >
            Mulai asesmen
          </Link>
          <Link
            href="/assessments"
            prefetch={false}
            className="flex min-h-[44px] items-center justify-center rounded-2xl border border-white/40 px-4 text-sm font-semibold text-white active:bg-white/10"
          >
            Lihat hasil asesmen
          </Link>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <SummaryCard label="Anak asuh" value={stats.children} />
        <SummaryCard label="Orang tua / wali" value={stats.guardians} />
        <SummaryCard label="Terkirim" value={stats.submitted} hint="Jawaban final" />
        <SummaryCard label="Draft" value={stats.drafts} hint="Masih berjalan" />
      </div>

      <OrganizationSummary profile={profile} canEdit={can(actor.role, "admin.general_settings")} />

      <div className="space-y-2.5">
        <FeatureCard
          href="/children"
          title="Asesmen anak asuh"
          description="Usia 4–8 aktivitas & gambar · 9–12 cerita · 13–18 refleksi."
          icon={<ChildIcon size={20} />}
        />
        <FeatureCard
          href="/guardians"
          title="Asesmen orang tua / wali"
          description="13 pertanyaan tentang pendampingan dan kebutuhan keluarga."
          icon={<GuardianIcon size={20} />}
        />
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink-900">Asesmen terbaru</h3>
          <Link href="/assessments" prefetch={false} className="text-[12px] font-medium text-sage-700">
            Semua
          </Link>
        </div>
        {!recent.rows.length ? (
          <EmptyState
            title="Belum ada asesmen"
            description="Daftarkan anak, hubungkan wali, lalu mulai kegiatan."
          >
            <Link href="/children/new" prefetch={false} className={primaryButtonClassName}>
              Daftarkan anak asuh
            </Link>
          </EmptyState>
        ) : (
          <ul className="space-y-1.5">
            {recent.rows.slice(0, 6).map((a) => (
              <li key={a.id}>
                <Link
                  href={a.status === "draft" ? `/cycles/${a.cycleId}` : `/assessments/${a.id}`}
                  prefetch={false}
                  className="flex min-h-[56px] items-center gap-2.5 rounded-2xl bg-cream-50 px-3 py-2 active:bg-cream-100"
                >
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-white text-sage-600">
                    <ResultIcon size={18} />
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13px] font-medium text-ink-900">
                      {a.target === "child" ? a.childName : `${a.guardianName} · ${a.childName}`}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-ink-500">
                      {formatDateTime(a.createdAt)}
                    </span>
                  </span>
                  <StatusBadge
                    tone={a.status === "submitted" ? "sage" : a.status === "withdrawn" ? "clay" : "neutral"}
                  >
                    {a.status === "submitted" ? "Terkirim" : a.status === "withdrawn" ? "Ditarik" : "Draft"}
                  </StatusBadge>
                  <ChevronRightIcon size={16} className="flex-none text-ink-300" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Link href="/instruments" prefetch={false} className={`${secondaryButtonClassName} w-full`}>
        Instrumen & persetujuan
      </Link>

      <p className="px-1 pb-2 text-[11px] leading-relaxed text-ink-500">
        Bukan ujian kelulusan, diagnosis, atau tes penerimaan. Semua pertanyaan
        boleh dilewati. Analisis profesional, AI nyata, dan laporan wali yang
        disetujui merupakan alur terpisah yang belum tersedia.
      </p>
    </div>
  );
}
