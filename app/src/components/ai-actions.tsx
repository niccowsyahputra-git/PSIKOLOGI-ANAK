"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field, inputClassName, primaryButtonClassName, secondaryButtonClassName } from "@/components/ui";
import { api } from "@/lib/client-api";
import { AI_DISPOSITION_LABELS } from "@/lib/labels";

/**
 * Client controls for the AI workflow (FR-11, FR-12). The idempotency key is
 * created here before the request, so a double click or a retry resolves to the
 * same job instead of calling the provider twice.
 */
type GenerateProps = {
  childId: string;
  guardianId: string | null;
  cycleId: string;
  scope: "child" | "guardian" | "combined";
  sourceAssessmentIds: string[];
  /** A repeat run is a judgement call, so the reason is mandatory (BR-14). */
  needsReason: boolean;
  ready: boolean;
  blockedReason: string | null;
};

export function GenerateAnalysisButton({ childId, guardianId, cycleId, scope, sourceAssessmentIds, needsReason, ready, blockedReason }: GenerateProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function send(regenerateReason: string | null) {
    setError("");
    setPending(true);
    try {
      const detail = await api<{ analysis: { id: string } }>("/api/ai/analyses", "POST", {
        childId,
        guardianId,
        cycleId,
        scope,
        sourceAssessmentIds,
        regenerateReason,
        idempotencyKey: crypto.randomUUID(),
      });
      setOpen(false);
      router.push(`/analyses/${detail.analysis.id}`);
    } catch (cause) {
      setError((cause as Error).message);
      setPending(false);
    }
  }

  if (!ready) {
    return (
      <div className="space-y-1">
        <button type="button" disabled className={primaryButtonClassName}>Buat analisis AI</button>
        <p className="text-xs text-ink-500">{blockedReason ?? "Bantuan AI belum tersedia."}</p>
      </div>
    );
  }

  if (needsReason && open) {
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void send(String(new FormData(event.currentTarget).get("regenerateReason") ?? "").trim());
    };
    return (
      <form onSubmit={submit} className="space-y-2 rounded-2xl border border-cream-200 bg-cream-50 p-3">
        <Field label="Alasan analisis ulang (wajib)" htmlFor="regenerate-reason" hint="Hasil lama tetap tersimpan; analisis baru ditambahkan sebagai versi berikutnya.">
          <input id="regenerate-reason" name="regenerateReason" required minLength={10} maxLength={1000} className={inputClassName} />
        </Field>
        {error ? <p role="alert" className="text-sm text-clay-600">{error}</p> : null}
        <div className="flex gap-2">
          <button disabled={pending} className={primaryButtonClassName}>{pending ? "Memproses…" : "Jalankan analisis ulang"}</button>
          <button type="button" className={secondaryButtonClassName} onClick={() => setOpen(false)}>Batal</button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-1">
      <button type="button" disabled={pending} className={primaryButtonClassName} onClick={() => (needsReason ? setOpen(true) : void send(null))}>
        {pending ? "Memproses…" : needsReason ? "Analisis ulang" : "Buat analisis AI"}
      </button>
      {error ? <p role="alert" className="text-sm text-clay-600">{error}</p> : null}
    </div>
  );
}

/**
 * Appends a review decision. A simulated result cannot be approved as real
 * support, so that option is not offered at all and the server refuses it too.
 */
export function AnalysisReviewForm({ analysisId, simulated, canDecide, canMarkRevision }: { analysisId: string; simulated: boolean; canDecide: boolean; canMarkRevision: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const options = [
    ...(canDecide && !simulated ? (["support_approved"] as const) : []),
    ...(canMarkRevision ? (["needs_revision"] as const) : []),
    ...(canDecide ? (["rejected"] as const) : []),
  ];
  if (options.length === 0) return <p className="text-sm text-ink-500">Peran Anda dapat membaca hasil ini, tetapi tidak mencatat keputusan review.</p>;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    setError("");
    setPending(true);
    void api(`/api/ai/analyses/${analysisId}/reviews`, "POST", {
      disposition: String(form.get("disposition") ?? ""),
      comment: String(form.get("comment") ?? "").trim(),
    })
      .then(() => { element.reset(); router.refresh(); })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setPending(false));
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <Field label="Keputusan review" htmlFor="disposition" hint={simulated ? "Hasil simulasi tidak dapat disetujui sebagai dukungan nyata." : undefined}>
        <select id="disposition" name="disposition" required className={inputClassName} defaultValue={options[0]}>
          {options.map((option) => <option key={option} value={option}>{AI_DISPOSITION_LABELS[option]}</option>)}
        </select>
      </Field>
      <Field label="Catatan review (wajib)" htmlFor="comment" hint="Tuliskan dasar keputusan; catatan ini tersimpan permanen bersama hasil.">
        <textarea id="comment" name="comment" required minLength={5} maxLength={2000} rows={3} className={inputClassName} />
      </Field>
      {error ? <p role="alert" className="text-sm text-clay-600">{error}</p> : null}
      <button disabled={pending} className={primaryButtonClassName}>{pending ? "Menyimpan…" : "Simpan keputusan"}</button>
    </form>
  );
}
