"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { listTemplates } from "@/server/services/template.service";
import { builderRequest } from "@/components/assessment-builder/client";
import { SAFETY_LABEL } from "@/components/assessment-builder/renderer";
import { Badge, Card, EmptyState, PageHeader, inputClassName as input, primaryButtonClassName as primary, secondaryButtonClassName as button } from "@/components/ui";
export function TemplateCatalog({ initial, write, drafts, query }: { initial: Awaited<ReturnType<typeof listTemplates>>; write: boolean; drafts: boolean; query: Record<string, string> }) {
  const router = useRouter();
  const [name, setName] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const pageLink = (page: number) => `/assessment-templates?${new URLSearchParams({ ...query, page: String(page) })}`;
  return <div className="space-y-4"><PageHeader title="Template asesmen" description={SAFETY_LABEL} />
    <Card><form className="space-y-3"><label>Cari template<input name="q" className={input} defaultValue={query.q} /></label><label>Kategori<input name="category" className={input} defaultValue={query.category} /></label><label>Responden<select className={input} name="target" defaultValue={query.target ?? ""}><option value="">Semua</option><option value="child">Anak</option><option value="guardian">Wali</option><option value="both">Keduanya</option></select></label>{drafts && <label>Status<select className={input} name="status" defaultValue={query.status ?? ""}><option value="">Semua</option>{["draft", "in_review", "published", "archived"].map((s) => <option key={s}>{s}</option>)}</select></label>}<button className={button}>Cari & filter</button></form></Card>
    {write && <Card><form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(""); try { const data = await builderRequest<{ version: { id: string } }>("/api/assessment-templates", "POST", { name }); router.push(`/template-versions/${data.version.id}`); } catch (e) { setError(e instanceof Error ? e.message : "Gagal membuat draft"); setBusy(false); } }}><label>Nama template baru<input required minLength={3} maxLength={200} className={input} value={name} onChange={(e) => setName(e.target.value)} /></label><button className={primary} disabled={busy}>Buat template</button>{error && <p role="alert">{error}</p>}</form></Card>}
    {!initial.rows.length && <EmptyState title="Belum ada template yang sesuai" />}
    {initial.rows.map((row) => <Card key={row.id}><Link className="text-lg font-semibold" href={`/template-versions/${row.id}`}>{row.metadata.name}</Link><p>{row.metadata.description}</p><div className="mt-2 flex flex-wrap gap-2"><Badge>v{row.number} · {row.status}</Badge><Badge>{row.metadata.target}</Badge><Badge>{row.metadata.category || "Tanpa kategori"}</Badge>{row.demoOnly && <Badge tone="clay">SIMULASI</Badge>}</div></Card>)}
    <nav aria-label="Halaman template" className="flex flex-wrap items-center gap-3">{initial.page > 1 && <Link className={button} href={pageLink(initial.page - 1)}>Sebelumnya</Link>}<span>{initial.total} versi · halaman {initial.page}</span>{initial.page * 25 < initial.total && <Link className={button} href={pageLink(initial.page + 1)}>Berikutnya</Link>}</nav>
  </div>;
}
