"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Field, inputClassName, primaryButtonClassName } from "@/components/ui";
import { api } from "@/lib/client-api";
import { MAX_CHAT_QUESTION_CHARS } from "@/lib/ai/chat-prompt";

/**
 * Client controls for the discussion assistant. Both forms send an idempotency
 * key created before the request, so a double tap or a retry on a slow local
 * model cannot spend the daily quota twice.
 */
export function NewThreadForm({ childOptions }: { childOptions: { id: string; name: string; code: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const childId = String(form.get("childId") ?? "");
    setError("");
    setPending(true);
    void api<{ thread: { id: string } }>("/api/ai-chat", "POST", {
      title: String(form.get("title") ?? "").trim(),
      childId: childId === "" ? null : childId,
    })
      .then((detail) => router.push(`/chat/${detail.thread.id}`))
      .catch((cause: Error) => {
        setError(cause.message);
        setPending(false);
      });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Topik diskusi" htmlFor="thread-title" hint="Mis. “Pendampingan harian setelah siklus pertama”.">
        <input id="thread-title" name="title" required minLength={3} maxLength={120} className={inputClassName} />
      </Field>
      <Field
        label="Anak asuh yang dibahas"
        htmlFor="thread-child"
        hint="Pilih anak agar asisten membaca siklus, asesmen, dan analisis anak itu. Tanpa pilihan, asisten hanya membaca angka ringkasan panti."
      >
        <select id="thread-child" name="childId" className={inputClassName} defaultValue="">
          <option value="">Diskusi umum panti (tanpa anak tertentu)</option>
          {childOptions.map((child) => (
            <option key={child.id} value={child.id}>{child.name} · {child.code}</option>
          ))}
        </select>
      </Field>
      {error ? <p role="alert" className="text-sm text-clay-600">{error}</p> : null}
      <button disabled={pending} className={primaryButtonClassName}>{pending ? "Membuka…" : "Mulai diskusi"}</button>
    </form>
  );
}

/**
 * Sends one turn. The answer is not streamed: the server stores the question,
 * calls the local model once, stores the answer, and the screen is refreshed
 * from the database so what staff read is exactly what was retained.
 */
export function Composer({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    void api(`/api/ai-chat/${threadId}/messages`, "POST", {
      question: question.trim(),
      idempotencyKey: crypto.randomUUID(),
    })
      .then(() => {
        setQuestion("");
        router.refresh();
      })
      // The question stays in the box on failure, so a timeout on the local
      // model does not cost the staff member what they typed.
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setPending(false));
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <Field label="Pertanyaan Anda" htmlFor="chat-question" hint="Asisten hanya menjawab dari data panti ini. Tanyakan hal yang ada di basis data, bukan teori atau rujukan luar.">
        <textarea
          id="chat-question"
          name="question"
          required
          minLength={3}
          maxLength={MAX_CHAT_QUESTION_CHARS}
          rows={3}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          className={inputClassName}
        />
      </Field>
      {error ? <p role="alert" className="text-sm text-clay-600">{error}</p> : null}
      <button disabled={pending || question.trim().length < 3} className={primaryButtonClassName}>
        {pending ? "Membaca basis data…" : "Kirim pertanyaan"}
      </button>
    </form>
  );
}
