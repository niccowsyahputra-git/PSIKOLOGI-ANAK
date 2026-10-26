import Link from "next/link";
import { Badge, Skeleton } from "@/components/ui";
import { requireStaffSession } from "@/lib/authz";
import { initialsOf } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/roles";
import { LogoutButton } from "./logout-button";

type NavItem = { href: string; label: string; enabled: boolean };

/**
 * Navigation is derived from the server-side permission matrix, never from
 * client state. Hidden links are convenience only; every route and API
 * re-authorizes on its own (section 4.2, section 12.4).
 */
function navItems(canManageUsers: boolean, canReadAudit: boolean): NavItem[] {
  const items: NavItem[] = [
    { href: "/dashboard", label: "Dasbor", enabled: true },
    { href: "/children", label: "Anak asuh", enabled: true },
    { href: "/guardians", label: "Orang tua / wali", enabled: true },
    { href: "/assessments", label: "Hasil asesmen", enabled: true },
    { href: "/instruments", label: "Instrumen & persetujuan", enabled: true },
  ];
  if (canManageUsers) {
    items.push({ href: "/admin/users", label: "Pengguna", enabled: true });
  }
  if (canReadAudit) {
    items.push({ href: "/admin/audit", label: "Audit", enabled: true });
  }
  return items;
}

export function ShellFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 h-10 animate-pulse rounded-xl bg-cream-100" />
      <Skeleton rows={4} />
    </div>
  );
}

export async function StaffShell({ children }: { children: React.ReactNode }) {
  const session = await requireStaffSession();
  const items = navItems(
    session.permissions.includes("admin.users"),
    session.permissions.includes("admin.audit.read"),
  );

  return (
    <div className="flex min-h-full flex-col">
      <header className="no-print sticky top-0 z-10 border-b border-cream-200 bg-cream-50/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sage-600 text-sm font-semibold text-white">
              AP
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-ink-900">
                Asesmen Psikososial
              </p>
              <p className="text-xs text-ink-500">{session.organization.name}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="sage">LOCAL ONLY</Badge>
            <div className="flex items-center gap-2 rounded-xl border border-cream-200 bg-white px-2.5 py-1.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-soft-100 text-xs font-semibold text-sky-soft-600">
                {initialsOf(session.user.name)}
              </span>
              <span className="leading-tight">
                <span className="block text-xs font-medium text-ink-900">
                  {session.user.name}
                </span>
                <span className="block text-[11px] text-ink-500">
                  {ROLE_LABELS[session.membership.role]}
                </span>
              </span>
            </div>
            <LogoutButton />
          </div>
        </div>

        <nav className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:bg-cream-100 hover:text-ink-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>

      <footer className="no-print border-t border-cream-200 py-4">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 text-xs text-ink-500">
          <span>
            Data tersimpan di perangkat ini · zona waktu{" "}
            {session.organization.timezone}
          </span>
          <span>
            Peran: {ROLE_LABELS[session.membership.role]} ·{" "}
            {session.permissions.length} izin aktif
          </span>
        </div>
      </footer>
    </div>
  );
}
