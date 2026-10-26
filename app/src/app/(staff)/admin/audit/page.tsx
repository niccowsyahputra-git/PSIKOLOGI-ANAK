import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { AuditView } from "./audit-view";

export const metadata: Metadata = {
  title: "Audit",
};

export default function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entityType?: string; cursor?: string }>;
}) {
  return (
    <>
      <PageHeader
        title="Jejak audit"
        description="Catatan tindakan penting pada organisasi ini. Metadata dibatasi pada id, peran dan status; isi asesmen tidak pernah masuk ke audit."
      />
      <Suspense fallback={<Skeleton rows={8} />}>
        <AuditView searchParams={searchParams} />
      </Suspense>
    </>
  );
}
