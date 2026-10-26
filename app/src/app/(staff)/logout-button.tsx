"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Ends the local session, then returns to the login screen (section 12.4). */
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    try {
      await fetch("/api/session/logout", { method: "POST" });
    } catch {
      // A failed request must still drop the user back to the login screen.
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="rounded-xl border border-cream-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:bg-cream-100 disabled:text-ink-300"
    >
      {pending ? "Keluar…" : "Keluar"}
    </button>
  );
}
