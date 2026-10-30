"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { compileDefinition, newQuestion, ruleLeaves, QUESTION_TYPES, type Definition, type Question, type QuestionType } from "@/lib/assessment-builder/definition";
import { can } from "@/lib/permissions";
import type { StaffRole } from "@/lib/roles";
import type { versionDetail } from "@/server/services/template.service";
import { Card, Badge, inputClassName as input, primaryButtonClassName as primary, secondaryButtonClassName as button } from "@/components/ui";
import { DefinitionPreview, SAFETY_LABEL, TYPE_LABELS } from "./renderer";
import { RuleEditor } from "./rule-editor";
import { QuestionAiPanel } from "./ai-panel";
import { builderRequest } from "./client";

type Detail = Awaited<ReturnType<typeof versionDetail>>;
function SortableQuestion({ q, selected, select, move, first, last, disabled }: { q: Question; selected: boolean; select: () => void; move: (delta: number) => void; first: boolean; last: boolean; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: q.id, disabled });
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`space-y-2 rounded-2xl border p-3 ${selected ? "border-sage-500 bg-sage-50" : "border-cream-200 bg-white"}`}>
    <button type="button" className="w-full text-left font-semibold" onClick={select}>{q.label || "Tanpa label"}</button>
    <p className="text-xs">{TYPE_LABELS[q.type]} · {q.archived ? "diarsipkan" : q.active ? "aktif" : "nonaktif"}</p>
    <div className="flex flex-wrap gap-1"><button type="button" disabled={disabled} className={`${button} touch-none`} aria-label={`Geser ${q.label}`} {...attributes} {...listeners}>↕</button><button type="button" disabled={disabled || first} className={button} aria-label={`Naik ${q.label}`} onClick={() => move(-1)}>↑</button><button type="button" disabled={disabled || last} className={button} aria-label={`Turun ${q.label}`} onClick={() => move(1)}>↓</button></div>
  </li>;
}
function Check({ label, checked, change, disabled = false }: { label: string; checked: boolean; change: (v: boolean) => void; disabled?: boolean }) {
  return <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => change(e.target.checked)} />{label}</label>;
}
export function TemplateEditor({ initial, role }: { initial: Detail; role: StaffRole }) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial); const [definition, setDefinition] = useState(initial.definition);
  const [selected, setSelected] = useState(initial.definition.questions[0]?.id ?? "");
  const [tab, setTab] = useState("editor"); const [panel, setPanel] = useState("outline");
  const [kind, setKind] = useState<QuestionType>("short_text"); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<Definition | null>(null);
  const writable = detail.version.status === "draft" && can(role, "form.write");
  const dirty = JSON.stringify(definition) !== JSON.stringify(detail.definition);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const q = definition.questions.find((q) => q.id === selected);
  useEffect(() => { if (!dirty) return; const warn = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  function update(patch: Partial<Definition>) { setDefinition((d) => ({ ...d, ...patch })); }
  function patchQuestion(patch: Partial<Question>) {
    if (!q) return;
    const next = { ...q, ...patch };
    if ((!next.active || next.archived) && definition.questions.some((x) => x.condition && ruleLeaves(x.condition).some((r) => r.questionId === q.id))) { setMessage("Perbaiki kondisi yang bergantung pada pertanyaan ini sebelum menonaktifkannya."); return; }
    if (next.personal || next.sensitive) next.allowSkip = true;
    update({ questions: definition.questions.map((x) => x.id === q.id ? next : x) });
  }
  function move(from: number, to: number) { if (to < 0 || to >= definition.questions.length) return; update({ questions: arrayMove(definition.questions, from, to) }); setMessage(`Urutan pertanyaan dipindah ke ${to + 1}.`); }
  function addQuestion() {
    const sectionId = q?.sectionId ?? definition.sections.find((s) => !s.archived)?.id;
    if (!sectionId) { setMessage("Tambahkan bagian dahulu."); return; }
    const next = newQuestion(sectionId, kind);
    if (["single_choice", "multiple_choice", "dropdown"].includes(kind)) next.options = [1, 2].map((n) => ({ id: crypto.randomUUID(), label: `Pilihan ${n}`, value: String(n) }));
    if (kind === "information") { next.personal = false; next.allowSkip = false; }
    if (kind === "file" && !definition.allowImages) { setMessage("Aktifkan izin unggahan gambar pada metadata sebelum menambahkan pertanyaan gambar."); return; }
    update({ questions: [...definition.questions, next] }); setSelected(next.id); setPanel("properties");
  }
  function duplicate() {
    if (!q) return;
    const next = structuredClone(q); next.id = crypto.randomUUID(); next.label += " (salinan)"; next.archived = false;
    const ids = new Map(next.options.map((o) => [o.id, crypto.randomUUID()]));
    next.options = next.options.map((o) => ({ ...o, id: ids.get(o.id)! }));
    if (next.condition) for (const leaf of ruleLeaves(next.condition)) if (leaf.questionId === q.id) { leaf.questionId = next.id; if (typeof leaf.value === "string" && ids.has(leaf.value)) leaf.value = ids.get(leaf.value)!; }
    update({ questions: [...definition.questions, next] }); setSelected(next.id);
  }
  async function run(operation: () => Promise<void>) { setBusy(true); setMessage(""); try { await operation(); } catch (e) { setMessage(e instanceof Error ? e.message : "Tindakan gagal"); } finally { setBusy(false); } }
  function apply(next: Detail) { setDetail(next); setDefinition(next.definition); }
  async function action(name: string, decision?: string) { await run(async () => { if (dirty) throw new Error("Simpan draft sebelum tindakan review."); apply(await builderRequest<Detail>(`/api/template-versions/${detail.version.id}/${name}`, "POST", { revision: detail.version.revision, note, ...(decision ? { decision } : {}) })); setMessage("Tindakan tersimpan."); }); }
  const numericKeys = q ? ["short_text", "long_text"].includes(q.type) ? ["minLength", "maxLength"] as const : q.type === "multiple_choice" ? ["minSelections", "maxSelections"] as const : ["number", "scale"].includes(q.type) ? ["min", "max", "step"] as const : [] : [];
  return <div className="builder-workspace space-y-4">
    <Link href="/assessment-templates" className={button}>← Template asesmen</Link>
    <h1 className="text-2xl font-semibold">{definition.name}</h1>
    <p className="text-sm">{SAFETY_LABEL}</p>
    <div className="flex flex-wrap gap-2"><Badge>v{detail.version.number} · {detail.version.status} · revisi {detail.version.revision}</Badge>{detail.version.demoOnly && <Badge tone="clay">SIMULASI · hanya data fiktif</Badge>}<Badge>{dirty ? "Belum disimpan" : "Tersimpan"}</Badge></div>
    <p className="break-all text-xs">SHA-256 {detail.version.contentHash}</p>
    <div className="flex flex-wrap gap-2">{["editor", "preview", "review", ...(can(role, "form.draft.read") ? ["ai"] : [])].map((value) => <button key={value} className={tab === value ? primary : button} disabled={busy} onClick={() => { if (value === "preview") { try { setPreview(compileDefinition(definition).definition); } catch (e) { setMessage(e instanceof Error ? e.message : "Definisi tidak valid"); return; } } setTab(value); }}>{value === "editor" ? "Editor" : value === "preview" ? "Pratinjau" : value === "ai" ? "Usulan AI" : "Review & riwayat"}</button>)}</div>
    <p role="status" className="whitespace-pre-wrap text-sm">{message}</p>
    {detail.warnings.map((warning) => <p key={warning} className="text-clay-600">{warning}</p>)}
    {tab === "preview" && preview && <DefinitionPreview key={JSON.stringify(preview)} definition={preview} />}
    {tab === "editor" && !writable && <label className="block">Periksa pertanyaan<select className={input} value={selected} onChange={(e) => { setSelected(e.target.value); setPanel("properties"); }}><option value="">Pilih pertanyaan</option>{definition.questions.map((q) => <option key={q.id} value={q.id}>{q.label || "Tanpa label"}</option>)}</select></label>}
    {tab === "editor" && <fieldset disabled={!writable || busy} className="space-y-4">
      <details className="rounded-2xl border border-cream-200 bg-white p-4" open={!definition.sections.length}><summary className="cursor-pointer font-semibold">Metadata formulir</summary><div className="mt-3 grid gap-3 md:grid-cols-2">{(["name", "description", "category", "purpose"] as const).map((key) => <label key={key}>{({ name: "Nama", description: "Deskripsi", category: "Kategori", purpose: "Tujuan" })[key]}<input className={input} value={definition[key]} onChange={(e) => update({ [key]: e.target.value })} /></label>)}<label>Responden<select className={input} value={definition.target} onChange={(e) => update({ target: e.target.value as Definition["target"] })}><option value="child">Anak</option><option value="guardian">Wali</option><option value="both">Anak dan wali</option></select></label><label>Bahasa<select className={input} value={definition.language} onChange={(e) => update({ language: e.target.value as Definition["language"] })}><option value="id">Indonesia</option><option value="en">English</option></select></label>{(["minAge", "maxAge"] as const).map((key) => <label key={key}>{key === "minAge" ? "Usia minimum" : "Usia maksimum"}<input className={input} type="number" min={0} max={100} value={definition[key] ?? ""} onChange={(e) => update({ [key]: e.target.value === "" ? null : Number(e.target.value) })} /></label>)}<Check label="Izinkan unggahan gambar" checked={definition.allowImages} change={(allowImages) => update({ allowImages })} /></div></details>
      <div className="flex gap-2 lg:hidden">{["outline", "properties"].map((p) => <button type="button" key={p} className={panel === p ? primary : button} onClick={() => setPanel(p)}>{p === "outline" ? "Bagian & pertanyaan" : "Properti pertanyaan"}</button>)}</div>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
        <div className={`space-y-4 ${panel !== "outline" ? "hidden lg:block" : ""}`}>
          <Card><h2 className="font-semibold">Bagian</h2>{definition.sections.map((s, i) => <div key={s.id} className="my-3 space-y-2 border-b border-cream-200 pb-3"><label>Judul bagian<input className={input} value={s.title} onChange={(e) => update({ sections: definition.sections.map((x) => x.id === s.id ? { ...x, title: e.target.value } : x) })} /></label><label>Petunjuk bagian<textarea className={input} value={s.instructions} onChange={(e) => update({ sections: definition.sections.map((x) => x.id === s.id ? { ...x, instructions: e.target.value } : x) })} /></label><div className="flex gap-2"><button type="button" className={button} disabled={!i} aria-label={`Naik bagian ${s.title}`} onClick={() => update({ sections: arrayMove(definition.sections, i, i - 1) })}>↑</button><button type="button" className={button} disabled={i === definition.sections.length - 1} aria-label={`Turun bagian ${s.title}`} onClick={() => update({ sections: arrayMove(definition.sections, i, i + 1) })}>↓</button><button type="button" className={button} onClick={() => { const sections = definition.sections.map((x) => x.id === s.id ? { ...x, archived: !x.archived } : x); try { compileDefinition({ ...definition, sections }); update({ sections }); } catch { setMessage("Perbaiki kondisi yang merujuk bagian ini dahulu."); } }}>{s.archived ? "Pulihkan" : "Arsipkan"}</button></div></div>)}<button type="button" className={button} disabled={definition.sections.length >= 20} onClick={() => update({ sections: [...definition.sections, { id: crypto.randomUUID(), title: "Bagian baru", instructions: "", active: true, archived: false }] })}>Tambah bagian</button></Card>
          <Card><h2 className="font-semibold">Pertanyaan</h2><DndContext id="question-sort" sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }) => { if (over && active.id !== over.id) move(definition.questions.findIndex((q) => q.id === active.id), definition.questions.findIndex((q) => q.id === over.id)); }}><SortableContext items={definition.questions.map((q) => q.id)} strategy={verticalListSortingStrategy}><ol className="my-3 space-y-2">{definition.questions.map((item, i) => <SortableQuestion key={item.id} q={item} selected={selected === item.id} select={() => { setSelected(item.id); setPanel("properties"); }} move={(delta) => move(i, i + delta)} first={!i} last={i === definition.questions.length - 1} disabled={!writable || busy} />)}</ol></SortableContext></DndContext><label>Jenis pertanyaan baru<select className={input} value={kind} onChange={(e) => setKind(e.target.value as QuestionType)}>{QUESTION_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}</select></label><button type="button" disabled={definition.questions.length >= 100} className={button} onClick={addQuestion}>Tambah pertanyaan</button></Card>
        </div>
        <Card className={`${panel !== "properties" ? "hidden lg:block" : ""} space-y-3`}>
          {q ? <><h2 className="font-semibold">Properti · {TYPE_LABELS[q.type]}</h2><p className="break-all text-xs">ID {q.id} · asal: {q.provenance.origin}{q.provenance.candidateId ? ` · kandidat ${q.provenance.candidateId}` : ""}</p><p className="text-xs">Jenis atau makna yang berbeda memerlukan pertanyaan baru. ID opsi bukan bobot skor.</p>
            {(["label", "instructions", "placeholder", "purpose"] as const).map((key) => <label key={key} className="block">{({ label: "Label pertanyaan", instructions: "Petunjuk pertanyaan", placeholder: "Placeholder", purpose: "Tujuan pertanyaan" })[key]}<textarea className={input} value={q[key]} onChange={(e) => patchQuestion({ [key]: e.target.value })} /></label>)}
            <label className="block">Bagian pertanyaan<select className={input} value={q.sectionId} onChange={(e) => patchQuestion({ sectionId: e.target.value })}>{definition.sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
            {q.type !== "information" && <><Check label="Wajib ditanggapi" checked={q.required} change={(required) => patchQuestion({ required })} /><Check label="Pertanyaan pribadi" checked={q.personal} change={(personal) => patchQuestion({ personal })} /><Check label="Sensitif" checked={q.sensitive} change={(sensitive) => patchQuestion({ sensitive })} /><Check label="Boleh dilewati" checked={q.allowSkip} disabled={q.personal || q.sensitive} change={(allowSkip) => patchQuestion({ allowSkip })} /><p className="text-xs">Wajib ditanggapi berarti jawaban atau pilihan eksplisit untuk melewati. Tidak ada pilihan melewati yang diisi otomatis.</p></>}
            <Check label="Pertanyaan aktif" checked={q.active} change={(active) => patchQuestion({ active })} />
            {["single_choice", "multiple_choice", "dropdown"].includes(q.type) && <fieldset className="space-y-2"><legend>Opsi (nilai tersimpan bukan skor)</legend>{q.options.map((o, i) => <div key={o.id} className="space-y-2 rounded-xl border border-cream-200 p-2"><label>Label opsi {i + 1}<input className={input} value={o.label} onChange={(e) => patchQuestion({ options: q.options.map((x) => x.id === o.id ? { ...x, label: e.target.value } : x) })} /></label><label>Nilai opsi {i + 1}<input className={input} value={o.value} onChange={(e) => patchQuestion({ options: q.options.map((x) => x.id === o.id ? { ...x, value: typeof o.value === "number" ? Number(e.target.value) : e.target.value } : x) })} /></label><Check label="Nilai numerik" checked={typeof o.value === "number"} change={(numeric) => patchQuestion({ options: q.options.map((x) => x.id === o.id ? { ...x, value: numeric ? i + 1 : String(x.value) } : x) })} /><div className="flex gap-2"><button type="button" className={button} disabled={!i} onClick={() => patchQuestion({ options: arrayMove(q.options, i, i - 1) })}>↑</button><button type="button" className={button} disabled={i === q.options.length - 1} onClick={() => patchQuestion({ options: arrayMove(q.options, i, i + 1) })}>↓</button><button type="button" className={button} onClick={() => patchQuestion({ options: q.options.filter((x) => x.id !== o.id) })}>Hapus opsi</button></div></div>)}<button type="button" className={button} disabled={q.options.length >= 50} onClick={() => patchQuestion({ options: [...q.options, { id: crypto.randomUUID(), label: "Pilihan baru", value: crypto.randomUUID() }] })}>Tambah opsi</button></fieldset>}
            {numericKeys.map((key) => <label key={key} className="block">{key}<input className={input} type="number" value={q.validation[key] ?? ""} onChange={(e) => { const validation = { ...q.validation }; if (e.target.value === "") delete validation[key]; else validation[key] = Number(e.target.value); patchQuestion({ validation }); }} /></label>)}
            {["number", "scale"].includes(q.type) && <Check label="Bilangan bulat" checked={!!q.validation.integer} change={(integer) => patchQuestion({ validation: { ...q.validation, integer } })} />}
            {q.type === "date" && (["minDate", "maxDate"] as const).map((key) => <label key={key}>{key}<input type="date" className={input} value={q.validation[key] ?? ""} onChange={(e) => { const validation = { ...q.validation }; if (!e.target.value) delete validation[key]; else validation[key] = e.target.value; patchQuestion({ validation }); }} /></label>)}
            <h3 className="font-semibold">Tampilkan jika</h3><RuleEditor rule={q.condition} questions={definition.questions.filter((x) => x.id !== q.id && definition.sections.some((s) => s.id === x.sectionId && s.active && !s.archived))} onChange={(condition) => patchQuestion({ condition })} />
            <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={definition.questions.length >= 100} onClick={duplicate}>Duplikasi pertanyaan</button><button type="button" className={button} onClick={() => patchQuestion({ archived: !q.archived })}>{q.archived ? "Pulihkan pertanyaan" : "Arsipkan pertanyaan"}</button></div>
          </> : <p>Pilih atau tambahkan pertanyaan untuk mengatur propertinya.</p>}
        </Card>
      </div>
    </fieldset>}
    {tab === "ai" && can(role, "form.draft.read") && <QuestionAiPanel versionId={detail.version.id} revision={detail.version.revision} definition={definition} writable={writable} dirty={dirty} onApplied={apply} onBusy={setBusy} />}
    {tab === "review" && <Card className="space-y-4">
      {can(role, "form.draft.read") && <Link className={button} href={`/assessment-templates/${detail.version.templateId}/history`}>Riwayat versi, perbedaan & audit</Link>}
      <label className="block">Catatan review / alasan tindakan<textarea className={input} minLength={5} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2">
        {writable && <button className={primary} disabled={busy || dirty} onClick={() => action("submit-review")}>Ajukan review psikolog</button>}
        {detail.version.status === "in_review" && can(role, "form.review") && <><button className={primary} disabled={busy} onClick={() => action("review", "approved")}>Setujui konten</button><button className={button} disabled={busy} onClick={() => action("review", "changes_requested")}>Minta perubahan</button></>}
        {detail.version.status === "in_review" && can(role, "form.publish") && <button className={primary} disabled={busy} onClick={() => action("publish")}>Publikasikan versi disetujui</button>}
        {can(role, "form.write") && detail.version.status !== "archived" && <button className={button} disabled={busy || dirty} onClick={() => action("archive")}>Arsipkan versi</button>}
        {can(role, "form.revoke") && detail.reviews[0]?.decision === "approved" && <button className={button} disabled={busy} onClick={() => action("revoke")}>Cabut persetujuan</button>}
        {can(role, "form.write") && ["published", "archived"].includes(detail.version.status) && <button className={button} disabled={busy} onClick={() => run(async () => { const next = await builderRequest<Detail>(`/api/assessment-templates/${detail.version.templateId}/versions`, "POST", { sourceVersionId: detail.version.id }); router.push(`/template-versions/${next.version.id}`); })}>Buat versi draft baru</button>}
        {can(role, "form.write") && <button className={button} disabled={busy || dirty} onClick={() => run(async () => { const next = await builderRequest<Detail>("/api/assessment-templates", "POST", { sourceVersionId: detail.version.id, name: `${definition.name.slice(0, 185)} (salinan)` }); router.push(`/template-versions/${next.version.id}`); })}>Duplikasi template</button>}
      </div>
      {detail.reviews.map((r) => <details key={r.id} className="border-t border-cream-200 pt-3"><summary>{r.decision} · revisi {r.revision} · {r.note}</summary><p className="break-all text-xs">Peninjau {r.actorId} · SHA-256 {r.contentHash}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(JSON.parse(r.snapshotJson), null, 2)}</pre></details>)}
    </Card>}
    <div className="sticky bottom-0 flex flex-wrap gap-2 rounded-2xl border border-cream-200 bg-white p-3">
      {writable && <button className={primary} disabled={busy || !dirty} onClick={() => run(async () => { apply(await builderRequest<Detail>(`/api/template-versions/${detail.version.id}`, "PATCH", { revision: detail.version.revision, definition })); setMessage("Draft tersimpan."); })}>Simpan draft</button>}
      <button className={button} disabled={busy} onClick={() => run(async () => { if (dirty && !window.confirm("Buang perubahan lokal dan muat ulang?")) return; apply(await builderRequest<Detail>(`/api/template-versions/${detail.version.id}`)); setMessage("Versi tersimpan dimuat ulang."); })}>Muat ulang</button>
    </div>
  </div>;
}
