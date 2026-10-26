import { jsonOk, withApiHandler } from "@/lib/api";
import { getAuth } from "@/lib/auth";
import { getStaffSession } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { recordAudit } from "@/server/services/audit.service";

/** Ends the staff session and clears the Better Auth cookie (FR-01, FR-05). */
export const POST = withApiHandler(async (request) => {
  const context = await getStaffSession();
  const auth = getAuth();

  if (context) {
    const db = await getDbReady();
    await recordAudit(db, {
      organizationId: context.organization.id,
      actor: { type: "staff", membershipId: context.membership.id },
      action: "auth.logout",
      entityType: "session",
      entityId: null,
      metadata: { role: context.membership.role },
    });
  }

  await auth.api.signOut({ headers: request.headers }).catch(() => undefined);
  return jsonOk({ signedOut: true });
});
