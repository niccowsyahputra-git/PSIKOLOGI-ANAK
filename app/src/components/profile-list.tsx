import Link from "next/link";
import { Badge, Card, EmptyState, inputClassName, secondaryButtonClassName } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { formatDate } from "@/lib/format";
import { listProfiles } from "@/server/services/assessment.service";

export type ProfileSearchParams = Promise<{ q?: string | string[]; page?: string | string[] }>;

const STATE_LABELS = { draft: "Draft", verified: "Terverifikasi", archived: "Diarsipkan" } as const;

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/** Shared paginated list (25 per page, FR-09) for children and guardians. */
export async function ProfileList({ kind, searchParams }: { kind: "children" | "guardians"; searchParams: ProfileSearchParams }) {
  const session = await requireStaffSession();
  const params = await searchParams;
  const q = single(params.q).slice(0, 100);
  const page = Math.max(1, Math.min(10000, Number.parseInt(single(params.page), 10) || 1));
  const { rows, total } = await listProfiles(toStaffActor(session), kind, q, page);
  const pages = Math.max(1, Math.ceil(total / 25));
  const base = kind === "children" ? "/children" : "/guardians";
  const pageHref = (target: number) => `${base}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(target) })}`;

  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Cari nama atau kode" className={`${inputClassName} max-w-sm`} aria-label="Cari profil" />
        <button className={secondaryButtonClassName} type="submit">Cari</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          title={q ? "Tidak ada profil yang cocok" : kind === "children" ? "Belum ada anak asuh terdaftar" : "Belum ada orang tua / wali terdaftar"}
          description={kind === "children" ? "Daftarkan anak terlebih dahulu, lalu hubungkan orang tua / wali dari halaman profil anak." : "Wali ditambahkan dari halaman profil anak agar setiap asesmen wali selalu memiliki konteks anak."}
        >
          {kind === "children" ? <Link href="/children/new" className="text-sm font-medium text-sage-700 underline">Daftarkan anak</Link> : null}
        </EmptyState>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-cream-200">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`${base}/${row.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-cream-50">
                  <span>
                    <span className="block font-medium text-ink-900">{row.name}</span>
                    <span className="font-mono text-xs text-ink-500">{row.code}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                    {row.fictional ? <Badge tone="clay">Fiktif</Badge> : null}
                    <Badge tone={row.profileState === "verified" ? "sage" : "neutral"}>{STATE_LABELS[row.profileState]}</Badge>
                    Dibuat {formatDate(row.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="flex items-center justify-between text-sm text-ink-500">
        <span>{total} profil · halaman {page} dari {pages}</span>
        <span className="flex gap-2">
          {page > 1 ? <Link className={secondaryButtonClassName} href={pageHref(page - 1)}>Sebelumnya</Link> : null}
          {page < pages ? <Link className={secondaryButtonClassName} href={pageHref(page + 1)}>Berikutnya</Link> : null}
        </span>
      </div>
    </div>
  );
}
