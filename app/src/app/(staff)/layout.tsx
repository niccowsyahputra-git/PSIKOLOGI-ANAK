import { Suspense } from "react";
import { ShellFallback, StaffShell } from "./staff-shell";

/**
 * Cache Components requires request data (session) to sit behind a Suspense
 * boundary. The shell is the only authenticated chrome in the app; every page
 * still re-authorizes on its own before touching data.
 */
export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <StaffShell>{children}</StaffShell>
    </Suspense>
  );
}
