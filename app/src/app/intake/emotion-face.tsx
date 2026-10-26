import { EMOTIONS } from "@/lib/instruments";

type Emotion = (typeof EMOTIONS)[number]["value"];
const FACE: Record<Emotion, { fill: string; mouth: string; brows?: string; eye: number; open?: boolean }> = {
  senang: { fill: "#f9d56e", mouth: "M30 58 Q50 76 70 58", eye: 4 },
  biasa: { fill: "#f3e3b0", mouth: "M33 63 L67 63", eye: 4 },
  sedih: { fill: "#a9c7e8", mouth: "M31 70 Q50 54 69 70", brows: "M28 32 L42 28 M72 32 L58 28", eye: 4 },
  marah: { fill: "#f2a08b", mouth: "M32 68 Q50 58 68 68", brows: "M27 30 L43 38 M73 30 L57 38", eye: 4 },
  takut: { fill: "#cdbde9", mouth: "", brows: "M28 30 Q35 22 42 28 M58 28 Q65 22 72 30", eye: 6, open: true },
};

/** Labeled SVG faces for A01; the label is always visible, never colour-only. */
export function EmotionFace({ value, selected }: { value: Emotion; selected: boolean }) {
  const face = FACE[value];
  return (
    <svg viewBox="0 0 100 100" className={`h-20 w-20 sm:h-24 sm:w-24 transition-transform ${selected ? "scale-110" : ""}`} aria-hidden="true">
      <circle cx="50" cy="50" r="44" fill={face.fill} stroke={selected ? "#3f6b55" : "#2b342f"} strokeWidth={selected ? 5 : 2.5} />
      <circle cx="36" cy="42" r={face.eye} fill="#2b342f" />
      <circle cx="64" cy="42" r={face.eye} fill="#2b342f" />
      {face.brows ? <path d={face.brows} stroke="#2b342f" strokeWidth="3" strokeLinecap="round" fill="none" /> : null}
      {face.open ? <ellipse cx="50" cy="66" rx="8" ry="10" fill="#2b342f" /> : <path d={face.mouth} stroke="#2b342f" strokeWidth="3.5" strokeLinecap="round" fill="none" />}
    </svg>
  );
}
