import Link from "next/link";
import { BuildingIcon, ChevronRightIcon } from "@/components/icons";
import type { OrganizationProfileView } from "@/server/services/settings.service";

/**
 * Panti identity blocks fed by the admin profile screen (FR-17).
 *
 * `PrintLetterhead` is hidden on screen and only appears on paper, so the
 * printed assessment carries the institution name, address and contact without
 * adding visual noise to the staff view. `OrganizationSummary` is the on-screen
 * counterpart used by the dashboard.
 */

function contactLine(profile: OrganizationProfileView): string | null {
  const parts = [
    profile.phone ? `Telp. ${profile.phone}` : null,
    profile.email,
    profile.contact,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function PrintLetterhead({
  profile,
  documentTitle,
  subtitle,
  printedAt,
}: {
  profile: OrganizationProfileView;
  documentTitle: string;
  subtitle?: string;
  printedAt: string;
}) {
  const contact = contactLine(profile);

  return (
    <header className="print-only print-keep mb-4 border-b border-ink-900 pb-2">
      <p className="text-base font-semibold uppercase tracking-wide">
        {profile.name}
      </p>
      {profile.address ? <p className="whitespace-pre-wrap">{profile.address}</p> : null}
      {contact ? <p>{contact}</p> : null}
      {profile.registrationNumber ? (
        <p>No. registrasi: {profile.registrationNumber}</p>
      ) : null}
      <p className="mt-2 font-semibold">{documentTitle}</p>
      {subtitle ? <p>{subtitle}</p> : null}
      <p className="mt-1 text-[10pt]">
        Dicetak {printedAt} · zona waktu {profile.timezone}
      </p>
      {profile.printNote ? (
        <p className="whitespace-pre-wrap text-[10pt]">{profile.printNote}</p>
      ) : null}
    </header>
  );
}

/** Closing block on paper: who holds the document, plus the standing caveat. */
export function PrintFooter({ profile }: { profile: OrganizationProfileView }) {
  return (
    <footer className="print-only print-keep mt-6 border-t border-ink-900 pt-2 text-[10pt]">
      <p>
        Dokumen ini berisi rekaman jawaban apa adanya — bukan skor, diagnosis,
        atau keputusan penempatan. Analisis profesional oleh psikolog adalah
        alur terpisah.
      </p>
      <p className="mt-1">
        Data tersimpan hanya di perangkat panti. Perlakukan cetakan ini sebagai
        dokumen rahasia.
      </p>
      {profile.leaderName ? (
        <div className="mt-6">
          <p>{profile.leaderTitle ?? "Penanggung jawab"}</p>
          <p className="mt-10 font-semibold">{profile.leaderName}</p>
        </div>
      ) : null}
    </footer>
  );
}

export function OrganizationSummary({
  profile,
  canEdit,
}: {
  profile: OrganizationProfileView;
  canEdit: boolean;
}) {
  const contact = contactLine(profile);
  const incomplete = !profile.address || (!profile.phone && !profile.email);

  return (
    <div className="shadow-card rounded-3xl border border-white/80 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="gradient-brand flex h-11 w-11 flex-none items-center justify-center rounded-2xl text-white">
          <BuildingIcon size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
            Panti penyelenggara
          </p>
          <p className="mt-0.5 text-[15px] font-semibold leading-snug text-ink-900">
            {profile.name}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-700">
            {profile.address ?? "Alamat belum diisi"}
          </p>
          <p className="text-[12px] leading-relaxed text-ink-500">
            {contact ?? "Nomor telepon dan email belum diisi"}
          </p>
          {profile.leaderName ? (
            <p className="mt-1 text-[12px] text-ink-500">
              {profile.leaderTitle ?? "Penanggung jawab"}: {profile.leaderName}
            </p>
          ) : null}
        </div>
      </div>
      {canEdit ? (
        <Link
          href="/admin/general-settings"
          prefetch={false}
          className="mt-3 flex min-h-[44px] items-center justify-between gap-2 rounded-2xl bg-cream-50 px-3 text-[13px] font-medium text-sage-700 active:bg-cream-100"
        >
          Ubah profil panti
          <ChevronRightIcon size={16} className="text-ink-300" />
        </Link>
      ) : null}
      {incomplete && canEdit ? (
        <p className="mt-2 rounded-2xl bg-cream-100 px-3 py-2 text-[11px] leading-relaxed text-ink-700">
          Lengkapi alamat dan kontak agar kop surat pada hasil cetak asesmen
          terisi penuh.
        </p>
      ) : null}
    </div>
  );
}
