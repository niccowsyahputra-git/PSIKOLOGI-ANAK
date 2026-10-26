import { Suspense } from "react";
import { PageHeader, Skeleton } from "@/components/ui";
import { AssessmentDashboard } from "@/components/assessment-dashboard";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dasbor"
        description="Asesmen anak asuh dan orang tua / wali, dari kegiatan hingga jawaban tersimpan."
      />
      <Suspense fallback={<Skeleton rows={6} />}>
        <AssessmentDashboard />
      </Suspense>
    </>
  );
}
