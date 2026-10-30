import { Suspense } from "react";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { listTemplates } from "@/server/services/template.service";
import { can } from "@/lib/permissions";
import { LoadingState } from "@/components/ui";
import { TemplateCatalog } from "./template-catalog";
export const metadata = { title: "Template asesmen" };
async function Catalog({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = toStaffActor(await requireStaffSession());
  const params = await searchParams;
  const query = Object.fromEntries(Object.entries(params).filter(([, value]) => typeof value === "string" && value !== ""));
  const data = await listTemplates(actor, query);
  return <TemplateCatalog initial={data} write={can(actor.role, "form.write")} drafts={can(actor.role, "form.draft.read")} query={query as Record<string, string>} />;
}
export default function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <Suspense fallback={<LoadingState />}><Catalog {...props} /></Suspense>; }
