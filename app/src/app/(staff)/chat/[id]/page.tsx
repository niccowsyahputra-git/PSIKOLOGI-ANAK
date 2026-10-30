import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeftIcon } from "@/components/icons";
import { Badge, Card, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { formatDateTime } from "@/lib/format";
import { orNotFound } from "@/lib/page-data";
import { can } from "@/lib/permissions";
import { threadDetail } from "@/server/services/ai-chat.service";
import { aiAvailability } from "@/server/services/ai.service";
import { Composer } from "../chat-forms";

export const metadata: Metadata = { title: "Diskusi AI" };

/**
 * One thread. Turns are rendered from the stored rows rather than from client
 * state, so the conversation on screen is exactly the append-only history that
 * was retained — a staff member cannot be shown an answer that was not saved.
 */
async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!can(session.membership.role, "ai.chat")) {
    return <EmptyState title="Akses ditolak" description="Diskusi AI hanya untuk pengasuh, ketua panti, psikolog, dan administrator." />;
  }
  const actor = toStaffActor(session);
  const { id } = await params;
  const { thread, messages } = await orNotFound(threadDetail(actor, id));
  const availability = await aiAvailability(actor);
  const timezone = session.organization.timezone;

  return (
    <div className="space-y-4">
      <Link href="/chat" prefetch={false} className="inline-flex items-center gap-1 text-[13px] font-medium text-sage-700">
        <ArrowLeftIcon size={16} /> Semua diskusi
      </Link>

      <PageHeader
        title={thread.title}
        description={`${thread.childName ? `Membahas ${thread.childName}` : "Diskusi umum panti"} · dibuka ${thread.createdByName ?? "staf"} pada ${formatDateTime(thread.createdAt, timezone)}`}
        actions={
          <>
            {thread.childId ? (
              <Link href={`/children/${thread.childId}`} prefetch={false} className="text-[13px] font-medium text-sage-700 underline">
                Profil anak
              </Link>
            ) : null}
            <Badge tone="neutral">{availability.usedToday}/{availability.dailyLimit} permintaan hari ini</Badge>
          </>
        }
      />

      {messages.length === 0 ? (
        <EmptyState
          title="Belum ada pertanyaan"
          description={
            thread.childId
              ? "Tanyakan hal yang ada di data anak ini, misalnya siklus mana yang sudah ditutup atau asesmen mana yang belum terkirim."
              : "Tanyakan hal yang ada di angka ringkasan panti, misalnya berapa siklus yang masih berjalan."
          }
        />
      ) : (
        <ul className="space-y-3">
          {messages.map((message) => (
            <li key={message.id}>
              {message.role === "staff" ? (
                <div className="ml-6 rounded-3xl rounded-br-lg border border-sage-200 bg-sage-50 px-4 py-3">
                  <p className="text-[11px] font-medium text-sage-700">{message.authorName ?? "Staf"} · {formatDateTime(message.createdAt, timezone)}</p>
                  <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-900">{message.content}</p>
                </div>
              ) : (
                <Card className="mr-6 rounded-bl-lg">
                  <p className="flex flex-wrap items-center gap-2 text-[11px] text-ink-500">
                    {message.simulated ? <Badge tone="clay">Simulasi</Badge> : <Badge tone="sky">Model lokal</Badge>}
                    <span>{message.provider ?? "—"}{message.model ? ` · ${message.model}` : ""}</span>
                    <span>· {formatDateTime(message.createdAt, timezone)}</span>
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-900">{message.content}</p>
                </Card>
              )}
            </li>
          ))}
        </ul>
      )}

      <Card className="space-y-2">
        {availability.reason ? (
          <p className="rounded-2xl bg-clay-100/60 px-3.5 py-2.5 text-[13px] text-ink-700">{availability.reason}</p>
        ) : null}
        <Composer threadId={thread.id} />
        <p className="text-[11px] leading-relaxed text-ink-500">
          Setiap pertanyaan membaca ulang basis data panti ini. Jika sebuah fakta tidak ada di sana, asisten harus
          mengatakannya dan tidak boleh mengarang. Tinjauan manusia tetap wajib sebelum keputusan pendampingan.
        </p>
      </Card>
    </div>
  );
}

export default function ChatThreadPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<Skeleton rows={8} />}>
      <Thread params={params} />
    </Suspense>
  );
}
