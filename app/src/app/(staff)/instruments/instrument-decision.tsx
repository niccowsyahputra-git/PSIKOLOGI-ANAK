"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field, inputClassName, primaryButtonClassName, secondaryButtonClassName } from "@/components/ui";
import { api } from "@/lib/client-api";

/** Psychologist approval / revocation of the exact instrument hash (PRD section 8.3). */
export function InstrumentDecision({ action, contentHash, label }: { action: "approvals" | "revocations"; contentHash: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaving(true);
    const note = String(new FormData(event.currentTarget).get("note") ?? "").trim();
    try { await api(`/api/instruments/intake-v1/${action}`, "POST", { contentHash, note }); setOpen(false); router.refresh(); } catch (cause) { setError((cause as Error).message); }
    setSaving(false);
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={action === "approvals" ? primaryButtonClassName : secondaryButtonClassName}>{label}</button>;
  return (
    <form onSubmit={submit} className="space-y-2 rounded-2xl border border-cream-200 bg-cream-50 p-3">
      <Field label={action === "approvals" ? "Catatan review psikolog" : "Alasan pencabutan"} htmlFor={`note-${action}`} hint="Minimal 10 karakter."><textarea id={`note-${action}`} name="note" required minLength={10} maxLength={2000} rows={2} className={inputClassName} /></Field>
      {error ? <p role="alert" className="text-sm text-clay-600">{error}</p> : null}
      <div className="flex gap-2"><button disabled={saving} className={primaryButtonClassName}>{label}</button><button type="button" className={secondaryButtonClassName} onClick={() => setOpen(false)}>Batal</button></div>
    </form>
  );
}
