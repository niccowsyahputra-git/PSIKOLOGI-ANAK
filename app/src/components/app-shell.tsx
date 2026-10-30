import type { ReactNode } from "react";

/**
 * The application shell. Composition is fixed on purpose: a compact header, one
 * scrolling column, and a bottom bar that never moves. The same composition is
 * used on a 320px phone and on a 1440px desktop — the desktop only adds the
 * neutral canvas around it, never extra columns.
 */
export function AppContainer({ children }: { children: ReactNode }) {
  return (
    <div className="app-canvas">
      <div className="app-shell">{children}</div>
    </div>
  );
}

export function AppHeader({
  title,
  subtitle,
  leading,
  trailing,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <header className="app-header no-print">
      <div className="flex items-center gap-3 px-4 py-2.5">
        {leading}
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[15px] font-semibold text-ink-900">{title}</p>
          {subtitle ? <p className="truncate text-[11px] text-ink-500">{subtitle}</p> : null}
        </div>
        {trailing ? <div className="flex flex-none items-center gap-1.5">{trailing}</div> : null}
      </div>
    </header>
  );
}

/** The only scrolling region in the app, so the chrome stays put on scroll. */
export function ScrollableContent({
  children,
  roomy = false,
}: {
  children: ReactNode;
  roomy?: boolean;
}) {
  return (
    <main className={`app-scroll${roomy ? " app-scroll--roomy" : ""}`}>{children}</main>
  );
}

/**
 * A 44px-minimum tap target. Icon-only controls always carry a label for
 * screen readers, since the glyph alone is not a name.
 */
export function IconButton({
  label,
  children,
  tone = "plain",
  ...props
}: {
  label: string;
  children: ReactNode;
  tone?: "plain" | "brand";
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  const tones = {
    plain: "bg-white/80 text-ink-700 border border-cream-200 active:bg-cream-100",
    brand: "gradient-brand text-white shadow-float active:opacity-90",
  } as const;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl transition-[opacity,background-color] disabled:opacity-50 ${tones[tone]}`}
      {...props}
    >
      {children}
    </button>
  );
}
