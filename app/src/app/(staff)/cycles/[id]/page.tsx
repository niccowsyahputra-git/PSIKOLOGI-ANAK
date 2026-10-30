import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionButton } from "@/components/action-button";
import { AnswerList } from "@/components/answer-list";
import { DynamicAssignment } from "@/components/assessment-builder/assignment";
import { DynamicResponseLinks } from "@/components/assessment-builder/response-links";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { formatDateTime } from "@/lib/format";
import { ASSESSMENT_STATUS, CONSENT_STATUS, CONSENT_TYPES, CYCLE_STATUS, MODULE_LABELS } from "@/lib/labels";
import { orNotFound } from "@/lib/page-data";
import { can } from "@/lib/permissions";
import { cycleDetail } from "@/server/services/assessment.service";
import { AuthorityForm, ConsentForm, HandoffButton } from "./cycle-forms";

export const metadata: Metadata = { title: "Siklus asesmen" };

type Detail = Awaited<ReturnType<typeof cycleDetail>>;
type Row = Detail["full"][number];

function ParticipantCard({ title, subtitle, row, gate, cycleId, createData, sessions, closed }: { title: string; subtitle: string; row: Row | undefined; gate: string | null; cycleId: string; createData: Record<string, string>; sessions: Detail["sessions"]; closed: boolean }) {
  const live = row ? sessions.find((entry) => entry.assessmentId === row.id && entry.live) : undefined;
  const answered = row?.answers.length ?? 0;
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><h3 className="truncate text-sm font-semibold text-ink-900">{title}</h3><p className="text-[11px] text-ink-500">{subtitle}</p></div>
        <Badge tone={row?.status === "submitted" ? "sage" : row ? "sky" : "neutral"}>{row ? ASSESSMENT_STATUS[row.status] : "Belum dibuat"}</Badge>
      </div>
      {gate && !row ? <p className="rounded-2xl bg-clay-100 px-3 py-2 text-[12px] text-clay-600">{gate}</p> : null}
      {!row ? (
        <ActionButton path={`/api/cycles/${cycleId}/assessments`} data={createData} disabled={Boolean(gate) || closed}>Siapkan kuesioner</ActionButton>
      ) : row.status === "draft" ? (
        <div className="space-y-3">
          <p className="text-[12px] text-ink-500">{answered} item tersimpan · revisi {row.revision}</p>
          {live ? <div className="flex flex-wrap items-center gap-2 text-[12px]"><Badge tone="sky">{live.exchangedAt ? "Sesi sedang dipakai" : "Tautan belum dibuka"}</Badge><span className="text-ink-500">berlaku sampai {formatDateTime(live.expiresAt)}</span><ActionButton variant="secondary" path={`/api/intake-sessions/${live.id}/revoke`} data={{ reason: "Dicabut staf dari halaman siklus" }} confirm="Ya, cabut sesi">Cabut sesi</ActionButton></div> : null}
          {gate ? <p className="rounded-2xl bg-clay-100 px-3 py-2 text-[12px] text-clay-600">{gate}</p> : <HandoffButton cycleId={cycleId} assessmentId={row.id} participant={title} />}
        </div>
      ) : row.status === "submitted" ? (
        <Link href={`/assessments/${row.id}`} className="text-[13px] font-medium text-sage-700 underline">Lihat jawaban · dikirim {formatDateTime(row.submittedAt)}</Link>
      ) : <p className="text-[12px] text-ink-500">Asesmen ditarik; jawaban tidak ditampilkan.</p>}
    </Card>
  );
}

async function CycleWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession(); const actor = toStaffActor(session); const { id } = await params;
  const detail = await orNotFound(cycleDetail(actor, id));
  const { cycle, child, links, full, gates, consents, reviews, sessions } = detail;
  const closed = cycle.status === "closed";
  const current = (target: "child" | "guardian", guardianId: string | null = null) => full.find((row) => row.target === target && row.guardianId === guardianId && row.status !== "withdrawn") ?? full.find((row) => row.target === target && row.guardianId === guardianId);
  const childRow = current("child");
  const subjects = [{ id: child.id, type: "child" as const, name: child.name }, ...links.map(({ guardian }) => ({ id: guardian.id, type: "guardian" as const, name: guardian.name }))];
  const nameOf = (subjectId: string) => subjects.find((entry) => entry.id === subjectId)?.name ?? "—";

  return (
    <>
      <PageHeader
        title={`Siklus asesmen · ${child.name}`}
        description={`${MODULE_LABELS[cycle.module]} · usia saat mulai ${cycle.ageAtStart} th${cycle.ageIsEstimated ? " (perkiraan)" : ""} · instrumen ${cycle.instrumentVersion} · dimulai ${formatDateTime(cycle.startedAt)}`}
        actions={<>{cycle.fictional ? <Badge tone="clay">Data fiktif</Badge> : null}<Badge tone={closed ? "neutral" : "sky"}>{CYCLE_STATUS[cycle.status]}</Badge><Link href={`/children/${child.id}`} className="text-sm text-sage-700 underline">Profil anak</Link></>}
      />
      {cycle.fictional ? <p className="mb-4 rounded-2xl bg-clay-100/60 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-700">Siklus fiktif untuk demonstrasi: persetujuan dan pengesahan instrumen tidak diwajibkan. Jangan memasukkan cerita anak atau wali yang nyata.</p> : null}

      <h2 className="mb-2.5 text-sm font-semibold">Peserta</h2>
      <div className="space-y-3">
        <ParticipantCard title={child.name} subtitle={`Anak · ${MODULE_LABELS[cycle.module]}`} row={childRow} gate={gates.child} cycleId={cycle.id} createData={{ target: "child" }} sessions={sessions} closed={closed} />
        {links.length ? links.map(({ guardian, link }) => (
          <ParticipantCard key={guardian.id} title={guardian.name} subtitle={`${link.relationship} · ${MODULE_LABELS.W}`} row={current("guardian", guardian.id)} gate={gates.guardians[guardian.id] ?? null} cycleId={cycle.id} createData={{ target: "guardian", guardianId: guardian.id }} sessions={sessions} closed={closed} />
        )) : (
          <Card><h3 className="text-sm font-semibold">Orang tua / wali</h3><p className="mt-1.5 text-[12px] text-ink-500">Belum ada wali terhubung. <Link className="text-sage-700 underline" href={`/children/${child.id}`}>Tambahkan dari profil anak</Link>.</p></Card>
        )}
      </div>

      <section className="mt-6 space-y-3" aria-label="Formulir dinamis">
        {!closed && can(actor.role, "profile.intake.write") && <DynamicAssignment cycleId={cycle.id} subjects={subjects} />}
        <DynamicResponseLinks actor={actor} filter={{ cycleId: cycle.id }} />
      </section>

      <h2 className="mt-6 mb-2 text-sm font-semibold">Perbandingan jawaban anak &amp; wali</h2>
      <p className="mb-3 text-[12px] leading-relaxed text-ink-500">Hanya untuk staf. Jawaban anak tidak pernah ditampilkan kepada wali. Tidak ada skor atau diagnosis.</p>
      <div className="space-y-5">
        <div><h3 className="mb-2 text-[13px] font-medium">{child.name} · Modul {cycle.module}</h3>{childRow?.status === "submitted" ? <AnswerList module={cycle.module} answers={childRow.answers} compact /> : <MissingSubmission label="Anak belum mengirim jawaban." />}</div>
        <div className="space-y-5">{links.length ? links.map(({ guardian }) => { const row = current("guardian", guardian.id); return <div key={guardian.id}><h3 className="mb-2 text-[13px] font-medium">{guardian.name} · Modul W</h3>{row?.status === "submitted" ? <AnswerList module="W" answers={row.answers} compact /> : <MissingSubmission label="Wali belum mengirim jawaban." />}</div>; }) : <MissingSubmission label="Tidak ada wali pada siklus ini." />}</div>
      </div>

      <div className="mt-6 space-y-3">
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Persetujuan</h2>
          {!consents.length ? <p className="text-[12px] text-ink-500">Belum ada catatan persetujuan.</p> : (
            <ul className="divide-y divide-cream-200 text-[12px]">{consents.map((entry) => <li key={entry.id} className="py-2"><span className="font-medium">{CONSENT_TYPES[entry.type]}</span> · {nameOf(entry.subjectId)} · <Badge tone={entry.status === "granted" ? "sage" : "clay"}>{CONSENT_STATUS[entry.status]}</Badge><br /><span className="text-[11px] text-ink-500">{formatDateTime(entry.capturedAt)} · {entry.authorityBasis}</span></li>)}</ul>
          )}
          {!closed ? <ConsentForm cycleId={cycle.id} subjects={subjects} /> : null}
        </Card>
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Review kewenangan</h2>
          {!reviews.length ? <p className="text-[12px] text-ink-500">Belum ada review kewenangan.</p> : (
            <ul className="divide-y divide-cream-200 text-[12px]">{reviews.map((entry) => <li key={entry.id} className="py-2"><Badge tone={entry.decision === "approved" ? "sage" : "clay"}>{entry.decision === "approved" ? "Disetujui" : entry.decision === "pending" ? "Ditunda" : "Ditolak"}</Badge> <span className="text-[11px] text-ink-500">{formatDateTime(entry.reviewedAt)}</span><p className="mt-1">{entry.lawfulBasisNote}</p></li>)}</ul>
          )}
          {!closed && can(actor.role, "authority.review") ? <AuthorityForm cycleId={cycle.id} /> : <p className="text-[11px] text-ink-500">Hanya ketua yang dapat mencatat review kewenangan.</p>}
        </Card>
      </div>
      {!closed ? <div className="mt-6 pb-2"><ActionButton variant="secondary" path={`/api/cycles/${cycle.id}/close`} data={{ reason: "Siklus ditutup oleh staf" }} confirm="Ya, tutup siklus dan cabut semua sesi">Tutup siklus</ActionButton></div> : null}
    </>
  );
}

function MissingSubmission({ label }: { label: string }) {
  return <div className="rounded-2xl border border-dashed border-cream-300 bg-cream-50 px-4 py-5 text-center text-[12px] text-ink-500">{label}</div>;
}

export default function CyclePage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<Skeleton rows={10} />}><CycleWorkspace params={params} /></Suspense>;
}
