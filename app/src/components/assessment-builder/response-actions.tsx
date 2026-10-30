"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { builderRequest } from "./client";
import { Card, inputClassName as input, primaryButtonClassName as primary, secondaryButtonClassName as button } from "@/components/ui";

export function ResponseActions({ id, cycleId, draft, canCorrect, canWithdraw }: { id: string; cycleId: string; draft: boolean; canCorrect: boolean; canWithdraw: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [link, setLink] = useState(""); const [reason, setReason] = useState("");
  async function run(action: () => Promise<void>) { setBusy(true); setMessage(""); try { await action(); } catch (e) { setMessage(e instanceof Error ? e.message : "Tindakan gagal"); } finally { setBusy(false); } }
  return <Card className="no-print space-y-3">
    {draft && <><h2 className="font-semibold">Sesi peserta</h2><p className="text-sm">Tautan sekali pakai, berlaku 24 jam. Membuat sesi baru mencabut sesi sebelumnya. Jawaban tersimpan tetap tersedia.</p><button disabled={busy} className={primary} onClick={() => run(async () => { const next = await builderRequest<{ path: string }>(`/api/assessment-responses/${id}/sessions`, "POST", {}); setLink(next.path); router.refresh(); })}>Siapkan sesi peserta</button>
      {link && <div className="space-y-2"><p className="text-sm">Login staf berakhir saat sesi dibuka. Serahkan perangkat hanya kepada responden yang ditugaskan.</p><a className={primary} href={link}>Serahkan perangkat & mulai</a><button className={button} onClick={() => setLink("")}>Sembunyikan tautan</button></div>}</>}
    {(canCorrect || canWithdraw) && <><h2 className="font-semibold">Koreksi & penarikan</h2><p className="text-sm">Koreksi membuat response baru pada versi template yang sama. Jawaban terkirim tidak diubah. Gambar harus diunggah ulang.</p><label className="block">Alasan<textarea className={input} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} /></label>
      {canCorrect && <button className={button} disabled={busy || reason.trim().length < 5} onClick={() => run(async () => { const next = await builderRequest<{ id: string }>(`/api/assessment-responses/${id}/corrections`, "POST", { reason }); router.push(`/assessment-responses/${next.id}`); })}>Buat versi koreksi</button>}
      {canWithdraw && <button className={button} disabled={busy || reason.trim().length < 5} onClick={() => { if (window.confirm("Tarik response dan cabut seluruh sesi terkait?")) void run(async () => { await builderRequest(`/api/assessment-responses/${id}/withdraw`, "POST", { reason }); router.push(`/cycles/${cycleId}`); router.refresh(); }); }}>Tarik response</button>}</>}
    <p role="status">{message}</p>
  </Card>;
}
