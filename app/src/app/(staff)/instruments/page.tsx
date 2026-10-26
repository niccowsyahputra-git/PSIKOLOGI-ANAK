import type { Metadata } from "next";
import { Suspense } from "react";
import { Badge, Card, PageHeader, Skeleton } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { getEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { EMOTIONS, INSTRUMENTS, INSTRUMENT_VERSION, LIKERT_LABELS, SKIP_REMINDER, type Module } from "@/lib/instruments";
import { MODULE_LABELS } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { instrumentOverview } from "@/server/services/assessment.service";
import { InstrumentDecision } from "./instrument-decision";

export const metadata: Metadata = { title: "Instrumen & persetujuan" };
const KIND_LABELS = { emotion: "Pilih wajah emosi", media: "Menggambar / foto / kertas", text: "Jawaban terbuka", likert: "Skala 5 pilihan" } as const;

async function Overview() {
  const session = await requireStaffSession(); const actor = toStaffActor(session);
  const { contentHash, approvals, effective } = await instrumentOverview(actor);
  const live = getEnv().liveIntakeEnabled;
  return (
    <div className="space-y-6">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">Instrumen {INSTRUMENT_VERSION}</h2><Badge tone={effective ? "sage" : "clay"}>{effective ? "Disahkan psikolog" : "Belum disahkan"}</Badge><Badge tone={live ? "sage" : "neutral"}>{live ? "Intake nyata aktif" : "Intake nyata nonaktif · hanya data fiktif"}</Badge></div>
        <p className="break-all font-mono text-xs text-ink-500">SHA-256 {contentHash}</p>
        <p className="text-sm text-ink-500">Penggunaan untuk anak/wali nyata memerlukan: LIVE_INTAKE_ENABLED=true, pengesahan psikolog terverifikasi atas hash ini, review kewenangan ketua, serta persetujuan intake/assent per siklus. Data fiktif dapat dipakai untuk demonstrasi tanpa syarat tersebut.</p>
        <div className="flex flex-wrap gap-2">
          {can(actor.role, "instrument.approve") ? <InstrumentDecision action="approvals" contentHash={contentHash} label="Sahkan instrumen" /> : null}
          {effective && can(actor.role, "instrument.revoke") ? <InstrumentDecision action="revocations" contentHash={contentHash} label="Cabut pengesahan" /> : null}
        </div>
        {approvals.length ? <ul className="divide-y divide-cream-200 text-sm">{approvals.map((entry) => <li key={entry.id} className="py-2"><Badge tone={entry.status === "approved" ? "sage" : "clay"}>{entry.status === "approved" ? "Disahkan" : "Dicabut"}</Badge> <span className="text-xs text-ink-500">{formatDateTime(entry.revokedAt ?? entry.approvedAt)}</span><p className="mt-1">{entry.revokedReason ?? entry.reviewNote}</p></li>)}</ul> : null}
      </Card>
      {(["A", "B", "C", "W"] as Module[]).map((module) => (
        <Card key={module}>
          <h2 className="text-lg font-semibold">{MODULE_LABELS[module]}</h2>
          <p className="mt-1 text-sm text-ink-500">{INSTRUMENTS[module].length} item · semua boleh dilewati · item sensitif diawali pengingat &ldquo;{SKIP_REMINDER}&rdquo;</p>
          <ol className="mt-4 space-y-2 text-sm">
            {INSTRUMENTS[module].map((item) => (
              <li key={item.id} className="flex gap-3"><span className="w-10 shrink-0 font-mono text-xs text-ink-300">{item.id}</span><span className="flex-1">{item.text} <span className="text-xs text-ink-500">· {KIND_LABELS[item.kind]}</span>{item.sensitive ? <Badge tone="clay">sensitif</Badge> : null}</span></li>
            ))}
          </ol>
          {module === "C" || module === "W" ? <p className="mt-3 text-xs text-ink-500">Pilihan skala: {LIKERT_LABELS.join(" · ")}. Tidak dijumlahkan menjadi skor.</p> : null}
          {module === "A" ? <p className="mt-3 text-xs text-ink-500">Wajah emosi: {EMOTIONS.map((entry) => entry.label).join(" · ")}.</p> : null}
        </Card>
      ))}
    </div>
  );
}

export default function InstrumentsPage() {
  return (
    <>
      <PageHeader title="Instrumen & persetujuan" description="Teks pertanyaan persis sesuai lampiran A PRD. Perubahan teks memerlukan versi instrumen baru." />
      <Suspense fallback={<Skeleton rows={8} />}><Overview /></Suspense>
    </>
  );
}
