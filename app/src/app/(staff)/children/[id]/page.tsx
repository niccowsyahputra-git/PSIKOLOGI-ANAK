import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { formatDate, formatDateTime } from "@/lib/format";
import { ageAtStart, moduleForAge } from "@/lib/instruments";
import { ASSESSMENT_STATUS, CONTACT_SAFETY, CYCLE_STATUS, MODULE_LABELS, SEX_LABELS, familyContextLabel } from "@/lib/labels";
import { orNotFound } from "@/lib/page-data";
import { profileDetail } from "@/server/services/assessment.service";
import { GuardianLinkForm } from "./guardian-link-form";

export const metadata: Metadata = { title: "Profil anak" };

function predictedModule(child: { birthDate: string | null; estimatedAge: number | null; ageReferenceDate: string | null }) {
  try { const age = ageAtStart(child.birthDate, child.estimatedAge, child.ageReferenceDate, new Date()); return { age, module: moduleForAge(age.age), error: null }; }
  catch (error) { return { age: null, module: null, error: (error as Error).message }; }
}

async function ChildDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession(); const { id } = await params;
  const { profile: child, links, cycles, assessments } = await orNotFound(profileDetail(toStaffActor(session), "children", id));
  if (!("birthDate" in child)) return null;
  const prediction = predictedModule(child);
  const background = JSON.parse(child.backgroundJson) as string[];
  const accessibility = (JSON.parse(child.accessibilityJson) as { needs?: string }).needs;
  const verified = child.profileState === "verified";
  const openCycle = cycles.find((entry) => entry.status !== "closed");

  return (
    <>
      <PageHeader
        title={child.name}
        description={`${child.code} · ${SEX_LABELS[child.sex ?? "unknown"]} · ${child.birthDate ? `lahir ${formatDate(child.birthDate)}` : `usia perkiraan ${child.estimatedAge} th per ${formatDate(child.ageReferenceDate)}`}`}
        actions={<>{child.fictional ? <Badge tone="clay">Data fiktif</Badge> : null}<Badge tone={verified ? "sage" : "neutral"}>{verified ? "Terverifikasi" : child.profileState === "archived" ? "Diarsipkan" : "Draft"}</Badge></>}
      />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card>
            <h2 className="text-lg font-semibold">Langkah asesmen</h2>
            <ol className="mt-4 space-y-4 text-sm">
              <li className="flex flex-wrap items-center justify-between gap-3">
                <span><span className="font-medium">1. Verifikasi profil anak</span><br /><span className="text-ink-500">Pastikan nama dan usia benar; usia menentukan instrumen.</span></span>
                {verified ? <Badge tone="sage">Selesai</Badge> : child.profileState === "draft" ? <ActionButton path={`/api/children/${child.id}/verify`} data={{ revision: child.revision }}>Verifikasi profil</ActionButton> : null}
              </li>
              <li className="flex flex-wrap items-center justify-between gap-3">
                <span><span className="font-medium">2. Hubungkan orang tua / wali</span><br /><span className="text-ink-500">Opsional. Wali mengisi kuesioner terpisah (13 pertanyaan).</span></span>
                <Badge tone={links.length ? "sage" : "neutral"}>{links.length ? `${links.length} wali` : "Belum ada"}</Badge>
              </li>
              <li className="flex flex-wrap items-center justify-between gap-3">
                <span><span className="font-medium">3. Mulai siklus asesmen</span><br /><span className="text-ink-500">{prediction.module ? `Usia sekarang ${prediction.age!.age} th${prediction.age!.estimated ? " (perkiraan)" : ""} → ${MODULE_LABELS[prediction.module]}` : prediction.error}</span></span>
                {openCycle ? <Link href={`/cycles/${openCycle.id}`} className="text-sm font-medium text-sage-700 underline">Buka siklus aktif →</Link> : <ActionButton path={`/api/children/${child.id}/cycles`} data={cycles.length ? { kind: "followup", priorCycleId: cycles[0].id } : {}} disabled={!verified || !prediction.module}>Mulai siklus</ActionButton>}
              </li>
            </ol>
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Siklus asesmen</h2>
            {!cycles.length ? <p className="mt-3 text-sm text-ink-500">Belum ada siklus. Verifikasi profil lalu mulai siklus pertama.</p> : (
              <ul className="mt-3 divide-y divide-cream-200">
                {cycles.map((entry) => (
                  <li key={entry.id}><Link href={`/cycles/${entry.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:text-sage-700">
                    <span><span className="font-medium">{MODULE_LABELS[entry.module]}</span><br /><span className="text-xs text-ink-500">Usia {entry.ageAtStart} th{entry.ageIsEstimated ? " (perkiraan)" : ""} · dimulai {formatDateTime(entry.startedAt)}</span></span>
                    <Badge tone={entry.status === "closed" ? "neutral" : "sky"}>{CYCLE_STATUS[entry.status]}</Badge>
                  </Link></li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Riwayat asesmen</h2>
            {!assessments.length ? <p className="mt-3 text-sm text-ink-500">Belum ada asesmen.</p> : (
              <ul className="mt-3 divide-y divide-cream-200 text-sm">
                {assessments.map((entry) => {
                  const guardian = links.find((link) => link.guardian.id === entry.guardianId)?.guardian;
                  return <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <Link className="font-medium text-sage-700" href={entry.status === "draft" ? `/cycles/${entry.cycleId}` : `/assessments/${entry.id}`}>{entry.target === "child" ? `Anak · Modul ${entry.module}` : `Wali · ${guardian?.name ?? "—"}`}</Link>
                    <span className="text-ink-500">{ASSESSMENT_STATUS[entry.status]} · {formatDateTime(entry.submittedAt ?? entry.createdAt)}</span>
                  </li>;
                })}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <h2 className="text-lg font-semibold">Orang tua / wali</h2>
            {!links.length ? <p className="mt-3 text-sm text-ink-500">Belum ada wali terhubung.</p> : (
              <ul className="mt-3 space-y-3">
                {links.map(({ link, guardian }) => (
                  <li key={link.id} className="rounded-xl border border-cream-200 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/guardians/${guardian.id}`} className="font-medium text-sage-700">{guardian.name}</Link>
                      <Badge tone={guardian.profileState === "verified" ? "sage" : "neutral"}>{guardian.profileState === "verified" ? "Terverifikasi" : "Draft"}</Badge>
                    </div>
                    <p className="mt-1 text-ink-500">{link.relationship}{link.isPrimary ? " · pendamping utama" : ""} · {CONTACT_SAFETY[link.contactSafety]}</p>
                    {guardian.profileState === "draft" ? <div className="mt-2"><ActionButton variant="secondary" path={`/api/guardians/${guardian.id}/verify`} data={{ revision: guardian.revision }}>Verifikasi wali</ActionButton></div> : null}
                  </li>
                ))}
              </ul>
            )}
            {child.profileState !== "archived" ? <div className="mt-4"><GuardianLinkForm childId={child.id} fictional={child.fictional} /></div> : null}
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Profil</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div><dt className="text-ink-500">Konteks keluarga</dt><dd>{background.length ? background.map(familyContextLabel).join(", ") : "Tidak dicatat"}</dd></div>
              <div><dt className="text-ink-500">Tanggal masuk</dt><dd>{formatDate(child.admissionDate)}</dd></div>
              <div><dt className="text-ink-500">Aksesibilitas</dt><dd>{accessibility || "—"}</dd></div>
              <div><dt className="text-ink-500">Catatan</dt><dd className="whitespace-pre-wrap">{child.notes || "—"}</dd></div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}

export default function ChildPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<Skeleton rows={8} />}><ChildDetail params={params} /></Suspense>;
}
