"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field, inputClassName, primaryButtonClassName, secondaryButtonClassName } from "@/components/ui";
import { api } from "@/lib/client-api";

function useAction() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function run(work: () => Promise<unknown>, after?: () => void) {
    setError(""); setSaving(true);
    try { await work(); after?.(); router.refresh(); } catch (cause) { setError((cause as Error).message); }
    setSaving(false);
  }
  return { error, saving, run };
}

export function ObservationForm({ assessmentId }: { assessmentId: string }) {
  const { error, saving, run } = useAction();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget; const observation = String(new FormData(element).get("observation") ?? "").trim();
    void run(() => api(`/api/assessments/${assessmentId}/observations`, "POST", { observation }), () => element.reset());
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <Field label="Catatan observasi pendamping" htmlFor="observation" hint="Tulis yang diamati (perilaku, suasana), bukan kesimpulan diagnosis."><textarea id="observation" name="observation" required maxLength={4000} rows={3} className={inputClassName} /></Field>
      {error ? <p role="alert" className="text-sm text-clay-600">{error}</p> : null}
      <button disabled={saving} className={primaryButtonClassName}>Simpan catatan</button>
    </form>
  );
}

export function LateUploadForm({ assessmentId }: { assessmentId: string }) {
  const { error, saving, run } = useAction();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget; const file = new FormData(element).get("file");
    if (!(file instanceof File) || !file.size) return;
    const form = new FormData(); form.set("file", file);
    void run(() => api(`/api/assessments/${assessmentId}/late-attachments`, "POST", form), () => element.reset());
  }
  return (
    <form onSubmit={submit} className="space-y-2">
      <Field label="Unggah foto gambar kertas" htmlFor="file" hint="PNG/JPG/WebP maksimal 5 MB. Metadata lokasi foto dibuang."><input id="file" name="file" type="file" required accept="image/png,image/jpeg,image/webp" className="text-sm" /></Field>
      {error ? <p role="alert" className="text-sm text-clay-600">{error}</p> : null}
      <button disabled={saving} className={secondaryButtonClassName}>{saving ? "Mengunggah…" : "Unggah susulan"}</button>
    </form>
  );
}

/** Reason-gated actions: corrections create a new draft version; withdrawals hide answers. */
export function ReasonAction({ label, confirmLabel, path, build, redirectTo }: { label: string; confirmLabel: string; path: string; build: Record<string, string>; redirectTo?: "cycle" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { error, saving, run } = useAction();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    const reasonKey = "parentAssessmentId" in build ? "correctionReason" : "reason";
    void run(() => api(path, "POST", { ...build, [reasonKey]: reason }), () => { setOpen(false); if (redirectTo === "cycle") router.push(path.replace(/\/assessments$/, "")); });
  }
  if (!open) return <button type="button" className={secondaryButtonClassName} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form onSubmit={submit} className="space-y-2 rounded-2xl border border-cream-200 bg-cream-50 p-3">
      <Field label="Alasan (wajib)" htmlFor={`reason-${label}`}><input id={`reason-${label}`} name="reason" required minLength={5} maxLength={1000} className={inputClassName} /></Field>
      {error ? <p role="alert" className="text-sm text-clay-600">{error}</p> : null}
      <div className="flex gap-2"><button disabled={saving} className={primaryButtonClassName}>{confirmLabel}</button><button type="button" className={secondaryButtonClassName} onClick={() => setOpen(false)}>Batal</button></div>
    </form>
  );
}
