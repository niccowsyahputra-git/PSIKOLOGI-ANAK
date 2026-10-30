import Link from "next/link";
import type { ReactNode } from "react";
import { AlertIcon, ChevronRightIcon, InfoIcon } from "@/components/icons";

/**
 * Presentational primitives for the mobile app shell. They are plain
 * server-safe components (no hooks, no client boundary) so pages can stream
 * them in the prerendered shell. Sizing is tuned for one narrow column:
 * compact type, 44px minimum tap targets, generous rounding.
 */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`shadow-card rounded-3xl border border-white/80 bg-white p-4 ${className}`}>
      {children}
    </div>
  );
}

/** In-page title block. Screen titles live in the header, so this stays small. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4">
      <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-ink-900">{title}</h1>
      {description ? <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">{description}</p> : null}
      {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

type BadgeTone = "sage" | "sky" | "clay" | "neutral";

const BADGE_TONES: Record<BadgeTone, string> = {
  sage: "bg-sage-100 text-sage-700 border-sage-200",
  sky: "bg-sky-soft-100 text-sky-soft-600 border-sky-soft-200",
  clay: "bg-clay-100 text-clay-600 border-clay-100",
  neutral: "bg-cream-100 text-ink-700 border-cream-200",
};

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * A badge with a dot, used where the value is a workflow state rather than a
 * free label. Tones are deliberately calm: nothing in this app is a red alarm.
 */
export function StatusBadge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  const dots: Record<BadgeTone, string> = {
    sage: "bg-sage-600",
    sky: "bg-sky-soft-500",
    clay: "bg-clay-500",
    neutral: "bg-ink-300",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${BADGE_TONES[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} aria-hidden="true" />
      {children}
    </span>
  );
}

/** Compact metric tile, designed to sit two-up inside a 390px column. */
export function SummaryCard({
  label,
  value,
  hint,
  tone = "plain",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "plain" | "brand";
}) {
  if (tone === "brand") {
    return (
      <div className="gradient-brand shadow-float rounded-3xl p-4 text-white">
        <p className="text-[11px] font-medium tracking-wide text-white/80 uppercase">{label}</p>
        <p className="mt-1.5 text-3xl leading-none font-semibold">{value}</p>
        {hint ? <p className="mt-1.5 text-[11px] text-white/80">{hint}</p> : null}
      </div>
    );
  }
  return (
    <div className="shadow-card rounded-3xl border border-white/80 bg-white p-4">
      <p className="text-[11px] font-medium tracking-wide text-ink-500 uppercase">{label}</p>
      <p className="mt-1.5 text-3xl leading-none font-semibold text-ink-900">{value}</p>
      {hint ? <p className="mt-1.5 text-[11px] text-ink-500">{hint}</p> : null}
    </div>
  );
}

/** Tappable row-card: the main way to move between screens in this app. */
export function FeatureCard({
  href,
  title,
  description,
  icon,
  trailing,
  tone = "white",
}: {
  href: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  tone?: "white" | "violet" | "blue";
}) {
  const tones = {
    white: "bg-white border-white/80",
    violet: "bg-sage-50 border-sage-100",
    blue: "bg-sky-soft-50 border-sky-soft-100",
  } as const;
  return (
    <Link
      href={href}
      prefetch={false}
      className={`shadow-card flex min-h-[64px] items-center gap-3 rounded-3xl border p-3.5 transition-colors active:bg-cream-100 ${tones[tone]}`}
    >
      {icon ? (
        <span className="gradient-brand flex h-11 w-11 flex-none items-center justify-center rounded-2xl text-white">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink-900">{title}</span>
        {description ? <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">{description}</span> : null}
      </span>
      {trailing ?? <ChevronRightIcon size={18} className="flex-none text-ink-300" />}
    </Link>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-14 animate-pulse rounded-3xl border border-white/70 bg-white/70"
        />
      ))}
    </div>
  );
}

/** Pending screen state with an accessible announcement, not just a shimmer. */
export function LoadingState({ label = "Memuat…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-3">
      <p role="status" className="flex items-center gap-2 text-[13px] text-ink-500">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sage-200 border-t-sage-600" aria-hidden="true" />
        {label}
      </p>
      <Skeleton rows={rows} />
    </div>
  );
}

export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-cream-300 bg-white/60 px-5 py-9 text-center">
      <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-sage-50 text-sage-600">
        <InfoIcon size={22} />
      </span>
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      {description ? <p className="mx-auto mt-1.5 text-[13px] leading-relaxed text-ink-500">{description}</p> : null}
      {children ? <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}

/** Refusals and failures. The message is shown as given; it is already safe. */
export function ErrorState({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div role="alert" className="rounded-3xl border border-clay-100 bg-clay-100/50 px-5 py-6 text-center">
      <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-clay-600">
        <AlertIcon size={22} />
      </span>
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      {description ? <p className="mx-auto mt-1.5 text-[13px] leading-relaxed text-ink-700">{description}</p> : null}
      {children ? <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink-700">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-clay-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] leading-relaxed text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

/* Controls keep a 44px touch height; 16px text stops iOS from zooming on focus. */
export const inputClassName =
  "w-full min-h-[44px] rounded-2xl border border-cream-200 bg-white px-3.5 py-2.5 text-base text-ink-900 placeholder:text-ink-300 focus:border-sage-500 focus:outline-none";

export const primaryButtonClassName =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl gradient-brand px-4 py-2.5 text-sm font-semibold text-white shadow-float transition-opacity active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryButtonClassName =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl border border-cream-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 transition-colors active:bg-cream-100 disabled:cursor-not-allowed disabled:text-ink-300";
