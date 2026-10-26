import type { NextRequest } from "next/server";
import { jsonOk, withApiHandler } from "@/lib/api";
import { requireStaffSessionForApi, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { toStaffWire } from "@/lib/serializers/staff";
import { updateStaffSchema } from "@/lib/validation/staff.schema";
import { updateStaffAccount } from "@/server/services/staff.service";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * Role/activation changes are admin-only, audited, and invalidate the target
 * session. Self-de-escalation and removing the last active admin are refused.
 */
export const PATCH = withApiHandler(async (request: NextRequest, context: RouteParams) => {
  const session = await requireStaffSessionForApi();
  const { id } = await context.params;
  const db = await getDbReady();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ValidationError("Body JSON tidak valid");
  }

  const input = updateStaffSchema.parse(payload);
  const updated = await updateStaffAccount(db, {
    actor: toStaffActor(session),
    membershipId: id,
    input,
  });

  return jsonOk(toStaffWire(updated));
});
