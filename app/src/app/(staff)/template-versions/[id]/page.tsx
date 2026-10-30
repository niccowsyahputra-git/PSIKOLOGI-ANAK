import { Suspense } from "react";
import { TemplateEditor } from "@/components/assessment-builder/editor";
import { LoadingState } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { versionDetail } from "@/server/services/template.service";
export const metadata = { title: "Editor template asesmen" };
async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const actor = toStaffActor(await requireStaffSession());
  const detail = await versionDetail(actor, (await params).id);
  return <TemplateEditor key={detail.version.id} initial={detail} role={actor.role} />;
}
export default function Page(props: { params: Promise<{ id: string }> }) { return <Suspense fallback={<LoadingState />}><Editor {...props} /></Suspense>; }
