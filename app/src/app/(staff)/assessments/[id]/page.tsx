import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { GenerateAnalysisButton } from "@/components/ai-actions";
import { AnswerList } from "@/components/answer-list";
import { DynamicResponseLinks } from "@/components/assessment-builder/response-links";
import { PrintFooter, PrintLetterhead } from "@/components/letterhead";
import { PrintButton } from "@/components/print-button";
import { Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { ASSESSMENT_STATUS, MODULE_LABELS } from "@/lib/labels";
import { orNotFound } from "@/lib/page-data";
import { can } from "@/lib/permissions";
import { aiAvailability, listAnalysesForAssessment } from "@/server/services/ai.service";
import { resultDetail } from "@/server/services/assessment.service";
import { getOrganizationLetterhead } from "@/server/services/settings.service";
import { LateUploadForm, ObservationForm, ReasonAction } from "./result-actions";

export const metadata: Metadata = { title: "Jawaban asesmen" };

async function Result({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession(); const actor = toStaffActor(session); const { id } = await params;
  let detail: Awaited<ReturnType<typeof resultDetail>>;
  try { detail = await orNotFound(resultDetail(actor, id)); } catch (error) {
    if (error instanceof ForbiddenError) return <EmptyState title="Asesmen telah ditarik" description="Akses jawaban dibatasi setelah penarikan." />;
    throw error;
  }
  const { assessment, cycle, child, guardian, media, events, observations, answers } = detail;
  const db = await getDbReady(); const profile = await getOrganizationLetterhead(db, { actor });
  const aiReadable = can(actor.role, "ai.generate.first") && assessment.status === "submitted";
  const [availability, analyses] = aiReadable ? await Promise.all([aiAvailability(actor), listAnalysesForAssessment(actor, assessment.id)]) : [null, []];
  const paperPending = answers.some((answer) => answer.kind === "media" && answer.state === "answered" && answer.activityMode === "paper_pending");
  const participant = assessment.target === "child" ? child.name : guardian?.name ?? "Wali";
  const skipped = answers.filter((answer) => answer.state === "skipped").length;

  return (
    <article className="assessment-print print-plain">
      <PrintLetterhead
        profile={profile}
        documentTitle="Rekaman Jawaban Asesmen Psikososial"
        subtitle={`${participant} · ${MODULE_LABELS[assessment.module]}${cycle.fictional ? " · DATA FIKTIF" : ""}`}
        printedAt={formatDateTime(new Date(), profile.timezone)}
      />
      <PageHeader
        title={`Jawaban ${participant}`}
        description={`${assessment.target === "child" ? "Anak asuh" : `Orang tua / wali dari ${child.name}`} · ${MODULE_LABELS[assessment.module]} · ${assessment.status === "submitted" ? `dikirim ${formatDateTime(assessment.submittedAt, profile.timezone)}` : ASSESSMENT_STATUS[assessment.status]}`}
        actions={<>{cycle.fictional ? <Badge tone="clay">Data fiktif</Badge> : null}<Badge tone={assessment.status === "submitted" ? "sage" : "neutral"}>{ASSESSMENT_STATUS[assessment.status]}</Badge><Link href={`/cycles/${cycle.id}`} className="no-print text-sm text-sage-700 underline">Siklus & perbandingan</Link><PrintButton label="Cetak jawaban" /></>}
      />
      <p className="mb-5 rounded-2xl bg-sky-soft-100 px-4 py-3 text-sm text-ink-700">Rekaman jawaban apa adanya — bukan skor, diagnosis, atau keputusan. Analisis profesional oleh psikolog adalah alur terpisah. {skipped ? `${skipped} item dilewati peserta.` : ""}</p>
      {assessment.parentAssessmentId ? <p className="mb-5 text-sm text-ink-500">Versi koreksi dari <Link className="text-sage-700 underline" href={`/assessments/${assessment.parentAssessmentId}`}>jawaban sebelumnya</Link>.</p> : null}
      <div className="result-columns grid gap-5">
        <AnswerList module={assessment.module} answers={answers} />
        <div className="space-y-5">
          {assessment.module === "A" ? (
            <Card className="space-y-3">
              <h2 className="text-lg font-semibold">Gambar A02</h2>
              {!media.length ? <p className="text-sm text-ink-500">Belum ada gambar tersimpan.</p> : media.map((file) => (
                <figure key={file.id} className="space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private no-store endpoint */}
                  <img src={`/api/attachments/${file.id}/content`} alt="Gambar aktivitas anak" className="rounded-lg border border-cream-200" />
                  <figcaption className="text-xs text-ink-500">{events.find((event) => event.attachmentId === file.id)?.eventType === "late_uploaded" ? "Unggahan susulan" : "Diunggah saat sesi"} · {formatDateTime(file.createdAt, profile.timezone)}</figcaption>
                </figure>
              ))}
              {paperPending && assessment.status === "submitted" && can(actor.role, "profile.intake.write") ? <div className="no-print"><LateUploadForm assessmentId={assessment.id} /></div> : null}
            </Card>
          ) : null}
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">Catatan pendamping</h2>
            {!observations.length ? <p className="text-sm text-ink-500">Belum ada catatan.</p> : (
              <ul className="space-y-2 text-sm">{observations.map((entry) => <li key={entry.id} className="rounded-xl bg-cream-50 p-3"><p className="whitespace-pre-wrap">{entry.observation}</p><p className="mt-1 text-xs text-ink-500">{formatDateTime(entry.createdAt, profile.timezone)}</p></li>)}</ul>
            )}
            {can(actor.role, "monitoring.note.write") ? <div className="no-print"><ObservationForm assessmentId={assessment.id} /></div> : null}
          </Card>
          {aiReadable && availability ? (
            <Card className="no-print space-y-3">
              <h2 className="text-lg font-semibold">Analisis &amp; review AI</h2>
              <p className="text-sm text-ink-500">
                Menghasilkan ringkasan pendukung dari jawaban ini untuk dibaca manusia — bukan skor, diagnosis, atau keputusan penempatan. Hasil selalu perlu direview staf sebelum dipakai.
                {availability.simulated ? " Mode sekarang simulasi lokal, jadi keluarannya bukan analisis AI nyata." : ""}
              </p>
              {analyses.length ? (
                <ul className="space-y-2 text-sm">{analyses.map((analysis, index) => (
                  <li key={analysis.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-cream-50 p-3">
                    <Link href={`/analyses/${analysis.id}`} className="font-medium text-sage-700 underline">Analisis {analyses.length - index}</Link>
                    {analysis.simulated ? <Badge tone="clay">Simulasi</Badge> : null}
                    <span className="text-xs text-ink-500">{formatDateTime(analysis.createdAt, profile.timezone)}</span>
                  </li>
                ))}</ul>
              ) : <p className="text-sm text-ink-500">Belum ada analisis untuk jawaban ini.</p>}
              <GenerateAnalysisButton
                childId={assessment.childId}
                guardianId={assessment.guardianId}
                cycleId={cycle.id}
                scope={assessment.target}
                sourceAssessmentIds={[assessment.id]}
                needsReason={analyses.length > 0}
                ready={availability.ready && cycle.status !== "closed"}
                blockedReason={cycle.status === "closed" ? "Siklus sudah ditutup, analisis baru tidak dibuat lagi." : availability.reason}
              />
              <p className="text-xs text-ink-500">Kuota hari ini: {availability.usedToday}/{availability.dailyLimit} permintaan. Keputusan review dicatat di halaman analisis.</p>
            </Card>
          ) : null}
          {assessment.status === "submitted" ? (
            <Card className="no-print space-y-3">
              <h2 className="text-lg font-semibold">Koreksi & penarikan</h2>
              <p className="text-sm text-ink-500">Jawaban terkirim tidak dapat diubah. Koreksi membuat versi baru yang diisi ulang melalui sesi peserta.</p>
              {cycle.status !== "closed" && can(actor.role, "profile.intake.write") ? <ReasonAction label="Buat versi koreksi" confirmLabel="Buat koreksi" path={`/api/cycles/${cycle.id}/assessments`} build={{ target: assessment.target, ...(assessment.guardianId ? { guardianId: assessment.guardianId } : {}), parentAssessmentId: assessment.id }} redirectTo="cycle" /> : null}
              {can(actor.role, "assessment.withdraw") ? <ReasonAction label="Tarik asesmen" confirmLabel="Ya, tarik" path={`/api/assessments/${assessment.id}/withdraw`} build={{}} /> : null}
            </Card>
          ) : null}
        </div>
      </div>
      <div className="no-print mt-5"><DynamicResponseLinks actor={actor} filter={{ cycleId: cycle.id }} /></div>
      <PrintFooter profile={profile} />
    </article>
  );
}

export default function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<Skeleton rows={10} />}><Result params={params} /></Suspense>;
}
