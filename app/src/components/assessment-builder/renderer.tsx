"use client";

import { useMemo, useState } from "react";
import { SAFETY_LABEL, compileDefinition, visibleQuestionIds, normalizeAnswers, formatAnswer, type Definition, type DynamicAnswer, type Question } from "@/lib/assessment-builder/definition";
import { Card, inputClassName, secondaryButtonClassName } from "@/components/ui";

export const TYPE_LABELS = { short_text: "Teks singkat", long_text: "Teks panjang", single_choice: "Pilihan tunggal", multiple_choice: "Pilihan jamak", yes_no: "Ya / Tidak", number: "Angka", date: "Tanggal", dropdown: "Daftar pilihan", scale: "Skala / rating", information: "Informasi", file: "Gambar privat" } as const;
export { SAFETY_LABEL } from "@/lib/assessment-builder/definition";
export function clearHidden(definition: Definition, answers: DynamicAnswer[]): DynamicAnswer[] {
  const visible = visibleQuestionIds(compileDefinition(definition), answers);
  return answers.filter((a) => visible.has(a.questionId) && a.state !== "not_applicable");
}

export function DynamicRenderer({ definition, answers, onChange, disabled = false, upload, onUploadBusy }: {
  definition: Definition; answers: DynamicAnswer[]; onChange: (answers: DynamicAnswer[]) => void; disabled?: boolean;
  upload?: (questionId: string, file: File) => Promise<string>;
  onUploadBusy?: (busy: boolean) => void;
}) {
  const compiled = useMemo(() => compileDefinition(definition), [definition]);
  const visible = visibleQuestionIds(compiled, answers);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const items = compiled.ordered.filter((q) => visible.has(q.id) && q.type !== "information");
  const addressed = items.filter((q) => answers.some((a) => a.questionId === q.id && a.state !== "not_applicable")).length;
  function change(q: Question, value: DynamicAnswer["value"], state: DynamicAnswer["state"] = "answered") {
    const previous = answers.find((a) => a.questionId === q.id);
    const next = answers.filter((a) => a.questionId !== q.id);
    if (value !== "" && !(state === "answered" && value === null)) next.push({ questionId: q.id, value, state, assistance: previous?.assistance ?? "none", skipReason: null });
    onChange(clearHidden(definition, next));
  }
  return <div className="space-y-4">
    <p className="text-sm text-ink-500">{SAFETY_LABEL}</p>
    <p role="status">{addressed} / {items.length} pertanyaan terlihat telah ditanggapi</p>
    <progress className="w-full" max={Math.max(1, items.length)} value={addressed} aria-label="Kemajuan pertanyaan terlihat" />
    {uploadError && <p role="alert">{uploadError}</p>}
    {definition.sections.filter((s) => s.active && !s.archived).map((section) => <section key={section.id} className="space-y-4" aria-labelledby={`section-${section.id}`}>
      <h2 id={`section-${section.id}`} className="text-lg font-semibold">{section.title}</h2>
      <p className="whitespace-pre-wrap text-sm">{section.instructions}</p>
      {compiled.ordered.filter((q) => q.sectionId === section.id && visible.has(q.id)).map((q) => {
        const a = answers.find((a) => a.questionId === q.id); const value = a?.state === "answered" ? a.value : null;
        const id = `answer-${q.id}`;
        if (q.type === "information") return <Card key={q.id}><h3>{q.label}</h3><p className="whitespace-pre-wrap">{q.instructions}</p></Card>;
        return <Card key={q.id}><fieldset disabled={disabled || uploading} className="space-y-3">
          <legend className="font-semibold">{q.label}{q.required ? " · wajib ditanggapi" : " · opsional"}</legend>
          <p id={`${id}-hint`} className="whitespace-pre-wrap text-sm text-ink-500">{q.instructions}{q.sensitive || q.personal ? " Anda boleh melewati pertanyaan ini." : ""}</p>
          {(q.type === "short_text" || q.type === "long_text") && (q.type === "long_text" ? <textarea id={id} aria-label={q.label} aria-describedby={`${id}-hint`} className={inputClassName} maxLength={q.validation.maxLength ?? 4000} placeholder={q.placeholder} value={typeof value === "string" ? value : ""} onChange={(e) => change(q, e.target.value)} /> : <input id={id} aria-label={q.label} className={inputClassName} maxLength={q.validation.maxLength ?? 300} placeholder={q.placeholder} value={typeof value === "string" ? value : ""} onChange={(e) => change(q, e.target.value)} />)}
          {(q.type === "number" || q.type === "scale" || q.type === "date") && <input id={id} aria-label={q.label} className={inputClassName} type={q.type === "date" ? "date" : "number"} min={q.validation.minDate ?? q.validation.min} max={q.validation.maxDate ?? q.validation.max} step={q.validation.step ?? (q.validation.integer ? 1 : "any")} value={typeof value === "number" || typeof value === "string" ? value : ""} onChange={(e) => change(q, e.target.value === "" ? null : q.type === "date" ? e.target.value : e.target.valueAsNumber)} />}
          {(q.type === "single_choice" || q.type === "multiple_choice") && q.options.map((o) => <label key={o.id} className="flex min-h-11 items-center gap-3 rounded-xl border border-cream-200 p-2"><input type={q.type === "multiple_choice" ? "checkbox" : "radio"} name={id} checked={Array.isArray(value) ? value.includes(o.id) : value === o.id} onChange={(e) => change(q, q.type === "multiple_choice" ? e.target.checked ? [...(Array.isArray(value) ? value : []), o.id] : (Array.isArray(value) ? value : []).filter((v) => v !== o.id) : o.id)} />{o.label}</label>)}
          {q.type === "dropdown" && <select aria-label={q.label} className={inputClassName} value={typeof value === "string" ? value : ""} onChange={(e) => change(q, e.target.value)}><option value="">Pilih…</option>{q.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>}
          {q.type === "yes_no" && [true, false].map((v) => <label key={String(v)} className="flex min-h-11 items-center gap-3"><input type="radio" name={id} checked={value === v} onChange={() => change(q, v)} />{v ? "Ya" : "Tidak"}</label>)}
          {q.type === "file" && <><p className="text-sm">PNG / JPEG / WebP, maksimum 5 MB. {upload ? "Persetujuan media diperlukan." : "Pratinjau tidak mengunggah atau menyimpan berkas."}</p>{upload && <input aria-label={q.label} className={inputClassName} type="file" accept="image/png,image/jpeg,image/webp" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setUploading(true); onUploadBusy?.(true); setUploadError(""); try { if (file.size > 5 * 1024 * 1024) throw new Error("Gambar maksimal 5 MB"); change(q, await upload(q.id, file)); } catch (error) { setUploadError(error instanceof Error ? error.message : "Unggah gagal"); } finally { setUploading(false); onUploadBusy?.(false); } }} />}{value && <p>Gambar tersimpan privat</p>}</>}
          {(q.allowSkip || q.sensitive || q.personal) && <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={a?.state === "skipped"} onChange={(e) => change(q, null, e.target.checked ? "skipped" : "answered")} />Saya memilih melewati pertanyaan ini</label>}
          {a && a.state !== "not_applicable" && <label className="block text-sm">Bantuan<select className={inputClassName} value={a.assistance} onChange={(e) => onChange(answers.map((x) => x.questionId === q.id ? { ...x, assistance: e.target.value as DynamicAnswer["assistance"] } : x))}><option value="none">Tanpa bantuan</option><option value="read_aloud">Dibacakan</option><option value="scribed">Dicatat pendamping</option></select></label>}
        </fieldset></Card>;
      })}
    </section>)}
  </div>;
}

export function AnswerSummary({ definition, answers }: { definition: Definition; answers: DynamicAnswer[] }) {
  const normalized = normalizeAnswers(compileDefinition(definition), answers);
  return <dl className="space-y-3">{definition.questions.filter((q) => q.type !== "information").map((q) => <div key={q.id}><dt className="font-semibold">{q.label}</dt><dd className="whitespace-pre-wrap">{formatAnswer(q, normalized.find((a) => a.questionId === q.id))}</dd></div>)}</dl>;
}

export function DefinitionPreview({ definition }: { definition: Definition }) {
  const [answers, setAnswers] = useState<DynamicAnswer[]>([]); const [mobile, setMobile] = useState(true); const [message, setMessage] = useState("");
  return <div className="space-y-4"><div className="flex flex-wrap gap-2"><button className={secondaryButtonClassName} onClick={() => setMobile(!mobile)}>{mobile ? "Lebar desktop" : "Lebar ponsel"}</button><button className={secondaryButtonClassName} onClick={() => { setAnswers([]); setMessage(""); }}>Reset pratinjau</button><button className={secondaryButtonClassName} onClick={() => { try { normalizeAnswers(compileDefinition(definition), answers, true); setMessage("Jawaban pratinjau valid. Tidak disimpan."); } catch (e) { setMessage(e instanceof Error ? e.message : "Jawaban tidak valid"); } }}>Validasi jawaban</button></div><p role="status">{message}</p><div className={`mx-auto w-full ${mobile ? "max-w-[390px]" : "max-w-4xl"}`}><DynamicRenderer definition={definition} answers={answers} onChange={setAnswers} /></div></div>;
}
