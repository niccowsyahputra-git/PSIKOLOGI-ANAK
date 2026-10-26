import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, Card, EmptyState, PageHeader, Skeleton, secondaryButtonClassName } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { formatDateTime } from "@/lib/format";
import { ASSESSMENT_STATUS } from "@/lib/labels";
import { listResults } from "@/server/services/assessment.service";

export const metadata: Metadata = { title: "Hasil asesmen" };
type Search = Promise<{ target?: string | string[]; page?: string | string[] }>;
const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const FILTERS = [["", "Semua"], ["child", "Anak asuh"], ["guardian", "Orang tua / wali"]] as const;

async function Results({ searchParams }: { searchParams: Search }) {
  const session = await requireStaffSession(); const params = await searchParams;
  const target = single(params.target) === "child" ? "child" : single(params.target) === "guardian" ? "guardian" : undefined;
  const page = Math.max(1, Math.min(10000, Number.parseInt(single(params.page), 10) || 1));
  const { rows, total } = await listResults(toStaffActor(session), target, page);
  const pages = Math.max(1, Math.ceil(total / 25));
  const href = (next: { target?: string; page?: number }) => `/assessments?${new URLSearchParams({ ...(next.target ? { target: next.target } : {}), page: String(next.page ?? 1) })}`;
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2" aria-label="Filter peserta">
        {FILTERS.map(([value, label]) => <Link key={value} href={href({ target: value })} className={`rounded-full border px-3 py-1.5 text-sm ${(target ?? "") === value ? "border-sage-600 bg-sage-100 text-sage-700" : "border-cream-300 bg-white text-ink-700"}`}>{label}</Link>)}
      </nav>
      {!rows.length ? <EmptyState title="Belum ada asesmen" description="Mulai dari profil anak: verifikasi, mulai siklus, lalu siapkan kuesioner anak dan wali."><Link href="/children" className="text-sm font-medium text-sage-700 underline">Ke daftar anak</Link></EmptyState> : (
        <Card className="p-0">
          <ul className="divide-y divide-cream-200">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={row.status === "submitted" ? `/assessments/${row.id}` : `/cycles/${row.cycleId}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-cream-50">
                  <span><span className="block font-medium">{row.target === "child" ? row.childName : row.guardianName}</span><span className="text-xs text-ink-500">{row.target === "child" ? `Anak · Modul ${row.module}` : `Wali dari ${row.childName} · Modul W`}</span></span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-ink-500">{row.fictional ? <Badge tone="clay">Fiktif</Badge> : null}<Badge tone={row.status === "submitted" ? "sage" : "neutral"}>{ASSESSMENT_STATUS[row.status]}</Badge>{formatDateTime(row.submittedAt ?? row.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="flex items-center justify-between text-sm text-ink-500">
        <span>{total} asesmen · halaman {page} dari {pages}</span>
        <span className="flex gap-2">
          {page > 1 ? <Link className={secondaryButtonClassName} href={href({ target, page: page - 1 })}>Sebelumnya</Link> : null}
          {page < pages ? <Link className={secondaryButtonClassName} href={href({ target, page: page + 1 })}>Berikutnya</Link> : null}
        </span>
      </div>
    </div>
  );
}

export default function AssessmentsPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <PageHeader title="Hasil asesmen" description="Jawaban anak dan wali yang tersimpan. Hanya staf yang dapat melihat; tidak ada skor atau diagnosis otomatis." />
      <Suspense fallback={<Skeleton rows={6} />}><Results searchParams={searchParams} /></Suspense>
    </>
  );
}
