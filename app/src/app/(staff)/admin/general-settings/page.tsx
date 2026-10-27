import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { GeneralSettingsView } from "./general-settings-view";

export const metadata: Metadata = {
  title: "Profil panti",
};

export default function GeneralSettingsPage() {
  return (
    <>
      <PageHeader
        title="Profil panti"
        description="Nama, alamat dan kontak panti yang tampil di dasbor serta kop hasil asesmen yang dicetak."
      />
      <Suspense fallback={<Skeleton rows={6} />}>
        <GeneralSettingsView />
      </Suspense>
    </>
  );
}
