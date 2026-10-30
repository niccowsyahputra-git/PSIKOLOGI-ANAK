"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge, primaryButtonClassName, secondaryButtonClassName } from "@/components/ui";
import { api } from "@/lib/client-api";
import { EMOTIONS, INSTRUMENTS, LIKERT_LABELS, SKIP_REMINDER, type Answer, type Item, type Module } from "@/lib/instruments";
import { ASSISTANCE_LABELS } from "@/lib/labels";
import { DrawingPad } from "./drawing-pad";
import { EmotionFace } from "./emotion-face";
import { DynamicQuestionnaire } from "./dynamic-questionnaire";
import type { DynamicWire } from "@/server/services/response.service";

type Draft = { status: "draft"; revision: number; module: Module; answers: Answer[]; fictional: boolean; target: "child" | "guardian" };
type Wire = Draft | { status: "submitted"; submittedAt: string; fictional: boolean };
type SaveState = "idle" | "saving" | "saved" | "error" | "conflict" | "expired";
type Assistance = Answer["assistance"];
type MediaAnswer = Extract<Answer, { kind: "media" }>;

/** Incomplete answers (blank text, unsaved drawing) stay local until they are valid. */
function complete(answer: Answer): boolean {
  if (answer.state !== "answered") return true;
  if (answer.kind === "media") return Boolean(answer.activityMode) && (answer.activityMode === "paper_pending" || Boolean(answer.initialAttachmentId));
  return answer.value !== null && (typeof answer.value !== "string" || answer.value.trim().length > 0);
}
const errorState = (error: unknown): SaveState => { const status = (error as { status?: number }).status; return status === 409 ? "conflict" : status === 401 || status === 403 ? "expired" : "error"; };

export function Questionnaire() {
  const [wire, setWire] = useState<Wire | null>(null);
  const [dynamic, setDynamic] = useState<DynamicWire | null>(null);
  const [loadError, setLoadError] = useState<SaveState | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [step, setStep] = useState(-1);
  const [paused, setPaused] = useState(false);
  const [save, setSave] = useState<SaveState>("idle");
  const [finished, setFinished] = useState<"submitted" | "ended" | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  /** Assistance chosen before an answer exists is applied when the first answer is created. */
  const [pendingAssistance, setPendingAssistance] = useState<Record<string, Assistance>>({});
  const revision = useRef(0);
  const answersRef = useRef<Record<string, Answer>>({});
  const dirty = useRef(false);
  const busy = useRef<Promise<void> | null>(null);
  const saveRef = useRef<SaveState>("idle");
  const timer = useRef<number | undefined>(undefined);
  const setSaveState = (next: SaveState) => { saveRef.current = next; setSave(next); };

  const apply = useCallback((next: Wire | DynamicWire) => {
    if ("engine" in next) { setDynamic(next); return; }
    setWire(next); setLoadError(null); setSaveState("idle"); setPendingAssistance({});
    if (next.status === "draft") {
      revision.current = next.revision;
      const map = Object.fromEntries(next.answers.map((answer) => [answer.itemId, answer]));
      answersRef.current = map; setAnswers(map); dirty.current = false;
    }
  }, []);
  const load = useCallback(() => api<Wire | DynamicWire>("/api/intake/current").then(apply, (error: unknown) => setLoadError(errorState(error))), [apply]);
  useEffect(() => {
    let active = true;
    api<Wire | DynamicWire>("/api/intake/current").then((next) => { if (active) apply(next); }, (error: unknown) => { if (active) setLoadError(errorState(error)); });
    return () => { active = false; };
  }, [apply]);

  const items: readonly Item[] = wire?.status === "draft" ? INSTRUMENTS[wire.module] : [];

  /** Serialized autosave: one request in flight; edits made meanwhile are sent right after. */
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!busy.current) {
      busy.current = (async () => {
        while (dirty.current && saveRef.current !== "conflict" && saveRef.current !== "expired") {
          dirty.current = false; setSaveState("saving");
          try {
            const next = await api<Wire>("/api/intake/current", "PATCH", { revision: revision.current, answers: Object.values(answersRef.current).filter(complete) });
            if (next.status === "draft") revision.current = next.revision;
            setSaveState("saved");
          } catch (error) { setSaveState(errorState(error)); if (saveRef.current === "error") dirty.current = true; break; }
        }
      })().finally(() => { busy.current = null; });
    }
    await busy.current;
  }, []);

  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") void flush(); };
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); window.clearTimeout(timer.current); };
  }, [flush]);

  function commit(next: Record<string, Answer>) {
    answersRef.current = next; setAnswers(next); dirty.current = true;
    window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void flush(), 1000);
  }
  const update = (answer: Answer) => commit({ ...answersRef.current, [answer.itemId]: answer });
  const clearAnswer = (itemId: string) => { const next = { ...answersRef.current }; delete next[itemId]; commit(next); };

  async function go(next: number) { await flush(); setStep(next); window.scrollTo({ top: 0 }); }
  async function pause() { await flush(); setPaused(true); }

  async function submit() {
    setSubmitError(""); setSubmitting(true); await flush();
    if (saveRef.current === "conflict" || saveRef.current === "expired") { setSubmitting(false); return; }
    try {
      const next = await api<Wire>("/api/intake/submit", "POST", { revision: revision.current, answers: items.map((item) => answersRef.current[item.id]) });
      setWire(next); setFinished("submitted");
    } catch (error) { const state = errorState(error); if (state === "error") setSubmitError((error as Error).message); else setSaveState(state); }
    setSubmitting(false);
  }
  async function end() {
    try { await api("/api/intake/end", "POST", {}); } catch { /* the session is already invalid; the screen still closes */ }
    setFinished("ended");
  }

  if (dynamic) return <DynamicQuestionnaire initial={dynamic} />;
  if (loadError) return <Notice title={loadError === "expired" ? "Belum ada sesi aktif di perangkat ini" : "Jawaban belum dapat dimuat"} body={loadError === "expired" ? "Minta pendamping membuka tautan sesi dari aplikasi staf. Tautan hanya dapat dipakai sekali dan berlaku 24 jam." : "Periksa koneksi ke aplikasi lokal, lalu coba lagi."} action={loadError === "expired" ? <Link href="/" className={secondaryButtonClassName}>Ke halaman awal</Link> : <button className={primaryButtonClassName} onClick={() => void load()}>Coba lagi</button>} />;
  if (!wire) return <p className="py-20 text-center text-ink-500">Memuat…</p>;
  if (finished === "ended") return <Notice title="Terima kasih." body="Sesi sudah selesai. Silakan kembalikan perangkat kepada pendamping." action={<Link href="/login" className={secondaryButtonClassName}>Masuk staf</Link>} />;
  if (wire.status === "submitted") return <Notice title={finished ? "Jawaban sudah terkirim ✓" : "Jawaban untuk sesi ini sudah dikirim"} body={`Tersimpan pada ${new Date(wire.submittedAt).toLocaleString("id-ID")}. Terima kasih sudah meluangkan waktu dan bercerita.`} action={<button className={primaryButtonClassName} onClick={() => void end()}>Selesai & kembalikan perangkat</button>} />;
  if (save === "expired") return <Notice title="Sesi telah berakhir" body="Sesi ini dicabut atau kedaluwarsa. Jawaban yang sudah tersimpan tetap aman. Kembalikan perangkat kepada pendamping." action={<Link href="/" className={secondaryButtonClassName}>Ke halaman awal</Link>} />;

  const child = wire.target === "child";
  const banner = wire.fictional ? <div className="mb-3 rounded-2xl bg-clay-100 px-3 py-2 text-center text-[11px] font-medium text-clay-600">SESI DEMONSTRASI — DATA FIKTIF</div> : null;
  const addressed = (item: Item) => Boolean(answers[item.id] && complete(answers[item.id]));

  if (paused) return <>{banner}<Notice title={child ? "Istirahat dulu, ya." : "Sesi dijeda"} body={save === "error" || save === "conflict" ? "Sebagian perubahan belum tersimpan. Lanjutkan untuk mencoba menyimpan lagi atau memuat jawaban tersimpan." : `${child ? "Jawabanmu" : "Jawaban Anda"} sudah tersimpan. Lanjutkan kapan saja selama sesi masih berlaku.`} action={<button className={primaryButtonClassName} onClick={() => setPaused(false)}>Lanjutkan</button>} /></>;

  if (step < 0) return (
    <>{banner}
      <section className="shadow-card rounded-3xl bg-white p-5">
        <h1 className="text-[26px] leading-tight font-semibold text-ink-900">{child ? "Halo! Terima kasih sudah mau ikut." : "Terima kasih telah meluangkan waktu."}</h1>
        <div className="mt-4 space-y-2.5 text-[15px] leading-relaxed text-ink-700">
          {child ? <>
            <p>Ini <strong>bukan ujian</strong>. Tidak ada jawaban benar atau salah, dan tidak ada nilai.</p>
            <p>Kamu boleh melewati pertanyaan apa pun, dan boleh istirahat kapan saja.</p>
            <p>Ada {items.length} {wire.module === "A" ? "kegiatan" : "pertanyaan"}. Jawabanmu tersimpan otomatis.</p>
          </> : <>
            <p>Pertanyaan berikut tentang pengalaman Anda dan anak yang Anda dampingi. Tidak ada jawaban benar atau salah.</p>
            <p>Setiap pertanyaan boleh dilewati. Jawaban anak tidak diperlihatkan kepada Anda, dan jawaban Anda hanya dibaca oleh staf panti.</p>
            <p>Ada {items.length} pertanyaan. Jawaban tersimpan otomatis, dan Anda dapat memeriksa ulang sebelum mengirim.</p>
          </>}
        </div>
        <button className={`${primaryButtonClassName} mt-6 w-full py-3.5 text-base`} onClick={() => setStep(0)}>Mulai</button>
      </section>
    </>
  );

  if (step >= items.length) {
    const missing = items.filter((item) => !addressed(item));
    return (
      <>{banner}
        <Header step={items.length} total={items.length} save={save} onPause={pause} onRetry={() => void flush()} onReload={() => void load()} />
        <section className="shadow-card rounded-3xl bg-white p-5">
          <h1 className="text-xl font-semibold">Periksa sebelum mengirim</h1>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">Setelah dikirim, jawaban tidak dapat diubah. {missing.length ? `${missing.length} ${child ? "pertanyaan belum dijawab atau dilewati" : "pertanyaan belum dijawab atau dipilih dilewati"}.` : "Semua pertanyaan sudah dijawab atau dilewati."}</p>
          <ol className="mt-4 space-y-1.5">
            {items.map((item, index) => {
              const answer = answers[item.id];
              return <li key={item.id}><button type="button" onClick={() => void go(index)} className="flex min-h-[48px] w-full items-center justify-between gap-2 rounded-2xl bg-cream-50 px-3 py-2 text-left active:bg-cream-100">
                <span className="text-[12px] leading-snug"><span className="mr-1.5 text-ink-300">{index + 1}.</span>{item.text}</span>
                {!addressed(item) ? <Badge tone="clay">Belum diisi</Badge> : answer.state === "skipped" ? <Badge tone="neutral">Dilewati</Badge> : <Badge tone="sage">Dijawab</Badge>}
              </button></li>;
            })}
          </ol>
          {missing.length ? <button type="button" className={`${secondaryButtonClassName} mt-3 w-full`} onClick={() => commit({ ...answersRef.current, ...Object.fromEntries(missing.map((item) => [item.id, skippedAnswer(item, answersRef.current[item.id]?.assistance ?? pendingAssistance[item.id] ?? "none")])) })}>Lewati semua yang belum diisi</button> : null}
          {submitError ? <p role="alert" className="mt-3 rounded-2xl bg-clay-100 px-3.5 py-2.5 text-[12px] text-clay-600">{submitError}</p> : null}
          <div className="mt-4 flex flex-col gap-2">
            <button className={`${primaryButtonClassName} w-full`} disabled={missing.length > 0 || submitting || save === "conflict"} onClick={() => void submit()}>{submitting ? "Mengirim…" : "Kirim jawaban"}</button>
            <button className={`${secondaryButtonClassName} w-full`} onClick={() => void go(items.length - 1)}>Kembali</button>
          </div>
        </section>
      </>
    );
  }

  const item = items[step];
  const answer = answers[item.id];
  const assistance: Assistance = answer?.assistance ?? pendingAssistance[item.id] ?? "none";
  return (
    <>{banner}
      <Header step={step} total={items.length} save={save} onPause={pause} onRetry={() => void flush()} onReload={() => void load()} />
      <section className="shadow-card rounded-3xl bg-white p-5">
        {item.sensitive ? <p className="mb-3 rounded-2xl bg-sky-soft-100 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-700">Pertanyaan berikut mungkin terasa berat — {SKIP_REMINDER}.</p> : null}
        <p className="text-[12px] font-medium text-sage-700">{wire.module === "A" ? "Kegiatan" : "Pertanyaan"} {step + 1}</p>
        <h1 className="mt-1.5 text-xl leading-snug font-semibold text-ink-900">{item.text}</h1>
        <div className="mt-5">
          {answer?.state === "skipped" ? (
            <div className="rounded-2xl border border-dashed border-cream-300 bg-cream-50 p-4 text-[13px] text-ink-700">{child ? "Kamu memilih melewati pertanyaan ini. Tidak apa-apa." : "Anda memilih melewati pertanyaan ini."} <button type="button" className="ml-1 font-medium text-sage-700 underline" onClick={() => clearAnswer(item.id)}>Jawab saja</button></div>
          ) : <ItemInput item={item} answer={answer} assistance={assistance} onChange={update} child={child} />}
        </div>
        <div className="mt-5 flex flex-col gap-2.5 border-t border-cream-200 pt-3.5">
          {answer?.state !== "skipped" ? <button type="button" className="self-start text-[13px] text-ink-500 underline" onClick={() => update(skippedAnswer(item, assistance))}>{child ? "Aku belum ingin menjawab" : "Tidak ingin menjawab"}</button> : null}
          <label className="flex items-center justify-between gap-2 text-[11px] text-ink-500">Diisi pendamping:
            <select value={assistance} className="min-h-[36px] rounded-xl border border-cream-200 bg-white px-2" onChange={(event) => { const value = event.target.value as Assistance; if (answer) update({ ...answer, assistance: value } as Answer); else setPendingAssistance((current) => ({ ...current, [item.id]: value })); }}>
              {Object.entries(ASSISTANCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
      </section>
      <div className="mt-4 flex gap-2 pb-2">
        <button className={`${secondaryButtonClassName} flex-1 py-3`} onClick={() => void go(step - 1)} disabled={step === 0}>← Kembali</button>
        <button className={`${primaryButtonClassName} flex-1 py-3`} onClick={() => void go(step + 1)}>{step === items.length - 1 ? "Periksa jawaban →" : "Lanjut →"}</button>
      </div>
    </>
  );
}

function skippedAnswer(item: Item, assistance: Assistance): Answer {
  if (item.kind === "media") return { itemId: "A02", kind: "media", state: "skipped", assistance, activityMode: null, initialAttachmentId: null };
  if (item.kind === "emotion") return { itemId: "A01", kind: "emotion", state: "skipped", assistance, value: null };
  return { itemId: item.id, kind: item.kind, state: "skipped", assistance, value: null } as Answer;
}

function ItemInput({ item, answer, assistance, onChange, child }: { item: Item; answer: Answer | undefined; assistance: Assistance; onChange: (answer: Answer) => void; child: boolean }) {
  if (item.kind === "text") {
    const value = answer?.kind === "text" ? answer.value ?? "" : "";
    return <textarea autoFocus value={value} maxLength={4000} rows={6} placeholder={child ? "Tulis di sini…" : "Tulis jawaban Anda di sini…"} aria-label="Jawaban"
      className="w-full rounded-2xl border-2 border-cream-200 bg-cream-50 p-3.5 text-base focus:border-sage-500 focus:outline-none"
      onChange={(event) => onChange({ itemId: item.id, kind: "text", state: "answered", assistance, value: event.target.value })} />;
  }
  if (item.kind === "likert") {
    const value = answer?.kind === "likert" ? answer.value : null;
    return <div className="grid gap-2" role="radiogroup" aria-label="Pilihan jawaban">
      {LIKERT_LABELS.map((label, index) => <button key={label} type="button" role="radio" aria-checked={value === index + 1} onClick={() => onChange({ itemId: item.id, kind: "likert", state: "answered", assistance, value: index + 1 })}
        className={`min-h-[48px] rounded-2xl border-2 px-3 py-3 text-[13px] font-medium ${value === index + 1 ? "border-sage-500 bg-sage-100 text-sage-700" : "border-cream-200 bg-white text-ink-700 active:bg-cream-50"}`}>{label}</button>)}
    </div>;
  }
  if (item.kind === "emotion") {
    const value = answer?.kind === "emotion" ? answer.value : null;
    return <div className="flex flex-wrap justify-center gap-3" role="radiogroup" aria-label="Pilih wajah">
      {EMOTIONS.map((emotion) => <button key={emotion.value} type="button" role="radio" aria-checked={value === emotion.value} onClick={() => onChange({ itemId: "A01", kind: "emotion", state: "answered", assistance, value: emotion.value })}
        className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-3 ${value === emotion.value ? "border-sage-600 bg-sage-100" : "border-transparent hover:bg-cream-50"}`}>
        <EmotionFace value={emotion.value} selected={value === emotion.value} /><span className="text-base font-medium">{emotion.label}</span>
      </button>)}
    </div>;
  }
  return <DrawingActivity answer={answer?.kind === "media" ? answer : undefined} assistance={assistance} onChange={onChange} />;
}

function DrawingActivity({ answer, assistance, onChange }: { answer: MediaAnswer | undefined; assistance: Assistance; onChange: (answer: Answer) => void }) {
  const [mode, setMode] = useState<"canvas" | "photo" | null>(answer?.state === "answered" && answer.activityMode !== "paper_pending" ? answer.activityMode : null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const saved = answer?.state === "answered" ? answer : undefined;

  async function upload(file: Blob, activityMode: "canvas" | "photo") {
    setError(""); setUploading(true);
    try {
      const form = new FormData(); form.set("file", file instanceof File ? file : new File([file], "gambar.png", { type: "image/png" }));
      const result = await api<{ id: string }>("/api/intake/attachments", "POST", form);
      onChange({ itemId: "A02", kind: "media", state: "answered", assistance, activityMode, initialAttachmentId: result.id });
    } catch (cause) { setError((cause as Error).message); }
    setUploading(false);
  }

  if (saved?.activityMode === "paper_pending") return <div className="rounded-2xl bg-sky-soft-100 p-5 text-ink-700">Kamu menggambar di kertas. Pendamping akan memotret gambarnya nanti. <button type="button" className="ml-2 font-medium text-sage-700 underline" onClick={() => { setMode("canvas"); onChange({ itemId: "A02", kind: "media", state: "answered", assistance, activityMode: "canvas", initialAttachmentId: null }); }}>Gambar di layar saja</button></div>;
  if (saved?.initialAttachmentId && !mode) return null;
  if (saved?.initialAttachmentId) return (
    <div className="space-y-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- private, session-scoped image */}
      <img src={`/api/intake/attachments/${saved.initialAttachmentId}/content`} alt="Gambar yang sudah disimpan" className="max-h-96 rounded-2xl border border-cream-200" />
      <p className="text-sm text-sage-700">Gambar sudah disimpan ✓</p>
      <button type="button" className={secondaryButtonClassName} onClick={() => onChange({ itemId: "A02", kind: "media", state: "answered", assistance, activityMode: mode, initialAttachmentId: null })}>Ganti gambar</button>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <button type="button" onClick={() => setMode("canvas")} className={`rounded-2xl border-2 p-4 text-left ${mode === "canvas" ? "border-sage-600 bg-sage-100" : "border-cream-300"}`}><span className="block text-2xl">🖍️</span><span className="font-medium">Gambar di layar</span></button>
        <button type="button" onClick={() => setMode("photo")} className={`rounded-2xl border-2 p-4 text-left ${mode === "photo" ? "border-sage-600 bg-sage-100" : "border-cream-300"}`}><span className="block text-2xl">📷</span><span className="font-medium">Foto gambar di kertas</span></button>
        <button type="button" onClick={() => { setMode(null); onChange({ itemId: "A02", kind: "media", state: "answered", assistance, activityMode: "paper_pending", initialAttachmentId: null }); }} className="rounded-2xl border-2 border-cream-300 p-4 text-left"><span className="block text-2xl">📄</span><span className="font-medium">Gambar di kertas, foto menyusul</span></button>
      </div>
      {mode === "canvas" ? <DrawingPad saving={uploading} onSave={(blob) => void upload(blob, "canvas")} /> : null}
      {mode === "photo" ? <label className="block rounded-2xl border-2 border-dashed border-cream-300 p-6 text-center"><span className="block font-medium">{uploading ? "Mengunggah…" : "Pilih atau ambil foto gambar"}</span><span className="text-xs text-ink-500">PNG/JPG/WebP maks. 5 MB · lokasi foto tidak disimpan</span><input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" className="sr-only" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file, "photo"); event.target.value = ""; }} /></label> : null}
      {error ? <p role="alert" className="text-sm text-clay-600">{error}</p> : null}
    </div>
  );
}

function Header({ step, total, save, onPause, onRetry, onReload }: { step: number; total: number; save: SaveState; onPause: () => void; onRetry: () => void; onReload: () => void }) {
  const label = { idle: "", saving: "Menyimpan…", saved: "Tersimpan ✓", error: "Gagal menyimpan", conflict: "Jawaban berubah di tempat lain", expired: "Sesi berakhir" }[save];
  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-ink-500">{Math.min(step + 1, total)} dari {total}</span>
        <span className="flex items-center gap-3">
          <span role="status" aria-live="polite" className={save === "error" || save === "conflict" ? "text-clay-600" : "text-ink-500"}>{label}</span>
          {save === "error" ? <button type="button" className="text-sage-700 underline" onClick={onRetry}>Coba lagi</button> : null}
          {save === "conflict" ? <button type="button" className="text-sage-700 underline" onClick={onReload}>Muat ulang jawaban tersimpan</button> : null}
          <button type="button" className="min-h-[36px] rounded-full border border-cream-200 bg-white px-3 text-ink-700" onClick={onPause}>⏸ Istirahat</button>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-cream-200" aria-hidden="true"><div className="gradient-brand h-full rounded-full transition-all" style={{ width: `${(Math.min(step, total) / total) * 100}%` }} /></div>
    </div>
  );
}

function Notice({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <section className="shadow-card rounded-3xl bg-white p-6 text-center">
      <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
      <p className="mt-2.5 text-[13px] leading-relaxed text-ink-700">{body}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </section>
  );
}
