import { Badge, Card, EmptyState } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getOrganizationProfile, getReadiness } from "@/server/services/settings.service";
import { ProfileForm } from "./profile-form";

/**
 * Server component: the service asserts `admin.general_settings` itself, so the
 * UI check below only decides what a non-admin sees.
 */
export async function GeneralSettingsView() {
  const session = await requireStaffSession();

  if (!can(session.membership.role, "admin.general_settings")) {
    return (
      <EmptyState
        title="Akses ditolak"
        description="Hanya administrator yang dapat mengubah profil panti. Hubungi administrator panti bila data kop perlu diperbarui."
      />
    );
  }

  const db = await getDbReady();
  const actor = toStaffActor(session);
  const profile = await getOrganizationProfile(db, { actor });
  const readiness = await getReadiness(db, { actor });

  return (
    <div className="space-y-6">
      <ProfileForm initial={profile} />

      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-900">Kesiapan instalasi</h2>
          <Badge tone={readiness.liveIntakeEnabled ? "clay" : "sage"}>
            {readiness.liveIntakeEnabled
              ? "Pengisian data nyata aktif"
              : "Mode demonstrasi fiktif"}
          </Badge>
        </div>
        <ul className="space-y-2 text-sm">
          {readiness.checks.map((check) => (
            <li
              key={check.key}
              className="flex flex-col gap-1 rounded-xl bg-cream-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="font-medium text-ink-900">{check.label}</span>
              <span className="flex items-center gap-2 text-ink-500">
                <span className="sm:text-right">{check.detail}</span>
                <Badge tone={check.status === "ok" ? "sage" : "clay"}>
                  {check.status === "ok" ? "Siap" : "Perlu dilengkapi"}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-500">
          Daftar ini hanya status operasional. Penggunaan data nyata tetap bergantung pada
          instrumen yang disetujui, dasar kewenangan dan SOP privasi panti — bukan pada
          kelengkapan kop.
        </p>
      </Card>
    </div>
  );
}
