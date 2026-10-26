import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { formatDateTime } from "@/lib/format";
import { ASSESSMENT_STATUS, CONTACT_SAFETY } from "@/lib/labels";
import { orNotFound } from "@/lib/page-data";
import { profileDetail } from "@/server/services/assessment.service";

export const metadata: Metadata = { title: "Profil wali" };

async function GuardianDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession(); const { id } = await params;
  const { profile: guardian, links, assessments } = await orNotFound(profileDetail(toStaffActor(session), "guardians", id));
  const verified = guardian.profileState === "verified";
  return (
    <>
      <PageHeader
        title={guardian.name}
        description={`${guardian.code} · Orang tua / wali. Asesmen wali selalu dimulai dari siklus anak yang didampingi.`}
        actions={<>{guardian.fictional ? <Badge tone="clay">Data fiktif</Badge> : null}<Badge tone={verified ? "sage" : "neutral"}>{verified ? "Terverifikasi" : guardian.profileState === "archived" ? "Diarsipkan" : "Draft"}</Badge>{guardian.profileState === "draft" ? <ActionButton path={`/api/guardians/${guardian.id}/verify`} data={{ revision: guardian.revision }}>Verifikasi wali</ActionButton> : null}</>}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold">Anak yang didampingi</h2>
          {!links.length ? <p className="mt-3 text-sm text-ink-500">Belum terhubung dengan anak.</p> : (
            <ul className="mt-3 space-y-3 text-sm">
              {links.map(({ link, child }) => (
                <li key={link.id} className="rounded-xl border border-cream-200 p-3">
                  <Link href={`/children/${child.id}`} className="font-medium text-sage-700">{child.name}</Link>
                  <p className="mt-1 text-ink-500">{link.relationship}{link.isPrimary ? " · pendamping utama" : ""} · {CONTACT_SAFETY[link.contactSafety]}</p>
                </li>
              ))}
            </ul>
          )}
          <dl className="mt-5 space-y-2 text-sm">
            <div><dt className="text-ink-500">Preferensi komunikasi</dt><dd>{"communicationPreference" in guardian ? guardian.communicationPreference : "—"}</dd></div>
          </dl>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold">Riwayat asesmen wali</h2>
          {!assessments.length ? <p className="mt-3 text-sm text-ink-500">Belum ada asesmen. Buat dari halaman siklus anak.</p> : (
            <ul className="mt-3 divide-y divide-cream-200 text-sm">
              {assessments.map((entry) => {
                const child = links.find((link) => link.child.id === entry.childId)?.child;
                return <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <Link className="font-medium text-sage-700" href={entry.status === "draft" ? `/cycles/${entry.cycleId}` : `/assessments/${entry.id}`}>Modul W{child ? ` · ${child.name}` : ""}</Link>
                  <span className="text-ink-500">{ASSESSMENT_STATUS[entry.status]} · {formatDateTime(entry.submittedAt ?? entry.createdAt)}</span>
                </li>;
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

export default function GuardianPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<Skeleton rows={6} />}><GuardianDetail params={params} /></Suspense>;
}
