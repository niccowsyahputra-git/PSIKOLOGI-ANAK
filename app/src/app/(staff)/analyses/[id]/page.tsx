import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AnalysisReviewForm } from "@/components/ai-actions";
import { AnalysisResult } from "@/components/analysis-result";
import { PrintFooter, PrintLetterhead } from "@/components/letterhead";
import { PrintButton } from "@/components/print-button";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { AI_DISPOSITION_LABELS, AI_ORIGIN_LABELS, AI_SCOPE_LABELS } from "@/lib/labels";
import { orNotFound } from "@/lib/page-data";
import { can } from "@/lib/permissions";
import { analysisDetail } from "@/server/services/ai.service";
import { getOrganizationLetterhead } from "@/server/services/settings.service";

export const metadata: Metadata = { title: "Analisis AI" };

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  const actor = toStaffActor(session);
  const { id } = await params;
  const { analysis, reviews, disposition } = await orNotFound(analysisDetail(actor, id));
  const db = await getDbReady();
  const profile = await getOrganizationLetterhead(db, { actor });

  return (
    <article className="assessment-print print-plain">
      <PrintLetterhead
        profile={profile}
        documentTitle="Ringkasan Pendukung Berbantuan AI"
        subtitle={`${AI_SCOPE_LABELS[analysis.scope] ?? analysis.scope}${analysis.simulated ? " · KELUARAN SIMULASI, BUKAN ANALISIS NYATA" : ""}`}
        printedAt={formatDateTime(new Date(), profile.timezone)}
      />
      <PageHeader
        title="Ringkasan pendukung berbantuan AI"
        description={`${AI_SCOPE_LABELS[analysis.scope] ?? analysis.scope} · dibuat ${formatDateTime(analysis.createdAt, profile.timezone)}`}
        actions={
          <>
            {analysis.simulated ? <Badge tone="clay">Simulasi</Badge> : <Badge tone="sky">{AI_ORIGIN_LABELS[analysis.resultOrigin]}</Badge>}
            {disposition ? <Badge tone={disposition === "support_approved" ? "sage" : "neutral"}>{AI_DISPOSITION_LABELS[disposition]}</Badge> : <Badge tone="neutral">Belum direview</Badge>}
            <PrintButton label="Cetak ringkasan" />
          </>
        }
      />

      {analysis.simulated ? (
        <p className="mb-5 rounded-2xl bg-clay-100/60 px-4 py-3 text-sm text-ink-700 print-keep">
          Keluaran ini dihasilkan simulasi aturan tetap di laptop untuk menguji alur kerja. Ini bukan analisis AI dan bukan penilaian psikologis, sehingga tidak dapat disetujui sebagai bahan dukungan nyata.
        </p>
      ) : (
        <p className="mb-5 rounded-2xl bg-sky-soft-100 px-4 py-3 text-sm text-ink-700 print-keep">
          Ringkasan pendukung yang dapat salah — bukan skor, diagnosis, atau keputusan penempatan. Tinjauan manusia tetap wajib sebelum dipakai mendampingi anak.
        </p>
      )}

      <div className="result-columns grid gap-5">
        <AnalysisResult result={analysis.result} simulated={analysis.simulated} />
        <div className="space-y-5">
          <Card className="print-keep space-y-2 text-sm">
            <h2 className="text-base font-semibold">Asal keluaran</h2>
            <dl className="space-y-1 text-ink-700">
              <div className="flex justify-between gap-3"><dt className="text-ink-500">Sumber</dt><dd className="text-right">{AI_ORIGIN_LABELS[analysis.resultOrigin]}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-500">Provider</dt><dd className="text-right">{analysis.provider}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-500">Model</dt><dd className="text-right">{analysis.model ?? "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-500">Versi prompt</dt><dd className="text-right">{analysis.promptVersion}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-ink-500">Dijalankan oleh</dt><dd className="text-right">{analysis.generatedByName ?? "—"}</dd></div>
            </dl>
            {analysis.generationReason ? <p className="whitespace-pre-wrap text-xs text-ink-500">Alasan dicatat: {analysis.generationReason}</p> : null}
            <p className="text-xs text-ink-500">Jawaban asli: {analysis.sourceAssessmentIds.map((sourceId, index) => (
              <span key={sourceId}>{index > 0 ? ", " : ""}<Link href={`/assessments/${sourceId}`} className="text-sage-700 underline">asesmen {index + 1}</Link></span>
            ))}</p>
            <Link href={`/cycles/${analysis.cycleId}`} className="no-print inline-block text-sm text-sage-700 underline">Siklus asesmen</Link>
          </Card>

          <Card className="print-keep space-y-3">
            <h2 className="text-base font-semibold">Riwayat review</h2>
            {reviews.length === 0 ? <p className="text-sm text-ink-500">Belum ada keputusan review.</p> : (
              <ul className="space-y-2 text-sm">
                {reviews.map((review) => (
                  <li key={review.id} className="print-keep rounded-xl bg-cream-50 p-3">
                    <p className="flex flex-wrap items-center gap-2 font-medium">{AI_DISPOSITION_LABELS[review.disposition]}{review.simulated ? <Badge tone="clay">atas hasil simulasi</Badge> : null}</p>
                    <p className="mt-1 whitespace-pre-wrap text-ink-700">{review.comment}</p>
                    <p className="mt-1 text-xs text-ink-500">{review.reviewerName ?? "Staf"} · {formatDateTime(review.createdAt, profile.timezone)}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-ink-500">Keputusan bersifat tambahan: hasil tidak pernah diubah, dan setiap keputusan baru tercatat di atas keputusan lama.</p>
          </Card>

          <Card className="no-print space-y-3">
            <h2 className="text-base font-semibold">Catat keputusan review</h2>
            <AnalysisReviewForm
              analysisId={analysis.id}
              simulated={analysis.simulated}
              canDecide={can(actor.role, "ai.review.decide")}
              canMarkRevision={can(actor.role, "ai.mark_needs_revision")}
            />
          </Card>
        </div>
      </div>
      <PrintFooter profile={profile} />
    </article>
  );
}

export default function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<Skeleton rows={10} />}><Detail params={params} /></Suspense>;
}
