import { jsonOk, withApiHandler } from "@/lib/api";
import { requireStaffSessionForApi, toStaffActor } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { toStaffWire } from "@/lib/serializers/staff";
import { createStaffSchema } from "@/lib/validation/staff.schema";
import {
  createStaffAccount,
  listStaffForAdmin,
} from "@/server/services/staff.service";

/** FR-01: admin-only staff account listing (role always server-derived). */
export const GET = withApiHandler(async () => {
  const context = await requireStaffSessionForApi();
  const db = await getDbReady();
  const rows = await listStaffForAdmin(db, { actor: toStaffActor(context) });
  return jsonOk(rows.map(toStaffWire));
});

export const POST = withApiHandler(async (request) => {
  const context = await requireStaffSessionForApi();
  const db = await getDbReady();

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new ValidationError("Body JSON tidak valid");
  }

  const input = createStaffSchema.parse(payload);
  const result = await createStaffAccount(db, {
    actor: toStaffActor(context),
    input,
  });

  return jsonOk(result, { status: 201 });
});
