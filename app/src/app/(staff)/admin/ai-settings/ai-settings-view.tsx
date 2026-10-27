import { EmptyState } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { can } from "@/lib/permissions";
import { getAiSettings } from "@/server/services/settings.service";
import { AiSettingsForm } from "./ai-settings-form";

/** Server component; `getAiSettings` asserts `admin.ai_settings` on its own. */
export async function AiSettingsView() {
  const session = await requireStaffSession();

  if (!can(session.membership.role, "admin.ai_settings")) {
    return (
      <EmptyState
        title="Akses ditolak"
        description="Hanya administrator yang dapat mengubah konfigurasi AI."
      />
    );
  }

  const db = await getDbReady();
  const settings = await getAiSettings(db, { actor: toStaffActor(session) });

  return (
    <AiSettingsForm initial={settings} timezone={session.organization.timezone} />
  );
}
