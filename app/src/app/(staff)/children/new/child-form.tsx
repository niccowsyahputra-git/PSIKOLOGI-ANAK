"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Card, Field, inputClassName, primaryButtonClassName, secondaryButtonClassName } from "@/components/ui";
import { api } from "@/lib/client-api";
import { FAMILY_CONTEXT } from "@/lib/labels";

/** Child registration (FR-03). Real-data entry stays locked while live intake is disabled. */
export function ChildForm({ liveIntakeEnabled }: { liveIntakeEnabled: boolean }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [fictional, setFictional] = useState(true);
  const [ageMode, setAgeMode] = useState<"birth" | "estimate">("birth");
  const [background, setBackground] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setSaving(true);
    const form = new FormData(event.currentTarget); const text = (name: string) => String(form.get(name) ?? "").trim();
    try {
      const child = await api<{ id: string }>("/api/children", "POST", {
        name: text("name"), fictional, sex: text("sex") || "unknown", background,
        ...(ageMode === "birth" ? { birthDate: text("birthDate") || null } : { estimatedAge: Number.parseInt(text("estimatedAge"), 10), ageReferenceDate: text("ageReferenceDate") || null }),
        admissionDate: text("admissionDate") || null, notes: text("notes"), accessibility: text("accessibility"),
      });
      router.push(`/children/${child.id}`);
    } catch (cause) { setError((cause as Error).message); setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Card className="space-y-4">
        <label className="flex items-start gap-3 rounded-xl bg-clay-100/60 p-3 text-sm">
          <input type="checkbox" className="mt-1" checked={fictional} disabled={!liveIntakeEnabled} onChange={(event) => setFictional(event.target.checked)} />
          <span><span className="font-medium text-ink-900">Data fiktif untuk demonstrasi</span><br />
            <span className="text-ink-500">{liveIntakeEnabled ? "Hapus centang hanya untuk anak nyata dengan dasar kewenangan dan persetujuan yang sah." : "Penggunaan nyata belum diaktifkan (LIVE_INTAKE_ENABLED=false). Hanya data fiktif yang dapat dibuat."}</span></span>
        </label>
        <Field label="Nama anak" htmlFor="name" hint={fictional ? "Gunakan nama samaran, misalnya \"Anak Contoh 1\"." : undefined}>
          <input id="name" name="name" required minLength={2} maxLength={200} className={inputClassName} />
        </Field>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-ink-700">Usia (menentukan instrumen)</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="ageMode" checked={ageMode === "birth"} onChange={() => setAgeMode("birth")} />Tanggal lahir diketahui</label>
            <label className="flex items-center gap-2"><input type="radio" name="ageMode" checked={ageMode === "estimate"} onChange={() => setAgeMode("estimate")} />Hanya usia perkiraan</label>
          </div>
          {ageMode === "birth" ? (
            <Field label="Tanggal lahir" htmlFor="birthDate"><input id="birthDate" name="birthDate" type="date" max={today} required className={inputClassName} /></Field>
          ) : (
            <div className="grid gap-3">
              <Field label="Usia perkiraan (tahun)" htmlFor="estimatedAge"><input id="estimatedAge" name="estimatedAge" type="number" min={0} max={100} required className={inputClassName} /></Field>
              <Field label="Diperkirakan per tanggal" htmlFor="ageReferenceDate"><input id="ageReferenceDate" name="ageReferenceDate" type="date" max={today} defaultValue={today} required className={inputClassName} /></Field>
            </div>
          )}
          <p className="text-xs text-ink-500">4–8 tahun → Modul A · 9–12 → Modul B · 13–18 → Modul C. Usia dibekukan saat siklus asesmen dimulai.</p>
        </fieldset>
        <div className="grid gap-3">
          <Field label="Jenis kelamin" htmlFor="sex">
            <select id="sex" name="sex" className={inputClassName} defaultValue="unknown"><option value="unknown">Tidak dicatat</option><option value="female">Perempuan</option><option value="male">Laki-laki</option></select>
          </Field>
          <Field label="Tanggal masuk panti" htmlFor="admissionDate"><input id="admissionDate" name="admissionDate" type="date" max={today} className={inputClassName} /></Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink-700">Konteks keluarga (boleh lebih dari satu, boleh kosong)</legend>
          <div className="flex flex-wrap gap-2">
            {FAMILY_CONTEXT.map((entry) => (
              <label key={entry.value} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${background.includes(entry.value) ? "border-sage-600 bg-sage-100 text-sage-700" : "border-cream-300 bg-white text-ink-700"}`}>
                <input type="checkbox" className="sr-only" checked={background.includes(entry.value)} onChange={(event) => setBackground((list) => event.target.checked ? [...list, entry.value] : list.filter((value) => value !== entry.value))} />{entry.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-ink-500">Konteks, bukan diagnosis atau dasar penolakan anak.</p>
        </fieldset>
        <Field label="Kebutuhan aksesibilitas" htmlFor="accessibility" hint="Misalnya: perlu dibacakan, belum lancar menulis.">
          <input id="accessibility" name="accessibility" maxLength={1000} className={inputClassName} />
        </Field>
        <Field label="Catatan pengasuh" htmlFor="notes"><textarea id="notes" name="notes" rows={3} maxLength={4000} className={inputClassName} /></Field>
      </Card>
      {error ? <p role="alert" className="rounded-xl bg-clay-100 px-4 py-3 text-sm text-clay-600">{error}</p> : null}
      <div className="flex gap-3">
        <button type="submit" disabled={saving} className={primaryButtonClassName}>{saving ? "Menyimpan…" : "Simpan profil anak"}</button>
        <button type="button" onClick={() => router.back()} className={secondaryButtonClassName}>Batal</button>
      </div>
    </form>
  );
}
