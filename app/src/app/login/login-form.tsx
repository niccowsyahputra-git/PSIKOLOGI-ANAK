"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Field,
  inputClassName,
  primaryButtonClassName,
} from "@/components/ui";

type ApiFailure = {
  error?: {
    code?: string;
    message?: string;
    fieldErrors?: Record<string, string[]>;
  };
};

/**
 * Local login form (FR-01). There is no signup link: accounts are created by an
 * administrator, so failures always read the same non-informative way.
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setMessage(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/session/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiFailure;
        setMessage(
          body.error?.message ?? "Tidak dapat masuk. Periksa kembali data Anda.",
        );
        setFieldErrors(body.error?.fieldErrors ?? {});
        return;
      }

      setPassword("");
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setMessage("Server lokal tidak merespons. Pastikan aplikasi masih berjalan.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {message ? (
        <p
          className="rounded-xl border border-clay-500/30 bg-clay-100 px-3 py-2 text-sm text-clay-600"
          role="alert"
        >
          {message}
        </p>
      ) : null}

      <Field
        label="Email"
        htmlFor="email"
        error={fieldErrors.email?.[0]}
        hint="Gunakan email yang didaftarkan administrator panti."
      >
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputClassName}
          placeholder="nama@panti.local"
        />
      </Field>

      <Field
        label="Kata sandi"
        htmlFor="password"
        error={fieldErrors.password?.[0]}
        hint="Minimal 12 karakter. Maksimal 5 percobaan per menit."
      >
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClassName}
          placeholder="••••••••••••"
        />
      </Field>

      <button type="submit" disabled={pending} className={`${primaryButtonClassName} w-full`}>
        {pending ? "Memeriksa…" : "Masuk"}
      </button>

      <p className="text-center text-xs text-ink-500">
        Belum punya akun? Administrator panti perlu membuatkannya lewat panel
        Pengguna. Pendaftaran mandiri dinonaktifkan.
      </p>
    </form>
  );
}
