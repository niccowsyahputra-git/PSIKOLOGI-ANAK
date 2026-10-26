import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader, Skeleton, primaryButtonClassName } from "@/components/ui";
import { ProfileList, type ProfileSearchParams } from "@/components/profile-list";

export const metadata: Metadata = { title: "Anak asuh" };

export default function ChildrenPage({ searchParams }: { searchParams: ProfileSearchParams }) {
  return (
    <>
      <PageHeader
        title="Anak asuh"
        description="Profil anak, siklus asesmen, dan riwayat jawaban. Instrumen dipilih otomatis dari usia saat siklus dimulai."
        actions={<Link href="/children/new" className={primaryButtonClassName}>Daftarkan anak</Link>}
      />
      <Suspense fallback={<Skeleton rows={6} />}>
        <ProfileList kind="children" searchParams={searchParams} />
      </Suspense>
    </>
  );
}
