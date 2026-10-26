"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field, inputClassName, primaryButtonClassName, secondaryButtonClassName } from "@/components/ui";
import { api } from "@/lib/client-api";
import { RELATIONSHIPS } from "@/lib/labels";

/**
 * Adds a guardian in the context of one child (FR-04): the guardian profile is
 * created with the child's fictional flag and immediately linked.
 */
export function GuardianLinkForm({ childId, fictional }: { childId: string; fictional: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [safety, setSafety] = useState("unknown");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaving(true);
    const form = new FormData(event.currentTarget); const text = (name: string) => String(form.get(name) ?? "").trim();
    try {
      const guardian = await api<{ id: string }>("/api/guardians", "POST", { name: text("guardianName"), fictional, communicationPreference: text("communication") || "tatap muka", safeContact: text("safeContact") || null });
      await api(`/api/children/${childId}/guardian-links`, "POST", { guardianId: guardian.id, relationship: text("relationship"), isPrimary: form.get("isPrimary") === "on", contactSafety: safety, contactReviewNote: text("contactReviewNote") });
      setOpen(false); setSaving(false); router.refresh();
    } catch (cause) { setError((cause as Error).message); setSaving(false); }
  }

  if (!open) return <button type="button" className={secondaryButtonClassName} onClick={() => setOpen(true)}>+ Tambah orang tua / wali</button>;
  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-cream-200 bg-cream-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama orang tua / wali" htmlFor="guardianName" hint={fictional ? "Data fiktif: gunakan nama samaran." : undefined}><input id="guardianName" name="guardianName" required minLength={2} maxLength={200} className={inputClassName} /></Field>
        <Field label="Hubungan dengan anak" htmlFor="relationship">
          <select id="relationship" name="relationship" required className={inputClassName} defaultValue="">
            <option value="" disabled>Pilih hubungan</option>
            {RELATIONSHIPS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </Field>
        <Field label="Preferensi komunikasi" htmlFor="communication"><input id="communication" name="communication" defaultValue="tatap muka" maxLength={200} className={inputClassName} /></Field>
        <Field label="Kontak (opsional)" htmlFor="safeContact" hint="Simpan hanya jika aman dihubungi."><input id="safeContact" name="safeContact" maxLength={200} className={inputClassName} /></Field>
        <Field label="Keamanan kontak" htmlFor="contactSafety">
          <select id="contactSafety" value={safety} onChange={(event) => setSafety(event.target.value)} className={inputClassName}>
            <option value="unknown">Belum diketahui</option><option value="safe">Aman — sudah diverifikasi</option><option value="unsafe">Tidak aman</option>
          </select>
        </Field>
        <Field label="Catatan verifikasi kontak" htmlFor="contactReviewNote" hint={safety === "safe" ? "Wajib: siapa/bagaimana kontak diverifikasi." : "Opsional."}><input id="contactReviewNote" name="contactReviewNote" required={safety === "safe"} minLength={safety === "safe" ? 5 : 0} maxLength={1000} className={inputClassName} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" name="isPrimary" />Pendamping utama anak</label>
      {error ? <p role="alert" className="text-sm text-clay-600">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className={primaryButtonClassName}>{saving ? "Menyimpan…" : "Simpan & hubungkan"}</button>
        <button type="button" onClick={() => setOpen(false)} className={secondaryButtonClassName}>Batal</button>
      </div>
    </form>
  );
}
