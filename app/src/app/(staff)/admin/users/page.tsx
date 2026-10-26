import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { UsersView } from "./users-view";

export const metadata: Metadata = {
  title: "Pengguna",
};

export default function AdminUsersPage() {
  return (
    <>
      <PageHeader
        title="Pengguna"
        description="Kelola akun staf, peran, status aktif dan verifikasi kredensial psikolog."
      />
      <Suspense fallback={<Skeleton rows={5} />}>
        <UsersView />
      </Suspense>
    </>
  );
}
