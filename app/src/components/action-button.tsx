"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { api } from "@/lib/client-api";
import { primaryButtonClassName, secondaryButtonClassName } from "./ui";

/** One-click staff mutation that refreshes the server-rendered page on success. */
export function ActionButton({ path, data = {}, children, variant = "primary", confirm, disabled }: { path: string; data?: unknown; children: ReactNode; variant?: "primary" | "secondary"; confirm?: string; disabled?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  async function run() {
    if (confirm && !asking) { setAsking(true); return; }
    setAsking(false); setError("");
    try { await api(path, "POST", data); start(() => router.refresh()); } catch (cause) { setError((cause as Error).message); }
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <span className="inline-flex flex-wrap items-center gap-2">
        <button type="button" onClick={run} disabled={disabled || pending} className={variant === "primary" ? primaryButtonClassName : secondaryButtonClassName}>{asking ? confirm : children}</button>
        {asking ? <button type="button" className="text-sm text-ink-500 underline" onClick={() => setAsking(false)}>Batal</button> : null}
      </span>
      {error ? <span role="alert" className="text-xs text-clay-600">{error}</span> : null}
    </span>
  );
}
