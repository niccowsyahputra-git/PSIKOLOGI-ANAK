import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { AI_PRIORITY_LABELS, AI_TIMEFRAME_LABELS } from "@/lib/labels";
import type { AiResult } from "@/lib/ai/result.schema";

/**
 * Renders one stored AI result (FR-11). Every section keeps the evidence links
 * visible, because the point of this screen is to send staff back to the real
 * answers rather than to let a summary stand on its own.
 */
function EvidenceRefs({ refs }: { refs: AiResult["attentionIndicators"][number]["sourceAnswerRefs"] }) {
  if (refs.length === 0) return null;
  return (
    <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
      <span className="text-ink-500">Dasar jawaban:</span>
      {refs.map((ref) => (
        <Link key={`${ref.assessmentId}-${ref.itemId}`} href={`/assessments/${ref.assessmentId}`} className="rounded-full border border-cream-300 px-2 py-0.5 text-sage-700 underline">
          {ref.itemId}
        </Link>
      ))}
    </p>
  );
}

function TextSection({ title, items, empty }: { title: string; items: readonly string[]; empty: string }) {
  return (
    <Card className="print-keep space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {items.length === 0 ? <p className="text-sm text-ink-500">{empty}</p> : (
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-700">{items.map((item, index) => <li key={index} className="whitespace-pre-wrap">{item}</li>)}</ul>
      )}
    </Card>
  );
}

export function AnalysisResult({ result, simulated }: { result: AiResult; simulated: boolean }) {
  return (
    <div className="space-y-5">
      <Card className="print-keep space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Ringkasan</h2>
          <Badge tone={simulated ? "clay" : "sky"}>{AI_PRIORITY_LABELS[result.supportPriority] ?? result.supportPriority}</Badge>
        </div>
        <p className="whitespace-pre-wrap text-sm text-ink-700">{result.summary}</p>
      </Card>

      {result.safetyConcern.present ? (
        <Card className="print-keep space-y-2 border-clay-100 bg-clay-100/40">
          <h2 className="text-base font-semibold text-clay-600">Perlu tinjauan manusia segera</h2>
          <p className="whitespace-pre-wrap text-sm text-ink-700">{result.safetyConcern.reason}</p>
          <EvidenceRefs refs={result.safetyConcern.sourceAnswerRefs} />
          <p className="text-xs text-ink-500">Ini bukan tingkat risiko klinis. Jalankan SOP perlindungan anak panti dan libatkan psikolog.</p>
        </Card>
      ) : null}

      <TextSection title="Faktor pelindung" items={result.protectiveFactors} empty="Tidak ada yang dicatat." />

      <Card className="print-keep space-y-3">
        <h2 className="text-base font-semibold">Hal yang perlu diperhatikan</h2>
        {result.attentionIndicators.length === 0 ? <p className="text-sm text-ink-500">Tidak ada yang ditandai.</p> : (
          <ul className="space-y-3 text-sm">
            {result.attentionIndicators.map((indicator, index) => (
              <li key={index} className="print-keep rounded-xl bg-cream-50 p-3">
                <p className="whitespace-pre-wrap text-ink-700">{indicator.description}</p>
                <p className="mt-1.5 whitespace-pre-wrap text-xs text-ink-500">Ketidakpastian: {indicator.uncertainty}</p>
                <EvidenceRefs refs={indicator.sourceAnswerRefs} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="print-keep space-y-3">
        <h2 className="text-base font-semibold">Saran dukungan untuk pengasuh</h2>
        {result.caregiverSuggestions.length === 0 ? <p className="text-sm text-ink-500">Tidak ada saran.</p> : (
          <ul className="space-y-2 text-sm">
            {result.caregiverSuggestions.map((suggestion, index) => (
              <li key={index} className="print-keep rounded-xl bg-cream-50 p-3">
                <p className="flex flex-wrap items-center gap-2 font-medium text-ink-900"><span className="whitespace-pre-wrap">{suggestion.action}</span><Badge tone="neutral">{AI_TIMEFRAME_LABELS[suggestion.timeframe] ?? suggestion.timeframe}</Badge></p>
                <p className="mt-1 whitespace-pre-wrap text-xs text-ink-500">Tujuan: {suggestion.purpose}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <TextSection title="Komunikasi dengan orang tua / wali" items={result.guardianSuggestions} empty="Tidak ada saran komunikasi." />
      <TextSection title="Bahan tindak lanjut psikolog" items={result.psychologistFollowupPoints} empty="Tidak ada catatan." />
      <TextSection title="Batasan keluaran ini" items={result.limitations} empty="Tidak ada batasan yang dicatat." />
    </div>
  );
}
