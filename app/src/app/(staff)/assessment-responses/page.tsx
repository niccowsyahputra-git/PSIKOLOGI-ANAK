import { Suspense } from "react";
import { DynamicResponseLinks } from "@/components/assessment-builder/response-links";
import { LoadingState } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
export const metadata = { title: "Response formulir dinamis" };
async function Responses({ searchParams }: { searchParams: Promise<{ cycleId?: string; childId?: string; guardianId?: string; page?: string }> }) {
  const query = await searchParams;
  return <DynamicResponseLinks actor={toStaffActor(await requireStaffSession())} filter={{ ...query, ...(query.page ? { page: Number(query.page) } : { page: 1 }) }} />;
}
export default function Page(props: { searchParams: Promise<{ cycleId?: string; childId?: string; guardianId?: string; page?: string }> }) { return <Suspense fallback={<LoadingState />}><Responses {...props} /></Suspense>; }
