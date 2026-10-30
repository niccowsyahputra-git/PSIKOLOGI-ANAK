"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { secondaryButtonClassName } from "@/components/ui";
import { api } from "@/lib/client-api";

/**
 * The single-use token travels in the URL fragment (never sent to the server
 * in logs or Referer). It is stripped from history before the exchange.
 */
export function Exchange({ sessionId }: { sessionId: string }) {
  const started = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", window.location.pathname);
    const attempt = token ? api("/api/intake/exchange", "POST", { sessionId, token }) : Promise.reject(new Error("missing"));
    attempt
      .then(() => window.location.replace("/intake"))
      .catch(() => setError(token ? "Tautan ini sudah dipakai, dicabut, atau kedaluwarsa." : "Tautan sesi tidak lengkap."));
  }, [sessionId]);

  if (!error) return <p className="py-20 text-center text-[15px] text-ink-500" role="status">Menyiapkan sesi…</p>;
  return (
    <section className="shadow-card rounded-3xl bg-white p-6 text-center">
      <h1 className="text-xl font-semibold text-ink-900">Sesi tidak dapat dibuka</h1>
      <p className="mt-2.5 text-[13px] leading-relaxed text-ink-700">{error} Minta pendamping membuat tautan sesi baru dari aplikasi staf.</p>
      <Link href="/" className={`${secondaryButtonClassName} mt-5 w-full`}>Ke halaman awal</Link>
    </section>
  );
}
