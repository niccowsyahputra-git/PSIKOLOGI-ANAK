import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { ProfileList, type ProfileSearchParams } from "@/components/profile-list";

export const metadata: Metadata = { title: "Orang tua / wali" };

export default function GuardiansPage({ searchParams }: { searchParams: ProfileSearchParams }) {
  return (
    <>
      <PageHeader
        title="Orang tua / wali"
        description="Setiap asesmen wali terikat pada satu anak dan satu siklus. Tambahkan wali dari halaman profil anak."
      />
      <Suspense fallback={<Skeleton rows={6} />}>
        <ProfileList kind="guardians" searchParams={searchParams} />
      </Suspense>
    </>
  );
}
