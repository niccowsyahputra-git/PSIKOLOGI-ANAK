import Link from "next/link";
import { Suspense } from "react";
import { ActionButton } from "@/components/action-button";
import { ResponseActions } from "@/components/assessment-builder/response-actions";
import { AnswerSummary } from "@/components/assessment-builder/renderer";
import { SAFETY_LABEL } from "@/lib/assessment-builder/definition";
import { Badge, Card, EmptyState, LoadingState, PageHeader } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { orNotFound } from "@/lib/page-data";
import { can } from "@/lib/permissions";
import { cycle } from "@/server/services/assessment.service";
import { responseDetail } from "@/server/services/response.service";

export const metadata = { title: "Jawaban formulir dinamis" };
async function Result({ params }: { params: Promise<{ id: string }> }) {
  const actor = toStaffActor(await requireStaffSession()); const { id } = await params;
  let detail: Awaited<ReturnType<typeof responseDetail>>;
  try { detail = await orNotFound(responseDetail(actor, id)); }
  catch (e) { if (e instanceof ForbiddenError) return <EmptyState title="Response tidak tersedia" description={e.message} />; throw e; }
  const { response, definition, answers, sessions } = detail;
  const c = await cycle(await getDbReady(), actor.organizationId, response.cycleId);
  const images = answers.filter((a) => a.state === "answered" && typeof a.value === "string" && definition.questions.some((q) => q.id === a.questionId && q.type === "file"));
  return <article className="space-y-4">
    <PageHeader title={definition.name} description={`Formulir dinamis · ${response.target === "child" ? "Anak" : "Wali"} · revisi ${response.revision}`} actions={<><Badge>{response.status}</Badge><Link className="underline" href={`/cycles/${response.cycleId}`}>Siklus & responden</Link></>} />
    <p className="text-sm">{SAFETY_LABEL}</p><p className="text-sm">Jawaban ini tidak dimasukkan ke analisis AI atau percakapan kasus.</p>
    <Card className="space-y-2 text-xs"><p className="break-all">Versi terkunci: {response.templateVersionId}</p><p className="break-all">SHA-256: {response.contentHash}</p>{response.submittedAt && <p>Dikirim: {formatDateTime(response.submittedAt)}</p>}{response.parentResponseId && <p>Koreksi dari <Link className="underline" href={`/assessment-responses/${response.parentResponseId}`}>response sebelumnya</Link> · {response.correctionReason}</p>}</Card>
    <Card><AnswerSummary definition={definition} answers={answers} /></Card>
    {images.map((a) => <Card key={a.questionId}><a className="underline" href={`/api/response-attachments/${a.value}/content`} target="_blank" rel="noopener noreferrer">Lihat gambar privat · {definition.questions.find((q) => q.id === a.questionId)?.label}</a></Card>)}
    {sessions.filter((s) => s.live).map((s) => <Card key={s.id} className="space-y-2"><p>{s.exchangedAt ? "Sesi sedang dipakai" : "Tautan belum dibuka"} · berlaku sampai {formatDateTime(s.expiresAt)}</p>{(s.createdBy === actor.membershipId || can(actor.role, "intake_session.revoke_any")) && <ActionButton variant="secondary" path={`/api/response-sessions/${s.id}/revoke`} data={{ reason: "Dicabut staf dari halaman response" }} confirm="Ya, cabut sesi">Cabut sesi</ActionButton>}</Card>)}
    <ResponseActions id={id} cycleId={response.cycleId} draft={response.status === "draft" && can(actor.role, "intake_session.create")} canCorrect={response.status === "submitted" && c.status !== "closed" && can(actor.role, "profile.intake.write")} canWithdraw={can(actor.role, "assessment.withdraw")} />
  </article>;
}
export default function Page(props: { params: Promise<{ id: string }> }) { return <Suspense fallback={<LoadingState />}><Result {...props} /></Suspense>; }
