"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  inputClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS, STAFF_ROLES, type StaffRole } from "@/lib/roles";
import type { StaffWire } from "@/lib/serializers/staff";

type ApiFailure = {
  error?: { message?: string; fieldErrors?: Record<string, string[]> };
};

async function readFailure(response: Response): Promise<{
  message: string;
  fieldErrors: Record<string, string[]>;
}> {
  const body = (await response.json().catch(() => ({}))) as ApiFailure;
  return {
    message: body.error?.message ?? "Permintaan ditolak oleh server.",
    fieldErrors: body.error?.fieldErrors ?? {},
  };
}

export function StaffAdminPanel({
  initialRows,
  actorMembershipId,
  timezone,
}: {
  initialRows: StaffWire[];
  actorMembershipId: string;
  timezone: string;
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activeCount = initialRows.filter((row) => row.active).length;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <Badge tone="sage">{activeCount} aktif</Badge>
          <Badge tone="neutral">{initialRows.length} total akun</Badge>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-500">
          Peran efektif selalu dihitung ulang di server pada setiap aksi.
        </p>
      </div>

      <CreateStaffCard onCreated={() => router.refresh()} />

      {initialRows.length === 0 ? (
        <EmptyState
          title="Belum ada akun staf"
          description="Jalankan `npm run bootstrap:admin` untuk membuat administrator pertama, atau tambahkan akun di formulir di atas."
        />
      ) : (
        <ul className="space-y-2.5">
          {/* Six table columns cannot share one phone column, so every account
              is a card and the editor opens inside the card it belongs to. */}
          {initialRows.map((row) => {
            const isSelf = row.membershipId === actorMembershipId;
            const expanded = expandedId === row.membershipId;
            return (
              <li key={row.membershipId}>
                <Card>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-ink-900">{row.name}</p>
                      <p className="truncate text-[12px] text-ink-500">{row.email}</p>
                    </div>
                    {isSelf ? (
                      <span className="flex-none text-[10px] font-medium text-sky-soft-600">
                        sesi Anda
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone={row.role === "admin" ? "sky" : row.role === "psikolog" ? "sage" : "neutral"}>
                      {row.roleLabel}
                    </Badge>
                    {row.active ? (
                      <Badge tone="sage">Aktif</Badge>
                    ) : (
                      <Badge tone="clay">Nonaktif</Badge>
                    )}
                    {row.role === "psikolog" ? (
                      <Badge tone={row.credentialVerified ? "sage" : "clay"}>
                        {row.credentialVerified ? "Kredensial terverifikasi" : "Kredensial belum diverifikasi"}
                      </Badge>
                    ) : null}
                  </div>

                  <p className="mt-2 text-[11px] text-ink-500">
                    Dibuat {formatDateTime(row.createdAt, timezone)}
                  </p>

                  <button
                    type="button"
                    className={`${secondaryButtonClassName} mt-3 w-full`}
                    onClick={() => setExpandedId(expanded ? null : row.membershipId)}
                    aria-expanded={expanded}
                  >
                    {expanded ? "Tutup" : "Kelola"}
                  </button>

                  {expanded ? (
                    <div className="mt-3 border-t border-cream-200 pt-3">
                      <RowEditor
                        key={row.membershipId}
                        row={row}
                        isSelf={isSelf}
                        onDone={() => router.refresh()}
                      />
                    </div>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Card>
        <h2 className="text-sm font-semibold text-ink-900">Catatan kebijakan</h2>
        <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-ink-500">
          <li>• Kata sandi tidak pernah ditampilkan ulang setelah dibuat.</li>
          <li>• Perubahan peran atau status menghapus sesi aktif akun tersebut.</li>
          <li>• Peran sendiri tidak bisa diturunkan dari akun yang sama.</li>
          <li>• Administrator aktif terakhir tidak dapat dinonaktifkan.</li>
          <li>• Peran psikolog wajib memiliki referensi kredensial dan konfirmasi ketua.</li>
        </ul>
      </Card>
    </div>
  );
}

function CreateStaffCard({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("pengasuh");
  const [credentialReference, setCredentialReference] = useState("");
  const [chairpersonConfirmation, setChairpersonConfirmation] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage(null);
    setSuccess(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          role,
          ...(role === "psikolog" ? { credentialReference, chairpersonConfirmation } : {}),
        }),
      });

      if (!response.ok) {
        const failure = await readFailure(response);
        setMessage(failure.message);
        setFieldErrors(failure.fieldErrors);
        return;
      }

      setSuccess(`Akun ${email} dibuat. Sampaikan kata sandi secara langsung, bukan lewat pesan.`);
      setName("");
      setEmail("");
      setPassword("");
      setRole("pengasuh");
      setCredentialReference("");
      setChairpersonConfirmation(false);
      onCreated();
    } catch {
      setMessage("Server lokal tidak merespons.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <h2 className="text-sm font-semibold text-ink-900">Tambah akun staf</h2>
      <p className="mt-1 text-xs text-ink-500">
        Akun hanya dibuat di sini; tidak ada pendaftaran mandiri dari halaman login.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 grid gap-4">
        {message ? (
          <p className="rounded-xl border border-clay-500/30 bg-clay-100 px-3 py-2 text-sm text-clay-600" role="alert">
            {message}
          </p>
        ) : null}
        {success ? (
          <p className="rounded-xl border border-sage-200 bg-sage-50 px-3 py-2 text-sm text-sage-700" role="status">
            {success}
          </p>
        ) : null}

        <Field label="Nama lengkap" htmlFor="staff-name" error={fieldErrors.name?.[0]}>
          <input
            id="staff-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClassName}
            autoComplete="off"
            required
          />
        </Field>

        <Field label="Email" htmlFor="staff-email" error={fieldErrors.email?.[0]}>
          <input
            id="staff-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClassName}
            autoComplete="off"
            required
          />
        </Field>

        <Field
          label="Kata sandi awal"
          htmlFor="staff-password"
          error={fieldErrors.password?.[0]}
          hint="Minimal 12 karakter; tidak dapat dilihat lagi setelah disimpan."
        >
          <input
            id="staff-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClassName}
            autoComplete="new-password"
            minLength={12}
            required
          />
        </Field>

        <Field label="Peran" htmlFor="staff-role" error={fieldErrors.role?.[0]}>
          <select
            id="staff-role"
            value={role}
            onChange={(event) => setRole(event.target.value as StaffRole)}
            className={inputClassName}
          >
            {STAFF_ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>

        {role === "psikolog" ? (
          <>
            <Field
              label="Referensi kredensial profesi"
              htmlFor="staff-credential"
              error={fieldErrors.credentialReference?.[0]}
              hint="Nomor STR/SIPP atau dokumen sejenis. Hanya disimpan sebagai referensi."
            >
              <input
                id="staff-credential"
                value={credentialReference}
                onChange={(event) => setCredentialReference(event.target.value)}
                className={inputClassName}
                autoComplete="off"
                required
              />
            </Field>

            <label className="flex items-start gap-2 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={chairpersonConfirmation}
                onChange={(event) => setChairpersonConfirmation(event.target.checked)}
                className="mt-1"
                required
              />
              <span>
                Ketua panti telah mengonfirmasi kredensial psikolog ini.
                {fieldErrors.chairpersonConfirmation?.[0] ? (
                  <span className="mt-1 block text-xs text-clay-600">
                    {fieldErrors.chairpersonConfirmation[0]}
                  </span>
                ) : null}
              </span>
            </label>
          </>
        ) : null}

        <button type="submit" disabled={pending} className={`${primaryButtonClassName} w-full`}>
          {pending ? "Menyimpan…" : "Buat akun"}
        </button>
      </form>
    </Card>
  );
}

function RowEditor({
  row,
  isSelf,
  onDone,
}: {
  row: StaffWire;
  isSelf: boolean;
  onDone: () => void;
}) {
  const [role, setRole] = useState<StaffRole>(row.role);
  const [credentialReference, setCredentialReference] = useState(
    row.credentialReference ?? "",
  );
  const [chairpersonConfirmation, setChairpersonConfirmation] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function patch(payload: Record<string, unknown>): Promise<boolean> {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${row.membershipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const failure = await readFailure(response);
        setMessage(failure.message);
        return false;
      }
      onDone();
      return true;
    } catch {
      setMessage("Server lokal tidak merespons.");
      return false;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink-900">
          Kelola {row.name}{" "}
          <span className="font-normal text-ink-500">({row.email})</span>
        </p>
        <Badge tone={row.active ? "sage" : "clay"}>
          {row.active ? "Aktif" : "Nonaktif"}
        </Badge>
      </div>

      {message ? (
        <p className="rounded-xl border border-clay-500/30 bg-clay-100 px-3 py-2 text-sm text-clay-600" role="alert">
          {message}
        </p>
      ) : null}

      <div className="grid gap-4">
        <Field
          label="Peran"
          htmlFor={`role-${row.membershipId}`}
          hint={
            isSelf
              ? "Peran akun sendiri tidak dapat diubah dari sesi ini."
              : "Mengubah peran akan mengakhiri sesi aktif akun tersebut."
          }
        >
          <select
            id={`role-${row.membershipId}`}
            value={role}
            onChange={(event) => setRole(event.target.value as StaffRole)}
            className={inputClassName}
            disabled={isSelf || pending}
          >
            {STAFF_ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>

        {role === "psikolog" || row.role === "psikolog" ? (
          <Field
            label="Referensi kredensial"
            htmlFor={`credential-${row.membershipId}`}
            hint="Wajib saat menetapkan peran psikolog."
          >
            <input
              id={`credential-${row.membershipId}`}
              value={credentialReference}
              onChange={(event) => setCredentialReference(event.target.value)}
              className={inputClassName}
              autoComplete="off"
            />
          </Field>
        ) : null}
      </div>

      {role === "psikolog" && role !== row.role ? (
        <label className="flex items-start gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={chairpersonConfirmation}
            onChange={(event) => setChairpersonConfirmation(event.target.checked)}
            className="mt-1"
          />
          <span>Ketua panti telah mengonfirmasi kredensial psikolog ini.</span>
        </label>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || role === row.role}
          className={primaryButtonClassName}
          onClick={() =>
            patch({
              role,
              ...(role === "psikolog"
                ? { credentialReference, chairpersonConfirmation }
                : {}),
            })
          }
        >
          Simpan peran
        </button>

        <button
          type="button"
          disabled={pending || isSelf}
          className={secondaryButtonClassName}
          onClick={() => patch({ active: !row.active })}
        >
          {row.active ? "Nonaktifkan akun" : "Aktifkan kembali"}
        </button>
      </div>
    </div>
  );
}
