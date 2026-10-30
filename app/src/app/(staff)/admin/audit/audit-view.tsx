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
        <form method="get" className="grid gap-4">
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
          <div className="flex gap-2">
            <button type="submit" className={`${primaryButtonClassName} flex-1`}>
              Terapkan
            </button>
            <Link href="/admin/audit" className={secondaryButtonClassName} prefetch={false}>
              Reset
            </Link>
          </div>
        </form>
      </Card>

      <div className="flex flex-wrap items-center gap-1.5">
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
        <Card className="p-1.5">
          {/* A table would need horizontal scrolling in one phone column, so each
              entry is a stacked record instead. */}
          <ul className="space-y-1">
            {rows.map((row) => (
              <li key={row.id} className="rounded-2xl bg-cream-50 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate font-mono text-[12px] font-medium text-ink-900">
                    {row.action}
                  </p>
                  <p className="flex-none text-[10px] text-ink-500">
                    {formatDateTime(row.createdAt, session.organization.timezone)}
                  </p>
                </div>
                <p className="mt-1 text-[11px] text-ink-700">
                  <span className="font-mono">{row.entityType}</span>
                  {row.entityId ? <span className="text-ink-300"> · {row.entityId.slice(0, 8)}…</span> : null}
                  <span className="text-ink-500"> · oleh {row.actorType}</span>
                  {row.actorId ? <span className="text-ink-300"> {row.actorId.slice(0, 8)}…</span> : null}
                </p>
                <p className="mt-1 font-mono text-[10px] break-all text-ink-500">{row.safeMetadata}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-col gap-2 pb-2">
        <p className="text-[11px] leading-relaxed text-ink-500">
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
            className={`${secondaryButtonClassName} w-full`}
          >
            Halaman berikutnya
          </Link>
        ) : (
          <span className="text-[11px] text-ink-300">
            {cursor ? "Tidak ada catatan lebih lanjut" : "Akhir daftar"}
          </span>
        )}
      </div>
    </div>
  );
}
