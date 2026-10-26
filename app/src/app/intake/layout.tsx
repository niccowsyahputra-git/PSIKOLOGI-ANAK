import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Sesi pengisian",
  robots: { index: false, follow: false },
};

/** Participant shell: no staff navigation, no names, nothing outside the active session. */
export default function IntakeLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 justify-center bg-cream-50 px-4 py-6 sm:py-10">
      <div className="w-full max-w-3xl">{children}</div>
    </main>
  );
}
