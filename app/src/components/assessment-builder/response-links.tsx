import Link from "next/link";
import type { StaffActor } from "@/server/services/staff.service";
import { listResponses } from "@/server/services/response.service";
import { Card, Badge, secondaryButtonClassName } from "@/components/ui";
export async function DynamicResponseLinks({ actor, filter = {} }: { actor: StaffActor; filter?: { cycleId?: string; childId?: string; guardianId?: string; page?: number } }) {
  const result = await listResponses(actor, filter);
  const params = new URLSearchParams(Object.entries(filter).map(([key, value]) => [key, String(value)]));
  const pageUrl = (page: number) => { const query = new URLSearchParams(params); query.set("page", String(page)); return `/assessment-responses?${query}`; };
  return <Card className="space-y-3"><h2 className="font-semibold">Formulir dinamis · {result.total} response</h2><p className="text-xs">Intake nonvalidasi, terpisah dari hasil A/B/C/W dan analisis AI.</p>{result.rows.map(({ response: r, childName, guardianName }) => <div key={r.id} className="border-t border-cream-200 pt-2"><Badge>{r.status}</Badge>{r.status === "withdrawn" ? <p>Response ditarik · {guardianName ?? childName}</p> : <Link className="block text-sm text-sage-700 underline" href={`/assessment-responses/${r.id}`}>{guardianName ?? childName} · {r.createdAt.toISOString().slice(0, 10)} · {r.id.slice(0, 8)}</Link>}</div>)}<nav className="flex gap-2" aria-label="Halaman response">{result.page > 1 && <Link className={secondaryButtonClassName} href={pageUrl(result.page - 1)}>Sebelumnya</Link>}{result.page * 25 < result.total && <Link className={secondaryButtonClassName} href={pageUrl(result.page + 1)}>Berikutnya</Link>}</nav></Card>;
}
