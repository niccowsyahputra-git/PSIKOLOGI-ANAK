"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client-api";
import { compileDefinition, normalizeAnswers, type DynamicAnswer } from "@/lib/assessment-builder/definition";
import type { DynamicWire } from "@/server/services/response.service";
import { DynamicRenderer, AnswerSummary, clearHidden } from "@/components/assessment-builder/renderer";
import { Card, primaryButtonClassName as primary, secondaryButtonClassName as button } from "@/components/ui";

export function DynamicQuestionnaire({ initial }: { initial: DynamicWire }) {
  const [wire, setWire] = useState(initial); const [answers, setAnswers] = useState(initial.answers);
  const [message, setMessage] = useState("Tersimpan"); const [paused, setPaused] = useState(false); const [review, setReview] = useState(false); const [ended, setEnded] = useState(false); const [working, setWorking] = useState(false);
  const latest = useRef(initial.answers); const revision = useRef(initial.revision); const dirty = useRef(false); const blocked = useRef(false); const busy = useRef<Promise<void> | null>(null); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const compiled = useRef(compileDefinition(initial.definition));
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (blocked.current) throw new Error("Sesi tidak tersedia atau konflik revisi. Muat ulang sebelum melanjutkan.");
    if (!busy.current) busy.current = (async () => {
      while (dirty.current) {
        dirty.current = false;
        try {
          const normalized = normalizeAnswers(compiled.current, latest.current);
          setMessage("Menyimpan…");
          const next = await api<DynamicWire>("/api/intake/current", "PATCH", { revision: revision.current, answers: normalized });
          revision.current = next.revision; setMessage("Tersimpan");
        } catch (error) { dirty.current = true; const status = (error as { status?: number }).status; blocked.current = status === 409 || status === 401 || status === 403; setMessage(error instanceof Error ? error.message : "Gagal menyimpan"); throw error; }
      }
    })().finally(() => { busy.current = null; });
    await busy.current;
  }, []);
  useEffect(() => {
    const hide = () => { if (document.visibilityState === "hidden") void flush().catch(() => undefined); };
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current || busy.current) e.preventDefault(); };
    document.addEventListener("visibilitychange", hide); window.addEventListener("beforeunload", warn);
    return () => { clearTimeout(timer.current); document.removeEventListener("visibilitychange", hide); window.removeEventListener("beforeunload", warn); };
  }, [flush]);
  const change = (next: DynamicAnswer[]) => { latest.current = clearHidden(wire.definition, next); setAnswers(latest.current); dirty.current = true; setMessage("Belum disimpan"); clearTimeout(timer.current); timer.current = setTimeout(() => void flush().catch(() => undefined), 700); };
  async function run(fn: () => Promise<void>) { setWorking(true); try { await fn(); } catch (e) { setMessage(e instanceof Error ? e.message : "Tindakan gagal"); } finally { setWorking(false); } }
  async function end() { clearTimeout(timer.current); await busy.current?.catch(() => undefined); await api("/api/intake/end", "POST", {}); dirty.current = false; latest.current = []; setAnswers([]); setEnded(true); }
  async function upload(questionId: string, file: File) {
    await flush(); const form = new FormData(); form.set("questionId", questionId); form.set("file", file);
    const response = await fetch("/api/intake/attachments", { method: "POST", body: form }); const json = await response.json();
    if (!response.ok) throw new Error(json.error?.message ?? "Gagal mengunggah"); return json.data.id as string;
  }
  if (ended) return <Card><h1>Terima kasih.</h1><p>Sesi selesai. Kembalikan perangkat kepada pendamping.</p><Link href="/login" className={button}>Masuk staf</Link></Card>;
  if (wire.status === "submitted") return <Card className="space-y-3"><h1 className="text-xl font-semibold">Jawaban sudah terkirim</h1><p>Tersimpan pada {wire.submittedAt}. Jawaban tidak dapat diubah.</p><p className="break-all text-xs">Tanda terima · {wire.sessionId} · versi {wire.templateVersionId} · SHA-256 {wire.contentHash}</p><button className={primary} disabled={working} onClick={() => run(end)}>Selesai & kembalikan perangkat</button><p role="status">{message}</p></Card>;
  return <div className="space-y-4"><h1 className="text-xl font-semibold">{wire.definition.name}</h1>{wire.fictional && <p className="rounded-xl bg-clay-100 p-3 text-sm">SESI DEMONSTRASI — DATA FIKTIF</p>}<p role="status" className="text-sm">{message}</p>
    {paused ? <Card><h2>Sesi dijeda</h2><p>Jawaban tersimpan. Lanjutkan selama sesi masih berlaku.</p><button className={primary} onClick={() => setPaused(false)}>Lanjutkan</button></Card> : review ? <Card className="space-y-3"><h2 className="text-lg font-semibold">Periksa sebelum mengirim</h2><AnswerSummary definition={wire.definition} answers={answers} /><button className={button} disabled={working} onClick={() => setReview(false)}>Kembali mengisi</button><button className={primary} disabled={working} onClick={() => run(async () => { await flush(); const next = await api<DynamicWire>("/api/intake/submit", "POST", { revision: revision.current, answers: normalizeAnswers(compiled.current, latest.current, true) }); dirty.current = false; latest.current = []; setAnswers([]); setWire(next); })}>Kirim jawaban</button></Card> : <DynamicRenderer definition={wire.definition} answers={answers} onChange={change} disabled={working} upload={upload} onUploadBusy={setWorking} />}
    {!paused && !review && <div className="flex flex-wrap gap-2"><button className={primary} disabled={working} onClick={() => run(async () => { await flush(); normalizeAnswers(compiled.current, latest.current, true); setReview(true); })}>Periksa jawaban</button><button className={button} disabled={working} onClick={() => run(async () => { await flush(); setPaused(true); })}>Simpan & jeda</button></div>}
    <div className="flex flex-wrap gap-2"><button className={button} disabled={working} onClick={() => run(flush)}>Simpan sekarang</button><button className={button} disabled={working} onClick={() => run(async () => { if (dirty.current && !window.confirm("Buang perubahan yang belum tersimpan?")) return; await busy.current?.catch(() => undefined); const next = await api<DynamicWire>("/api/intake/current"); latest.current = next.answers; revision.current = next.revision; dirty.current = false; blocked.current = false; setAnswers(next.answers); setWire(next); setReview(false); setMessage("Jawaban tersimpan dimuat ulang"); })}>Muat ulang tersimpan</button><button className={button} disabled={working} onClick={() => run(async () => { try { await flush(); } catch { if (!window.confirm("Jawaban belum tersimpan. Akhiri sesi tanpa perubahan ini?")) return; } await end(); })}>Akhiri sesi</button></div>
  </div>;
}
