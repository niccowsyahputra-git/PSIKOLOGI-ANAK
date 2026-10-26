import Link from "next/link";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  inputClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from "@/components/ui";
import {
  AUDIT_PAGE_SIZE,
  decodeAuditCursor,
  encodeAuditCursor,
} from "@/lib/audit-cursor";
import { requireStaffSession } from "@/lib/authz";
import { getDbReady } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { listAuditLogs } from "@/server/repositories/audit.repository";

type AuditSearchParams = Promise<{
  action?: string;
  entityType?: string;
  cursor?: string;
}>;

export async function AuditView({ searchParams }: { searchParams: AuditSearchParams }) {
  const session = await requireStaffSession();

  if (!can(session.membership.role, "admin.audit.read")) {
    return (
      <EmptyState
        title="Akses ditolak"
        description="Jejak audit hanya dapat dibaca administrator."
      />
    );
  }

  const params = await searchParams;
  const action = params.action?.trim() || undefined;
  const entityType = params.entityType?.trim() || undefined;
  const cursor = decodeAuditCursor(params.cursor);

  const db = await getDbReady();
  const rows = await listAuditLogs(db, {
    organizationId: session.organization.id,
    limit: AUDIT_PAGE_SIZE,
    cursor,
    action,
    entityType,
  });

  const last = rows.at(-1);
  const nextCursor =
    rows.length === AUDIT_PAGE_SIZE && last ? encodeAuditCursor(last) : null;

  return (
    <div className="space-y-5">
      <Card>
        <form method="get" className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
          <Field label="Aksi" htmlFor="filter-action" hint="Contoh: staff.role_change">
            <input
              id="filter-action"
              name="action"
              defaultValue={action ?? ""}
              className={inputClassName}
              placeholder="semua aksi"
            />
          </Field>
          <Field label="Jenis entitas" htmlFor="filter-entity" hint="Contoh: staff_membership">
            <input
              id="filter-entity"
              name="entityType"
              defaultValue={entityType ?? ""}
              className={inputClassName}
              placeholder="semua entitas"
            />
          </Field>
          <div className="flex items-end gap-2">
            <button type="submit" className={primaryButtonClassName}>
              Terapkan
            </button>
            <Link href="/admin/audit" className={secondaryButtonClassName} prefetch={false}>
              Reset
            </Link>
          </div>
        </form>
      </Card>

      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-500">
        <Badge tone="sky">{rows.length} baris</Badge>
        {action ? <Badge tone="neutral">aksi: {action}</Badge> : null}
        {entityType ? <Badge tone="neutral">entitas: {entityType}</Badge> : null}
        {cursor ? <Badge tone="clay">halaman lanjutan</Badge> : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Tidak ada catatan"
          description="Ubah filter atau lakukan tindakan administratif untuk melihat jejak audit pertama."
        />
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-cream-200 text-left text-xs tracking-wide text-ink-500 uppercase">
                  <th className="px-4 py-3 font-medium">Waktu</th>
                  <th className="px-4 py-3 font-medium">Aksi</th>
                  <th className="px-4 py-3 font-medium">Entitas</th>
                  <th className="px-4 py-3 font-medium">Aktor</th>
                  <th className="px-4 py-3 font-medium">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-cream-200 last:border-0 align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-ink-500">
                      {formatDateTime(row.createdAt, session.organization.timezone)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-900">
                      {row.action}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-700">
                      <span className="font-mono">{row.entityType}</span>
                      {row.entityId ? (
                        <span className="block text-ink-300">
                          {row.entityId.slice(0, 8)}…
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-700">
                      {row.actorType}
                      {row.actorId ? (
                        <span className="block text-ink-300">
                          {row.actorId.slice(0, 8)}…
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] break-all text-ink-500">
                      {row.safeMetadata}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-500">
          Halaman ini menampilkan maksimal {AUDIT_PAGE_SIZE} catatan terbaru.
        </p>
        {nextCursor ? (
          <Link
            href={{
              pathname: "/admin/audit",
              query: {
                ...(action ? { action } : {}),
                ...(entityType ? { entityType } : {}),
                cursor: nextCursor,
              },
            }}
            prefetch={false}
            className={secondaryButtonClassName}
          >
            Halaman berikutnya
          </Link>
        ) : (
          <span className="text-xs text-ink-300">
            {cursor ? "Tidak ada catatan lebih lanjut" : "Akhir daftar"}
          </span>
        )}
      </div>
    </div>
  );
}
