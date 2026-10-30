import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingState, PageHeader } from "@/components/ui";
import { requireStaffSession } from "@/lib/authz";
import { getEnv } from "@/lib/env";
import { ChildForm } from "./child-form";

export const metadata: Metadata = { title: "Daftarkan anak" };

async function Gate() {
  await requireStaffSession();
  return <ChildForm liveIntakeEnabled={getEnv().liveIntakeEnabled} />;
}

export default function NewChildPage() {
  return (
    <>
      <PageHeader title="Daftarkan anak asuh" description="Profil disimpan sebagai draft. Verifikasi profil sebelum memulai siklus asesmen." />
      <Suspense fallback={<LoadingState label="Menyiapkan formulir…" rows={6} />}><Gate /></Suspense>
    </>
  );
}
