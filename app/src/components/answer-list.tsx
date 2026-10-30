import { Badge } from "./ui";
import { EMOTIONS, INSTRUMENTS, LIKERT_LABELS, SKIP_REMINDER, type Answer, type Module } from "@/lib/instruments";
import { ASSISTANCE_LABELS } from "@/lib/labels";

/**
 * Staff-only rendering of saved answers next to the exact instrument text.
 * Skipped and missing items are shown explicitly; nothing is scored.
 */
export function AnswerList({ module, answers, compact = false }: { module: Module; answers: Answer[]; compact?: boolean }) {
  const byId = new Map(answers.map((answer) => [answer.itemId, answer]));
  return (
    <ol className="space-y-3">
      {INSTRUMENTS[module].map((item) => {
        const answer = byId.get(item.id);
        return (
          <li key={item.id} className="print-keep rounded-xl border border-cream-200 bg-white p-3 text-sm">
            <p className="text-ink-500"><span className="font-mono text-xs text-ink-300">{item.id}</span> {item.text}{item.sensitive && !compact ? <span className="ml-2 text-xs text-clay-600">(sensitif · {SKIP_REMINDER})</span> : null}</p>
            <div className="mt-2">{answer ? <AnswerValue answer={answer} /> : <Badge tone="neutral">Belum diisi</Badge>}</div>
            {answer && answer.assistance !== "none" ? <p className="mt-1 text-xs text-sky-soft-600">Bantuan: {ASSISTANCE_LABELS[answer.assistance]}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}

function AnswerValue({ answer }: { answer: Answer }) {
  if (answer.state === "skipped") return <Badge tone="clay">Dilewati{answer.skipReason ? ` · ${answer.skipReason}` : ""}</Badge>;
  if (answer.state === "not_applicable") return <Badge tone="neutral">Tidak berlaku</Badge>;
  switch (answer.kind) {
    case "text": return <p className="whitespace-pre-wrap text-ink-900">{answer.value}</p>;
    case "likert": return <p className="font-medium text-ink-900">{LIKERT_LABELS[(answer.value ?? 1) - 1]}</p>;
    case "emotion": return <p className="font-medium text-ink-900">{EMOTIONS.find((entry) => entry.value === answer.value)?.label}</p>;
    case "media":
      if (answer.activityMode === "paper_pending") return <Badge tone="sky">Digambar di kertas · foto menyusul</Badge>;
      return answer.initialAttachmentId ? (
        // eslint-disable-next-line @next/next/no-img-element -- private no-store endpoint, not optimizable
        <img src={`/api/attachments/${answer.initialAttachmentId}/content`} alt="Gambar aktivitas anak" className="max-h-72 rounded-lg border border-cream-200 bg-white" />
      ) : null;
  }
}
