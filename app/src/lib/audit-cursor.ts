/**
 * Opaque cursor used by the audit trail (FR-16). It only carries a timestamp
 * and a row id, so it is safe to place in a URL and needs no signing.
 */
export type AuditCursor = { createdAt: Date; id: string };

export const AUDIT_PAGE_SIZE = 25;
export const AUDIT_MAX_PAGE_SIZE = 100;

export function encodeAuditCursor(row: AuditCursor): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeAuditCursor(raw: string | null | undefined): AuditCursor | undefined {
  if (!raw) return undefined;
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  const [iso, id] = decoded.split("|");
  if (!iso || !id) return undefined;
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime())) return undefined;
  return { createdAt, id };
}

export function parseAuditLimit(raw: string | null | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return AUDIT_PAGE_SIZE;
  return Math.min(parsed, AUDIT_MAX_PAGE_SIZE);
}
