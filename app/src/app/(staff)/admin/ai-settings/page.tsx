import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { AiSettingsView } from "./ai-settings-view";

export const metadata: Metadata = {
  title: "Konfigurasi AI",
};

export default function AiSettingsPage() {
  return (
    <>
      <PageHeader
        title="Konfigurasi AI"
        description="Mode mock lokal atau endpoint model lokal opsional, beserta pengujian konfigurasi. Penyedia AI jarak jauh dinonaktifkan pada instalasi ini."
      />
      <Suspense fallback={<Skeleton rows={6} />}>
        <AiSettingsView />
      </Suspense>
    </>
  );
}
