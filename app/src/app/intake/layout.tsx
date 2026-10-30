import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppContainer, ScrollableContent } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Sesi pengisian",
  robots: { index: false, follow: false },
};

/**
 * Participant shell: no staff navigation, no bottom tabs, no names, nothing
 * outside the active session. The participant only ever sees one screen at a
 * time, so the shell is the app frame and a single scrolling column.
 */
export default function IntakeLayout({ children }: { children: ReactNode }) {
  return (
    <AppContainer>
      <ScrollableContent roomy>{children}</ScrollableContent>
    </AppContainer>
  );
}
