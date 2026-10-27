"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Card,
  Field,
  inputClassName,
  primaryButtonClassName,
} from "@/components/ui";
import type { OrganizationProfileView } from "@/server/services/settings.service";

type ApiFailure = {
  error?: { message?: string; fieldErrors?: Record<string, string[]> };
};

const TIMEZONE_OPTIONS = [
  { value: "Asia/Jakarta", label: "Asia/Jakarta (WIB)" },
  { value: "Asia/Makassar", label: "Asia/Makassar (WITA)" },
  { value: "Asia/Jayapura", label: "Asia/Jayapura (WIT)" },
];

type FormState = {
  name: string;
  address: string;
  phone: string;
  email: string;
  contact: string;
  leaderName: string;
  leaderTitle: string;
  registrationNumber: string;
  printNote: string;
  timezone: string;
};

function toFormState(profile: OrganizationProfileView): FormState {
  return {
    name: profile.name,
    address: profile.address ?? "",
    phone: profile.phone ?? "",
    email: profile.email ?? "",
    contact: profile.contact ?? "",
    leaderName: profile.leaderName ?? "",
    leaderTitle: profile.leaderTitle ?? "",
    registrationNumber: profile.registrationNumber ?? "",
    printNote: profile.printNote ?? "",
    timezone: profile.timezone,
  };
}

/**
 * The whole letterhead is submitted as one unit, so an emptied input clears the
 * stored value. `revision` guards against overwriting another session's save.
 */
export function ProfileForm({ initial }: { initial: OrganizationProfileView }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(initial));
  const [revision, setRevision] = useState(initial.revision);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function update<TKey extends keyof FormState>(key: TKey, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage(null);
    setSuccess(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/admin/general-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, revision }),
      });

      const body = (await response.json().catch(() => ({}))) as
        | ApiFailure
        | { data: OrganizationProfileView };

      if (!response.ok) {
        const failure = body as ApiFailure;
        setMessage(failure.error?.message ?? "Permintaan ditolak oleh server.");
        setFieldErrors(failure.error?.fieldErrors ?? {});
        return;
      }

      const saved = (body as { data: OrganizationProfileView }).data;
      setForm(toFormState(saved));
      setRevision(saved.revision);
      setSuccess("Profil panti disimpan. Dasbor dan kop cetak memakai data ini.");
      router.refresh();
    } catch {
      setMessage("Server lokal tidak merespons.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold text-ink-900">Identitas panti</h2>
      <p className="mt-1 text-xs text-ink-500">
        Data ini dipakai pada header aplikasi, kartu identitas di dasbor dan kop halaman
        hasil asesmen yang dicetak. Kosongkan kolom untuk menghapus isinya.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-4 md:grid-cols-2">
        {message ? (
          <p
            className="rounded-xl border border-clay-500/30 bg-clay-100 px-3 py-2 text-sm text-clay-600 md:col-span-2"
            role="alert"
          >
            {message}
          </p>
        ) : null}
        {success ? (
          <p
            className="rounded-xl border border-sage-200 bg-sage-50 px-3 py-2 text-sm text-sage-700 md:col-span-2"
            role="status"
          >
            {success}
          </p>
        ) : null}

        <Field
          label="Nama panti asuhan"
          htmlFor="org-name"
          error={fieldErrors.name?.[0]}
          hint="Tampil di header aplikasi dan baris pertama kop cetak."
        >
          <input
            id="org-name"
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
            className={inputClassName}
            autoComplete="off"
            required
            minLength={2}
            maxLength={120}
          />
        </Field>

        <Field
          label="Nomor izin / akta"
          htmlFor="org-registration"
          error={fieldErrors.registrationNumber?.[0]}
          hint="Opsional, misalnya nomor izin operasional dinas sosial."
        >
          <input
            id="org-registration"
            value={form.registrationNumber}
            onChange={(event) => update("registrationNumber", event.target.value)}
            className={inputClassName}
            autoComplete="off"
            maxLength={80}
          />
        </Field>

        <Field
          label="Alamat"
          htmlFor="org-address"
          error={fieldErrors.address?.[0]}
          hint="Alamat lengkap untuk kop cetak."
        >
          <textarea
            id="org-address"
            value={form.address}
            onChange={(event) => update("address", event.target.value)}
            className={`${inputClassName} min-h-20`}
            maxLength={300}
          />
        </Field>

        <Field
          label="Catatan kop cetak"
          htmlFor="org-print-note"
          error={fieldErrors.printNote?.[0]}
          hint="Baris tambahan di bawah kop, misalnya unit layanan atau nomor arsip."
        >
          <textarea
            id="org-print-note"
            value={form.printNote}
            onChange={(event) => update("printNote", event.target.value)}
            className={`${inputClassName} min-h-20`}
            maxLength={300}
          />
        </Field>

        <Field
          label="Nomor telepon"
          htmlFor="org-phone"
          error={fieldErrors.phone?.[0]}
          hint="Angka dan tanda + ( ) - saja."
        >
          <input
            id="org-phone"
            type="tel"
            value={form.phone}
            onChange={(event) => update("phone", event.target.value)}
            className={inputClassName}
            autoComplete="off"
            maxLength={32}
          />
        </Field>

        <Field label="Email" htmlFor="org-email" error={fieldErrors.email?.[0]}>
          <input
            id="org-email"
            type="email"
            value={form.email}
            onChange={(event) => update("email", event.target.value)}
            className={inputClassName}
            autoComplete="off"
            maxLength={200}
          />
        </Field>

        <Field
          label="Kontak lain"
          htmlFor="org-contact"
          error={fieldErrors.contact?.[0]}
          hint="Misalnya nomor WhatsApp layanan atau narahubung."
        >
          <input
            id="org-contact"
            value={form.contact}
            onChange={(event) => update("contact", event.target.value)}
            className={inputClassName}
            autoComplete="off"
            maxLength={200}
          />
        </Field>

        <Field
          label="Zona waktu"
          htmlFor="org-timezone"
          error={fieldErrors.timezone?.[0]}
          hint="Dipakai untuk menampilkan tanggal dan jam pada layar dan cetakan."
        >
          <select
            id="org-timezone"
            value={form.timezone}
            onChange={(event) => update("timezone", event.target.value)}
            className={inputClassName}
          >
            {(TIMEZONE_OPTIONS.some((option) => option.value === form.timezone)
              ? TIMEZONE_OPTIONS
              : [{ value: form.timezone, label: form.timezone }, ...TIMEZONE_OPTIONS]
            ).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Nama pimpinan panti"
          htmlFor="org-leader"
          error={fieldErrors.leaderName?.[0]}
          hint="Opsional; dipakai pada blok tanda tangan kop cetak."
        >
          <input
            id="org-leader"
            value={form.leaderName}
            onChange={(event) => update("leaderName", event.target.value)}
            className={inputClassName}
            autoComplete="off"
            maxLength={120}
          />
        </Field>

        <Field
          label="Jabatan pimpinan"
          htmlFor="org-leader-title"
          error={fieldErrors.leaderTitle?.[0]}
        >
          <input
            id="org-leader-title"
            value={form.leaderTitle}
            onChange={(event) => update("leaderTitle", event.target.value)}
            className={inputClassName}
            autoComplete="off"
            maxLength={120}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <button type="submit" disabled={pending} className={primaryButtonClassName}>
            {pending ? "Menyimpan…" : "Simpan profil panti"}
          </button>
          <span className="text-xs text-ink-500">Revisi tersimpan: {revision}</span>
        </div>
      </form>
    </Card>
  );
}
