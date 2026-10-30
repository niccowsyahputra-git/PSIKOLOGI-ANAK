import { AppContainer, AppHeader, ScrollableContent } from "@/components/app-shell";
import { BottomNavigation, type NavItem } from "@/components/bottom-navigation";
import { LoadingState } from "@/components/ui";
import { requireStaffSession } from "@/lib/authz";
import { ROLE_LABELS } from "@/lib/roles";
import { LogoutButton } from "./logout-button";

/**
 * Navigation is derived from the server-side permission matrix, never from
 * client state. Hidden links are convenience only; every route and API
 * re-authorizes on its own (section 4.2, section 12.4).
 *
 * Four destinations live in the tab bar because that is what fits a phone
 * without shrinking the targets; the rest sit behind the Menu tab.
 */
const TABS: NavItem[] = [
  { href: "/dashboard", label: "Dasbor", icon: "home" },
  { href: "/children", label: "Anak asuh", icon: "child" },
  { href: "/guardians", label: "Wali", icon: "guardian" },
  { href: "/assessments", label: "Hasil", icon: "result" },
];

function moreItems(permissions: readonly string[]): NavItem[] {
  const items: NavItem[] = [
    { href: "/instruments", label: "Instrumen & persetujuan", icon: "instrument" },
  ];
  if (permissions.includes("form.read")) items.push({ href: "/assessment-templates", label: "Template asesmen", icon: "instrument" });
  if (permissions.includes("ai.chat")) items.push({ href: "/chat", label: "Diskusi AI", icon: "chat" });
  if (permissions.includes("admin.users")) items.push({ href: "/admin/users", label: "Pengguna", icon: "staff" });
  if (permissions.includes("admin.general_settings")) items.push({ href: "/admin/general-settings", label: "Profil panti", icon: "building" });
  if (permissions.includes("admin.ai_settings")) items.push({ href: "/admin/ai-settings", label: "Konfigurasi AI", icon: "spark" });
  if (permissions.includes("admin.audit.read")) items.push({ href: "/admin/audit", label: "Audit", icon: "audit" });
  return items;
}

export function ShellFallback() {
  return (
    <AppContainer>
      <ScrollableContent roomy>
        <LoadingState label="Menyiapkan aplikasi…" rows={4} />
      </ScrollableContent>
    </AppContainer>
  );
}

export async function StaffShell({ children }: { children: React.ReactNode }) {
  const session = await requireStaffSession();
  const role = ROLE_LABELS[session.membership.role];

  return (
    <AppContainer>
      <AppHeader
        title="Asesmen Psikososial"
        subtitle={`${session.organization.name} · ${role}`}
        leading={
          <span className="gradient-brand flex h-10 w-10 flex-none items-center justify-center rounded-2xl text-[13px] font-semibold text-white">
            AP
          </span>
        }
        trailing={
          <span className="rounded-full border border-sage-200 bg-sage-50 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-sage-700">
            LOCAL ONLY
          </span>
        }
      />

      <ScrollableContent>{children}</ScrollableContent>

      <BottomNavigation
        tabs={TABS}
        more={moreItems(session.permissions)}
        identity={{
          name: session.user.name,
          role,
          organization: session.organization.name,
          timezone: session.organization.timezone,
          permissions: session.permissions.length,
        }}
        onLogout={<LogoutButton />}
      />
    </AppContainer>
  );
}
