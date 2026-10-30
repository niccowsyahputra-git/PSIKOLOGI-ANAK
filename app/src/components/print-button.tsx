"use client";

import { secondaryButtonClassName } from "./ui";

/**
 * Printing runs entirely in the browser (FR-14): no server round trip and no
 * generated file, so nothing leaves the laptop. The button itself is excluded
 * from the printed page.
 */
export function PrintButton({ label = "Cetak" }: { label?: string }) {
  return (
    <button
      type="button"
      className={`no-print ${secondaryButtonClassName}`}
      onClick={() => window.print()}
    >
      {label}
    </button>
  );
}
