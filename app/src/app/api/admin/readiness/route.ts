import { jsonOk, withApiHandler } from "@/lib/api";
import { requireStaffSessionForApi, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { getReadiness } from "@/server/services/settings.service";

/**
 * FR-17: operational readiness only. It never approves clinical use; the real
 * gate stays with the approved instrument, authority basis and privacy SOP.
 */
export const GET = withApiHandler(async () => {
  const context = await requireStaffSessionForApi();
  const db = await getDbReady();
  const readiness = await getReadiness(db, { actor: toStaffActor(context) });
  return jsonOk(readiness);
});
