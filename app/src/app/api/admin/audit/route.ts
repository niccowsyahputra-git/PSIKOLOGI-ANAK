import type { NextRequest } from "next/server";
import { jsonOk, withApiHandler } from "@/lib/api";
import {
  decodeAuditCursor,
  encodeAuditCursor,
  parseAuditLimit,
} from "@/lib/audit-cursor";
import { requireStaffSessionForApi } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { PermissionDeniedError } from "@/lib/permissions";
import {
  countAuditLogs,
  listAuditLogs,
} from "@/server/repositories/audit.repository";

function parseSafeMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** FR-16: admin-only, paginated, safe-metadata audit trail. */
export const GET = withApiHandler(async (request: NextRequest) => {
  const context = await requireStaffSessionForApi();
  if (!context.permissions.includes("admin.audit.read")) {
    throw new PermissionDeniedError("admin.audit.read");
  }

  const db = await getDbReady();
  const url = new URL(request.url);
  const limit = parseAuditLimit(url.searchParams.get("limit"));
  const action = url.searchParams.get("action") ?? undefined;
  const entityType = url.searchParams.get("entityType") ?? undefined;
  const cursor = decodeAuditCursor(url.searchParams.get("cursor"));

  const rows = await listAuditLogs(db, {
    organizationId: context.organization.id,
    limit,
    cursor,
    action: action || undefined,
    entityType: entityType || undefined,
  });
  const total = await countAuditLogs(db, context.organization.id);
  const last = rows.at(-1);

  return jsonOk(
    rows.map((row) => ({
      id: row.id,
      actorId: row.actorId,
      actorType: row.actorType,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      metadata: parseSafeMetadata(row.safeMetadata),
      createdAt: row.createdAt.toISOString(),
    })),
    {
      meta: {
        total,
        limit,
        nextCursor: rows.length === limit && last ? encodeAuditCursor(last) : null,
      },
    },
  );
});
