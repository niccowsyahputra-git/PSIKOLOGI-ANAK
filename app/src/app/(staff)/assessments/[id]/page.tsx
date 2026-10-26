import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AnswerList } from "@/components/answer-list";
import { Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { ForbiddenError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { ASSESSMENT_STATUS, MODULE_LABELS } from "@/lib/labels";
import { orNotFound } from "@/lib/page-data";
import { can } from "@/lib/permissions";
import { resultDetail } from "@/server/services/assessment.service";
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
  const paperPending = answers.some((answer) => answer.kind === "media" && answer.state === "answered" && answer.activityMode === "paper_pending");
  const participant = assessment.target === "child" ? child.name : guardian?.name ?? "Wali";
  const skipped = answers.filter((answer) => answer.state === "skipped").length;

  return (
    <>
      <PageHeader
        title={`Jawaban ${participant}`}
        description={`${assessment.target === "child" ? "Anak asuh" : `Orang tua / wali dari ${child.name}`} · ${MODULE_LABELS[assessment.module]} · ${assessment.status === "submitted" ? `dikirim ${formatDateTime(assessment.submittedAt)}` : ASSESSMENT_STATUS[assessment.status]}`}
        actions={<>{cycle.fictional ? <Badge tone="clay">Data fiktif</Badge> : null}<Badge tone={assessment.status === "submitted" ? "sage" : "neutral"}>{ASSESSMENT_STATUS[assessment.status]}</Badge><Link href={`/cycles/${cycle.id}`} className="text-sm text-sage-700 underline">Siklus & perbandingan</Link></>}
      />
      <p className="mb-5 rounded-2xl bg-sky-soft-100 px-4 py-3 text-sm text-ink-700">Rekaman jawaban apa adanya — bukan skor, diagnosis, atau keputusan. Analisis profesional oleh psikolog adalah alur terpisah. {skipped ? `${skipped} item dilewati peserta.` : ""}</p>
      {assessment.parentAssessmentId ? <p className="mb-5 text-sm text-ink-500">Versi koreksi dari <Link className="text-sage-700 underline" href={`/assessments/${assessment.parentAssessmentId}`}>jawaban sebelumnya</Link>.</p> : null}
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <AnswerList module={assessment.module} answers={answers} />
        <div className="space-y-5">
          {assessment.module === "A" ? (
            <Card className="space-y-3">
              <h2 className="text-lg font-semibold">Gambar A02</h2>
              {!media.length ? <p className="text-sm text-ink-500">Belum ada gambar tersimpan.</p> : media.map((file) => (
                <figure key={file.id} className="space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private no-store endpoint */}
                  <img src={`/api/attachments/${file.id}/content`} alt="Gambar aktivitas anak" className="rounded-lg border border-cream-200" />
                  <figcaption className="text-xs text-ink-500">{events.find((event) => event.attachmentId === file.id)?.eventType === "late_uploaded" ? "Unggahan susulan" : "Diunggah saat sesi"} · {formatDateTime(file.createdAt)}</figcaption>
                </figure>
              ))}
              {paperPending && assessment.status === "submitted" && can(actor.role, "profile.intake.write") ? <LateUploadForm assessmentId={assessment.id} /> : null}
            </Card>
          ) : null}
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">Catatan pendamping</h2>
            {!observations.length ? <p className="text-sm text-ink-500">Belum ada catatan.</p> : (
              <ul className="space-y-2 text-sm">{observations.map((entry) => <li key={entry.id} className="rounded-xl bg-cream-50 p-3"><p className="whitespace-pre-wrap">{entry.observation}</p><p className="mt-1 text-xs text-ink-500">{formatDateTime(entry.createdAt)}</p></li>)}</ul>
            )}
            {can(actor.role, "monitoring.note.write") ? <ObservationForm assessmentId={assessment.id} /> : null}
          </Card>
          {assessment.status === "submitted" ? (
            <Card className="space-y-3">
              <h2 className="text-lg font-semibold">Koreksi & penarikan</h2>
              <p className="text-sm text-ink-500">Jawaban terkirim tidak dapat diubah. Koreksi membuat versi baru yang diisi ulang melalui sesi peserta.</p>
              {cycle.status !== "closed" && can(actor.role, "profile.intake.write") ? <ReasonAction label="Buat versi koreksi" confirmLabel="Buat koreksi" path={`/api/cycles/${cycle.id}/assessments`} build={{ target: assessment.target, ...(assessment.guardianId ? { guardianId: assessment.guardianId } : {}), parentAssessmentId: assessment.id }} redirectTo="cycle" /> : null}
              {can(actor.role, "assessment.withdraw") ? <ReasonAction label="Tarik asesmen" confirmLabel="Ya, tarik" path={`/api/assessments/${assessment.id}/withdraw`} build={{}} /> : null}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

export default function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<Skeleton rows={10} />}><Result params={params} /></Suspense>;
}
