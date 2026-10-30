import Link from "next/link";
import { Suspense } from "react";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { templateDetail, templateAuditHistory, versionDetail } from "@/server/services/template.service";
import { Card, LoadingState, PageHeader, secondaryButtonClassName } from "@/components/ui";
import type { Definition } from "@/lib/assessment-builder/definition";

function changes(before: Definition | undefined, after: Definition): string[] {
  if (!before) return ["Versi pertama"];
  const diffs: string[] = [];
  for (const key of Object.keys(after) as (keyof Definition)[]) {
    if (key === "sections" || key === "questions") continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) diffs.push(`Metadata ${key}: ${JSON.stringify(before[key])} → ${JSON.stringify(after[key])}`);
  }
  for (const kind of ["sections", "questions"] as const) {
    const oldItems = before[kind]; const newItems = after[kind];
    if (oldItems.map((x) => x.id).join() !== newItems.map((x) => x.id).join()) diffs.push(`Urutan / identitas ${kind} berubah`);
    for (const item of newItems) {
      const old = oldItems.find((x) => x.id === item.id);
      if (!old) { diffs.push(`Ditambahkan ${kind}: ${"label" in item ? item.label : item.title}`); continue; }
      const a = old as unknown as Record<string, unknown>; const b = item as unknown as Record<string, unknown>;
      for (const key of Object.keys(b)) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) diffs.push(`${kind} ${item.id} · ${key}: ${JSON.stringify(a[key])} → ${JSON.stringify(b[key])}`);
    }
    for (const item of oldItems) if (!newItems.some((x) => x.id === item.id)) diffs.push(`Dihapus ${kind}: ${item.id}`);
  }
  return diffs.length ? diffs : ["Tidak ada perubahan definisi"];
}
async function History({ params }: { params: Promise<{ id: string }> }) {
  const actor = toStaffActor(await requireStaffSession()); const id = (await params).id;
  const { template, versions } = await templateDetail(actor, id);
  const details = await Promise.all(versions.map((v) => versionDetail(actor, v.id)));
  const audit = await templateAuditHistory(actor, id);
  return <div className="builder-workspace space-y-4"><PageHeader title={`Riwayat · ${template.name}`} />{details.map((d, i) => <Card key={d.version.id}><Link className={secondaryButtonClassName} href={`/template-versions/${d.version.id}`}>Versi {d.version.number} · {d.version.status}</Link><p className="my-2 break-all text-xs">SHA-256 {d.version.contentHash}</p><details><summary>Perbedaan pertanyaan, opsi, dan aturan dari versi sebelumnya</summary><ul className="space-y-2 break-words text-sm">{changes(details[i + 1]?.definition, d.definition).map((diff, n) => <li key={n}>{diff}</li>)}</ul></details></Card>)}<Card><h2 className="font-semibold">Audit tersanitasi (200 terakhir)</h2><ul className="space-y-2">{audit.map((event) => <li key={event.id}>{event.createdAt.toISOString()} · {event.action}</li>)}</ul></Card></div>;
}
export default function Page(props: { params: Promise<{ id: string }> }) { return <Suspense fallback={<LoadingState />}><History {...props} /></Suspense>; }
