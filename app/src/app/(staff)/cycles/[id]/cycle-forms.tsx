"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field, inputClassName, primaryButtonClassName, secondaryButtonClassName } from "@/components/ui";
import { api } from "@/lib/client-api";
import { CONSENT_STATUS, CONSENT_TYPES } from "@/lib/labels";

type Subject = { id: string; type: "child" | "guardian"; name: string };

function useSubmit(path: string, build: (form: FormData) => unknown, onDone?: () => void) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaving(true);
    const element = event.currentTarget;
    try { await api(path, "POST", build(new FormData(element))); element.reset(); onDone?.(); router.refresh(); } catch (cause) { setError((cause as Error).message); }
    setSaving(false);
  }
  return { error, saving, submit };
}

/** Consent events are append-only; nothing is preselected (PRD section 8.3). */
export function ConsentForm({ cycleId, subjects }: { cycleId: string; subjects: Subject[] }) {
  const [open, setOpen] = useState(false);
  const { error, saving, submit } = useSubmit(`/api/cycles/${cycleId}/consents`, (form) => {
    const subject = subjects.find((entry) => entry.id === form.get("subject"));
    return { subjectType: subject?.type, subjectId: subject?.id, type: form.get("type"), status: form.get("status"), actorType: form.get("actorType"), noticeVersion: "pemberitahuan-intake-v1", authorityBasis: String(form.get("authorityBasis") ?? "").trim(), notes: String(form.get("notes") ?? "").trim() || undefined };
  }, () => setOpen(false));
  if (!open) return <button type="button" className={secondaryButtonClassName} onClick={() => setOpen(true)}>Catat persetujuan</button>;
  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-cream-200 bg-cream-50 p-4">
      <div className="grid gap-3">
        <Field label="Untuk siapa" htmlFor="subject"><select id="subject" name="subject" required defaultValue="" className={inputClassName}><option value="" disabled>Pilih</option>{subjects.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.type === "child" ? "anak" : "wali"})</option>)}</select></Field>
        <Field label="Jenis" htmlFor="type"><select id="type" name="type" required defaultValue="" className={inputClassName}><option value="" disabled>Pilih</option>{Object.entries(CONSENT_TYPES).filter(([value]) => value !== "ai").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Keputusan" htmlFor="status"><select id="status" name="status" required defaultValue="" className={inputClassName}><option value="" disabled>Pilih keputusan</option>{Object.entries(CONSENT_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Diberikan oleh" htmlFor="actorType"><select id="actorType" name="actorType" required defaultValue="" className={inputClassName}><option value="" disabled>Pilih</option><option value="child">Anak sendiri</option><option value="guardian">Orang tua / wali</option><option value="authorized_representative">Perwakilan berwenang</option></select></Field>
      </div>
      <Field label="Dasar kewenangan" htmlFor="authorityBasis" hint="Minimal 5 karakter, misalnya: wali sah sesuai dokumen penitipan."><input id="authorityBasis" name="authorityBasis" required minLength={5} maxLength={2000} className={inputClassName} /></Field>
      <Field label="Catatan" htmlFor="notes"><input id="notes" name="notes" maxLength={2000} className={inputClassName} /></Field>
      {error ? <p role="alert" className="text-sm text-clay-600">{error}</p> : null}
      <div className="flex gap-2"><button disabled={saving} className={primaryButtonClassName}>Simpan persetujuan</button><button type="button" className={secondaryButtonClassName} onClick={() => setOpen(false)}>Batal</button></div>
    </form>
  );
}

export function AuthorityForm({ cycleId }: { cycleId: string }) {
  const [open, setOpen] = useState(false);
  const { error, saving, submit } = useSubmit(`/api/cycles/${cycleId}/authority-reviews`, (form) => ({ decision: form.get("decision"), lawfulBasisNote: String(form.get("lawfulBasisNote") ?? "").trim() }), () => setOpen(false));
  if (!open) return <button type="button" className={secondaryButtonClassName} onClick={() => setOpen(true)}>Catat review kewenangan</button>;
  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-cream-200 bg-cream-50 p-4">
      <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="mb-2 text-sm font-medium text-ink-700">Keputusan</legend>
        {[["approved", "Disetujui"], ["pending", "Ditunda"], ["declined", "Ditolak"]].map(([value, label]) => <label key={value} className="flex items-center gap-2"><input type="radio" name="decision" value={value} required />{label}</label>)}
      </fieldset>
      <Field label="Catatan dasar hukum / kewenangan" htmlFor="lawfulBasisNote"><textarea id="lawfulBasisNote" name="lawfulBasisNote" required minLength={10} maxLength={2000} rows={2} className={inputClassName} /></Field>
      {error ? <p role="alert" className="text-sm text-clay-600">{error}</p> : null}
      <div className="flex gap-2"><button disabled={saving} className={primaryButtonClassName}>Simpan review</button><button type="button" className={secondaryButtonClassName} onClick={() => setOpen(false)}>Batal</button></div>
    </form>
  );
}

/**
 * Same-device handoff (FR-06): creating the session returns a one-time link.
 * Opening it on this device ends the staff login so the participant can only
 * reach their own questionnaire.
 */
export function HandoffButton({ cycleId, assessmentId, participant }: { cycleId: string; assessmentId: string; participant: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function create() {
    setError(""); setSaving(true);
    try { const session = await api<{ path: string }>(`/api/cycles/${cycleId}/intake-sessions`, "POST", { assessmentId }); setLink(session.path); } catch (cause) { setError((cause as Error).message); }
    setSaving(false);
  }
  if (link) return (
    <div className="space-y-3 rounded-2xl border border-sage-200 bg-sage-100/60 p-4 text-sm">
      <p className="font-medium text-ink-900">Sesi untuk {participant} siap (berlaku 24 jam, sekali pakai).</p>
      <p className="text-ink-700">Setelah perangkat diserahkan, login staf Anda di perangkat ini berakhir. Login kembali setelah peserta menekan &ldquo;Selesai&rdquo;.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButtonClassName} onClick={() => window.location.assign(link)}>Serahkan perangkat & mulai</button>
        <button type="button" className={secondaryButtonClassName} onClick={() => setLink(null)}>Nanti</button>
      </div>
    </div>
  );
  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" disabled={saving} onClick={create} className={primaryButtonClassName}>{saving ? "Menyiapkan…" : `Mulai sesi ${participant}`}</button>
      {error ? <span role="alert" className="text-xs text-clay-600">{error}</span> : null}
    </span>
  );
}
