import { assertMutationOrigin, jsonOk, withApiHandler } from "@/lib/api";
import { requireStaffSessionForApi, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { ValidationError } from "@/lib/errors";
import { aiSettingsUpdateSchema } from "@/lib/validation/settings.schema";
import { getAiSettings, updateAiSettings } from "@/server/services/settings.service";

/**
 * FR-10 / SCR-11. GET returns masked metadata only; PUT preserves an omitted
 * key, replaces a supplied one and clears it only on `clearApiKey=true`
 * (PRD section 10.2).
 */
export const GET = withApiHandler(async () => {
  const context = await requireStaffSessionForApi();
  const db = await getDbReady();
  const settings = await getAiSettings(db, { actor: toStaffActor(context) });
  return jsonOk(settings);
});

export const PUT = withApiHandler(async (request) => {
  const context = await requireStaffSessionForApi();
  const env = getEnv();
  assertMutationOrigin(request, [env.appBaseUrl, env.betterAuthUrl]);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ValidationError("Body JSON tidak valid");
  }

  const input = aiSettingsUpdateSchema.parse(payload);
  const db = await getDbReady();
  const settings = await updateAiSettings(db, {
    actor: toStaffActor(context),
    input,
  });
  return jsonOk(settings);
});
