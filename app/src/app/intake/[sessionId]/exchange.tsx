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

  if (!error) return <p className="py-20 text-center text-lg text-ink-500">Menyiapkan sesi…</p>;
  return (
    <section className="rounded-3xl bg-white p-8 text-center shadow-sm sm:p-12">
      <h1 className="text-2xl font-semibold text-ink-900">Sesi tidak dapat dibuka</h1>
      <p className="mx-auto mt-3 max-w-md text-ink-700">{error} Minta pendamping membuat tautan sesi baru dari aplikasi staf.</p>
      <div className="mt-6 flex justify-center"><Link href="/" className={secondaryButtonClassName}>Ke halaman awal</Link></div>
    </section>
  );
}
