import { assertMutationOrigin, jsonOk, withApiHandler } from "@/lib/api";
import { requireStaffSessionForApi, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { testAiSettings } from "@/server/services/settings.service";

/**
 * FR-10: tests the saved configuration with a synthetic fictional prompt and
 * binds the result to the configuration fingerprint. Mock mode never performs
 * an outbound request.
 */
export const POST = withApiHandler(async (request) => {
  const context = await requireStaffSessionForApi();
  const env = getEnv();
  assertMutationOrigin(request, [env.appBaseUrl, env.betterAuthUrl]);

  const db = await getDbReady();
  const result = await testAiSettings(db, { actor: toStaffActor(context) });
  return jsonOk(result);
});
