import { EmptyState } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { can } from "@/lib/permissions";
import { toStaffWire } from "@/lib/serializers/staff";
import { listStaffForAdmin } from "@/server/services/staff.service";
import { StaffAdminPanel } from "./staff-admin-panel";

/**
 * Server component: the staff list is read through the service, which asserts
 * the `admin.users` capability itself. The UI check below only decides what to
 * render for a non-admin, never whether data may leave the server.
 */
export async function UsersView() {
  const session = await requireStaffSession();

  if (!can(session.membership.role, "admin.users")) {
    return (
      <EmptyState
        title="Akses ditolak"
        description="Hanya administrator yang dapat mengelola akun staf. Hubungi administrator panti bila Anda memerlukan perubahan akses."
      />
    );
  }

  const db = await getDbReady();
  const rows = await listStaffForAdmin(db, { actor: toStaffActor(session) });

  return (
    <StaffAdminPanel
      initialRows={rows.map(toStaffWire)}
      actorMembershipId={session.membership.id}
      timezone={session.organization.timezone}
    />
  );
}
