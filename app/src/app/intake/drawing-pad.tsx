"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { primaryButtonClassName, secondaryButtonClassName } from "@/components/ui";

type Stroke = { color: string; points: [number, number][] };
const COLORS = [
  { value: "#2b342f", label: "Hitam" }, { value: "#d64545", label: "Merah" }, { value: "#f0a92e", label: "Kuning" },
  { value: "#4f9d69", label: "Hijau" }, { value: "#3b7fc4", label: "Biru" }, { value: "#8e5bb5", label: "Ungu" },
] as const;
const RATIO = 0.75;
const WIDTH = 0.012;

/** Strokes are stored in normalized 0..1 coordinates so resizing redraws them without distortion. */
function paint(context: CanvasRenderingContext2D, strokes: Stroke[], width: number, height: number) {
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height);
  context.lineCap = "round"; context.lineJoin = "round"; context.lineWidth = Math.max(2, width * WIDTH);
  for (const stroke of strokes) {
    context.strokeStyle = stroke.color; context.beginPath();
    stroke.points.forEach(([x, y], index) => (index ? context.lineTo(x * width, y * height) : context.moveTo(x * width, y * height)));
    if (stroke.points.length === 1) context.lineTo(stroke.points[0][0] * width + 0.1, stroke.points[0][1] * height);
    context.stroke();
  }
}

export function DrawingPad({ onSave, saving }: { onSave: (blob: Blob) => void; saving: boolean }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const active = useRef<Stroke | null>(null);
  const [color, setColor] = useState<string>(COLORS[0].value);
  const [count, setCount] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);

  const redraw = useCallback(() => {
    const element = canvas.current; const context = element?.getContext("2d"); if (!element || !context) return;
    const all = active.current ? [...strokes.current, active.current] : strokes.current;
    paint(context, all, element.width, element.height);
  }, []);

  useEffect(() => {
    const box = wrapper.current; const element = canvas.current; if (!box || !element) return;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1; const width = box.clientWidth;
      element.style.width = `${width}px`; element.style.height = `${width * RATIO}px`;
      element.width = Math.round(width * ratio); element.height = Math.round(width * RATIO * ratio); redraw();
    };
    resize(); const observer = new ResizeObserver(resize); observer.observe(box);
    return () => observer.disconnect();
  }, [redraw]);

  function point(event: PointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))];
  }
  function down(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId); active.current = { color, points: [point(event)] }; redraw();
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!active.current) return; active.current.points.push(point(event)); redraw();
  }
  function up() {
    if (!active.current) return; strokes.current = [...strokes.current, active.current]; active.current = null; setCount(strokes.current.length); redraw();
  }
  function undo() { strokes.current = strokes.current.slice(0, -1); setCount(strokes.current.length); redraw(); }
  function clear() {
    if (!confirmClear) { setConfirmClear(true); return; }
    strokes.current = []; setCount(0); setConfirmClear(false); redraw();
  }
  function save() {
    const output = document.createElement("canvas"); output.width = 1200; output.height = 900;
    const context = output.getContext("2d"); if (!context) return;
    paint(context, strokes.current, output.width, output.height);
    output.toBlob((blob) => blob && onSave(blob), "image/png");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Warna">
        {COLORS.map((entry) => (
          <button key={entry.value} type="button" role="radio" aria-checked={color === entry.value} aria-label={entry.label} title={entry.label} onClick={() => setColor(entry.value)}
            className={`h-10 w-10 rounded-full border-4 ${color === entry.value ? "border-ink-900" : "border-white"} shadow`} style={{ backgroundColor: entry.value }} />
        ))}
      </div>
      <div ref={wrapper} className="overflow-hidden rounded-2xl border-2 border-cream-300 bg-white">
        <canvas ref={canvas} aria-label="Kanvas menggambar" className="block touch-none" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryButtonClassName} onClick={undo} disabled={!count}>↶ Urungkan</button>
        <button type="button" className={secondaryButtonClassName} onClick={clear} disabled={!count}>{confirmClear ? "Yakin hapus semua?" : "Hapus semua"}</button>
        {confirmClear ? <button type="button" className="text-sm text-ink-500 underline" onClick={() => setConfirmClear(false)}>Batal</button> : null}
        <button type="button" className={primaryButtonClassName} onClick={save} disabled={!count || saving}>{saving ? "Menyimpan gambar…" : "Simpan gambar"}</button>
      </div>
    </div>
  );
}
