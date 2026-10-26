import { jsonOk, withApiHandler } from "@/lib/api";
import { requireStaffSessionForApi } from "@/lib/authz";

/**
 * Server-derived identity and permissions (FR-01). The response never contains
 * credentials or secrets, and the client cannot influence the role.
 */
export const GET = withApiHandler(async () => {
  const context = await requireStaffSessionForApi();
  return jsonOk({
    user: context.user,
    membership: {
      id: context.membership.id,
      role: context.membership.role,
      credentialVerifiedAt: context.membership.credentialVerifiedAt,
    },
    organization: context.organization,
    permissions: context.permissions,
  });
});
