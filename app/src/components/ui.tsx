import type { ReactNode } from "react";

/**
 * Small presentational primitives shared by the staff screens. They are plain
 * server-safe components (no hooks, no client boundary) so pages can stream
 * them in the prerendered shell.
 */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-cream-200 bg-white/80 p-5 shadow-[0_1px_0_0_rgba(43,52,47,0.04)] ${className}`}
    >
      {children}
    </div>
  );
}

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
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-ink-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
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
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-10 animate-pulse rounded-xl border border-cream-200 bg-cream-100/70"
        />
      ))}
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
    <div className="rounded-2xl border border-dashed border-cream-300 bg-cream-50 px-5 py-10 text-center">
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-500">{description}</p>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
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
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink-700">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-clay-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputClassName =
  "w-full rounded-xl border border-cream-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:border-sage-500 focus:outline-none";

export const primaryButtonClassName =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-sage-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sage-700 disabled:cursor-not-allowed disabled:bg-sage-300";

export const secondaryButtonClassName =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-cream-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-cream-100 disabled:cursor-not-allowed disabled:text-ink-300";
