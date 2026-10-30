"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AuditIcon,
  BuildingIcon,
  ChatIcon,
  ChildIcon,
  CloseIcon,
  GuardianIcon,
  HomeIcon,
  InstrumentIcon,
  LogoutIcon,
  MenuIcon,
  ResultIcon,
  SparkIcon,
  StaffIcon,
  type IconProps,
} from "@/components/icons";

/**
 * Bottom tab bar plus the overflow sheet behind the last tab. Navigation data
 * arrives as plain values from the server (icons are resolved here by key),
 * because the server decides which destinations a role may even see — the
 * matrix is never evaluated in the browser.
 */
export type NavIconKey =
  | "home"
  | "child"
  | "guardian"
  | "result"
  | "instrument"
  | "chat"
  | "staff"
  | "building"
  | "spark"
  | "audit";

export type NavItem = { href: string; label: string; icon: NavIconKey };

const ICONS: Record<NavIconKey, (props: IconProps) => React.ReactElement> = {
  home: HomeIcon,
  child: ChildIcon,
  guardian: GuardianIcon,
  result: ResultIcon,
  instrument: InstrumentIcon,
  chat: ChatIcon,
  staff: StaffIcon,
  building: BuildingIcon,
  spark: SparkIcon,
  audit: AuditIcon,
};

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNavigation({
  tabs,
  more,
  identity,
  onLogout,
}: {
  tabs: NavItem[];
  more: NavItem[];
  identity: { name: string; role: string; organization: string; timezone: string; permissions: number };
  onLogout: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  // The sheet remembers the route it was opened on and is derived as closed
  // anywhere else, so a navigation or a back gesture never reveals stale chrome
  // and no effect has to reset the state.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const setOpen = (next: boolean) => setOpenedOn(next ? pathname : null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenedOn(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const moreActive = more.some((item) => isActive(pathname, item.href));

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Tutup menu"
          onClick={() => setOpen(false)}
          className="absolute inset-0 z-40 cursor-default bg-ink-900/25 backdrop-blur-[2px]"
        />
      ) : null}

      {/* The sheet is docked directly above the tab bar instead of over it, so
          the session row at its foot can never hide behind the bar. */}
      <div className="no-print relative z-50 flex-none">
        {open ? (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu aplikasi"
            className="sheet-up absolute inset-x-0 bottom-full max-h-[70dvh] overflow-y-auto rounded-t-3xl border-t border-cream-200 bg-white px-4 pt-3 pb-4"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-cream-300" />
            <div className="mb-3 flex items-center gap-3">
              <span className="gradient-brand flex h-11 w-11 flex-none items-center justify-center rounded-2xl text-sm font-semibold text-white">
                {identity.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-semibold text-ink-900">{identity.name}</span>
                <span className="block truncate text-xs text-ink-500">{identity.role} · {identity.organization}</span>
              </span>
              <button
                type="button"
                aria-label="Tutup menu"
                onClick={() => setOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cream-200 text-ink-500 active:bg-cream-100"
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <ul className="space-y-1.5">
              {more.map((item) => {
                const Glyph = ICONS[item.icon];
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      prefetch={false}
                      onClick={() => setOpen(false)}
                      className={`flex min-h-[52px] items-center gap-3 rounded-2xl px-3 text-sm font-medium transition-colors ${active ? "bg-sage-100 text-sage-700" : "bg-cream-50 text-ink-700 active:bg-cream-100"}`}
                    >
                      <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${active ? "bg-white text-sage-600" : "bg-white text-ink-500"}`}>
                        <Glyph size={20} />
                      </span>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="mt-3 rounded-2xl bg-cream-50 px-3 py-2.5 text-[11px] leading-relaxed text-ink-500">
              Data tersimpan di perangkat ini · zona waktu {identity.timezone} · {identity.permissions} izin aktif
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs text-ink-500">
                <LogoutIcon size={16} /> Akhiri sesi staf
              </span>
              {onLogout}
            </div>
          </div>
        ) : null}

        <nav aria-label="Navigasi utama" className="app-nav">
          <ul className="flex items-stretch">
            {tabs.map((item) => {
              const Glyph = ICONS[item.icon];
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    prefetch={false}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 pt-1.5 pb-1 text-[10px] font-medium transition-colors ${active ? "text-sage-600" : "text-ink-500"}`}
                  >
                    <span className={`flex h-8 w-12 items-center justify-center rounded-xl transition-colors ${active ? "bg-sage-100" : ""}`}>
                      <Glyph size={20} />
                    </span>
                    <span className="max-w-full truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
            {more.length > 0 ? (
              <li className="flex-1">
                <button
                  type="button"
                  onClick={() => setOpen(!open)}
                  aria-expanded={open}
                  aria-haspopup="dialog"
                  className={`flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 px-1 pt-1.5 pb-1 text-[10px] font-medium transition-colors ${open || moreActive ? "text-sage-600" : "text-ink-500"}`}
                >
                  <span className={`flex h-8 w-12 items-center justify-center rounded-xl transition-colors ${open || moreActive ? "bg-sage-100" : ""}`}>
                    <MenuIcon size={20} />
                  </span>
                  <span>Menu</span>
                </button>
              </li>
            ) : null}
          </ul>
        </nav>
      </div>
    </>
  );
}
