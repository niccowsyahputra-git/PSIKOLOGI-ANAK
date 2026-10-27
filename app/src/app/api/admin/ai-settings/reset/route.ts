import { assertMutationOrigin, jsonOk, withApiHandler } from "@/lib/api";
import { requireStaffSessionForApi, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { resetAiSettings } from "@/server/services/settings.service";

/**
 * FR-10: the reset switches AI off and clears the non-secret configuration.
 * The encrypted key survives unless the admin confirms `clearApiKey=true`.
 */
export const POST = withApiHandler(async (request) => {
  const context = await requireStaffSessionForApi();
  const env = getEnv();
  assertMutationOrigin(request, [env.appBaseUrl, env.betterAuthUrl]);

  const payload: unknown = await request.json().catch(() => ({}));
  const clearApiKey =
    typeof payload === "object" &&
    payload !== null &&
    (payload as { clearApiKey?: unknown }).clearApiKey === true;

  const db = await getDbReady();
  const settings = await resetAiSettings(db, {
    actor: toStaffActor(context),
    clearApiKey,
  });
  return jsonOk(settings);
});
