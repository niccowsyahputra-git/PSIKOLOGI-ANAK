import { assertMutationOrigin, jsonOk, withApiHandler } from "@/lib/api";
import { requireStaffSessionForApi, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { ValidationError } from "@/lib/errors";
import { generalSettingsSchema } from "@/lib/validation/settings.schema";
import {
  getOrganizationProfile,
  updateOrganizationProfileSettings,
} from "@/server/services/settings.service";

/** FR-17 / SCR-13: panti letterhead and operational identity, admin only. */
export const GET = withApiHandler(async () => {
  const context = await requireStaffSessionForApi();
  const db = await getDbReady();
  const profile = await getOrganizationProfile(db, { actor: toStaffActor(context) });
  return jsonOk(profile);
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

  const input = generalSettingsSchema.parse(payload);
  const db = await getDbReady();
  const profile = await updateOrganizationProfileSettings(db, {
    actor: toStaffActor(context),
    input,
  });
  return jsonOk(profile);
});
