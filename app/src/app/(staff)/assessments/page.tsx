import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRightIcon } from "@/components/icons";
import { Badge, Card, EmptyState, LoadingState, PageHeader, secondaryButtonClassName } from "@/components/ui";
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
      <nav className="scroll-row" aria-label="Filter peserta">
        {FILTERS.map(([value, label]) => <Link key={value} href={href({ target: value })} prefetch={false} className={`flex min-h-[36px] flex-none items-center rounded-full border px-3.5 text-[12px] font-medium whitespace-nowrap ${(target ?? "") === value ? "border-sage-500 bg-sage-100 text-sage-700" : "border-cream-200 bg-white text-ink-700"}`}>{label}</Link>)}
      </nav>
      {!rows.length ? <EmptyState title="Belum ada asesmen" description="Mulai dari profil anak: verifikasi, mulai siklus, lalu siapkan kuesioner anak dan wali."><Link href="/children" className="text-[13px] font-medium text-sage-700 underline">Ke daftar anak</Link></EmptyState> : (
        <Card className="p-1.5">
          <ul className="space-y-1">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={row.status === "submitted" ? `/assessments/${row.id}` : `/cycles/${row.cycleId}`} prefetch={false} className="flex min-h-[60px] items-center gap-2 rounded-2xl px-3 py-2 active:bg-cream-100">
                  <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-[13px] font-medium">{row.target === "child" ? row.childName : row.guardianName}</span><span className="mt-0.5 block truncate text-[11px] text-ink-500">{row.target === "child" ? `Anak · Modul ${row.module}` : `Wali dari ${row.childName} · Modul W`} · {formatDateTime(row.submittedAt ?? row.createdAt)}</span></span>
                  <span className="flex flex-none flex-col items-end gap-1"><Badge tone={row.status === "submitted" ? "sage" : "neutral"}>{ASSESSMENT_STATUS[row.status]}</Badge>{row.fictional ? <Badge tone="clay">Fiktif</Badge> : null}</span>
                  <ChevronRightIcon size={16} className="flex-none text-ink-300" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="flex items-center justify-between gap-2 pb-2 text-[11px] text-ink-500">
        <span>{total} asesmen · hal. {page}/{pages}</span>
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
      <Suspense fallback={<LoadingState label="Memuat hasil asesmen…" rows={6} />}><Results searchParams={searchParams} /></Suspense>
    </>
  );
}
