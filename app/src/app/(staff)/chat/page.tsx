import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChatIcon, ChevronRightIcon } from "@/components/icons";
import { Badge, Card, EmptyState, LoadingState, PageHeader } from "@/components/ui";
import { requireStaffSession, toStaffActor } from "@/lib/authz";
import { formatDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { listThreads } from "@/server/services/ai-chat.service";
import { aiAvailability } from "@/server/services/ai.service";
import { listProfiles } from "@/server/services/assessment.service";
import { NewThreadForm } from "./chat-forms";

export const metadata: Metadata = { title: "Diskusi AI" };

/**
 * Index of discussion threads. The boundary card is not decoration: staff need
 * to know, before they type, that this assistant reads only the rows in this
 * installation and that free-text notes are never sent to it.
 */
async function Threads() {
  const session = await requireStaffSession();
  if (!can(session.membership.role, "ai.chat")) {
    return <EmptyState title="Akses ditolak" description="Diskusi AI hanya untuk pengasuh, ketua panti, psikolog, dan administrator." />;
  }
  const actor = toStaffActor(session);
  const timezone = session.organization.timezone;
  const [threads, availability, children] = await Promise.all([
    listThreads(actor),
    aiAvailability(actor),
    listProfiles(actor, "children"),
  ]);
  const childOptions = children.rows
    .filter((child) => child.profileState !== "archived")
    .map((child) => ({ id: child.id, name: child.name, code: child.code }));

  return (
    <div className="space-y-4">
      <Card className="space-y-2 text-[13px] leading-relaxed text-ink-700">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ink-900">
          <ChatIcon size={18} className="text-sage-600" /> Apa yang dibaca asisten
        </h2>
        <p>
          Asisten hanya membaca basis data panti ini: status profil, siklus, asesmen yang sudah terkirim, dan analisis AI
          beserta keputusan review. Tidak ada internet, berkas luar, atau data panti lain.
        </p>
        <p>
          Yang tidak pernah dikirim: nama, tanggal lahir, kontak, alamat, catatan bebas staf, catatan pengamatan, dan
          berkas gambar. Anak dan wali disebut dengan alias seperti “Anak” dan “WALI-1”.
        </p>
        <p>
          Jawaban peserta hanya disertakan untuk siklus yang persetujuan AI-nya diberikan, atau siklus latihan fiktif —
          aturan yang sama dengan analisis AI.
        </p>
        <p className="text-ink-500">
          Asisten tidak dilatih ulang dari data ini dan tidak mengingat apa pun di luar diskusi yang tersimpan: setiap
          pertanyaan dibaca ulang dari basis data. Jawabannya dapat salah dan bukan penilaian psikologis.
        </p>
      </Card>

      <Card className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex-1 text-base font-semibold text-ink-900">Mulai diskusi baru</h2>
          {availability.simulated ? <Badge tone="clay">Simulasi</Badge> : null}
          <Badge tone="neutral">{availability.usedToday}/{availability.dailyLimit} permintaan hari ini</Badge>
        </div>
        {availability.reason ? (
          <p className="rounded-2xl bg-clay-100/60 px-3.5 py-2.5 text-[13px] text-ink-700">{availability.reason}</p>
        ) : null}
        {availability.simulated ? (
          <p className="rounded-2xl bg-clay-100/60 px-3.5 py-2.5 text-[13px] text-ink-700">
            Mode simulasi aktif: balasan dirangkai aturan tetap di laptop ini, bukan oleh model bahasa. Gunakan untuk
            menguji alur diskusi saja.
          </p>
        ) : null}
        <NewThreadForm childOptions={childOptions} />
      </Card>

      {threads.length === 0 ? (
        <EmptyState title="Belum ada diskusi" description="Diskusi yang Anda buat tersimpan di perangkat ini dan dapat dibaca staf lain di panti yang sama." />
      ) : (
        <Card className="p-1.5">
          <ul className="space-y-1">
            {threads.map((thread) => (
              <li key={thread.id}>
                <Link href={`/chat/${thread.id}`} prefetch={false} className="flex min-h-[60px] items-center gap-2 rounded-2xl px-3 py-2 active:bg-cream-100">
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[13px] font-medium">{thread.title}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-500">
                      {thread.childName ? `Anak: ${thread.childName}` : "Diskusi umum panti"} · {thread.messageCount} pesan ·{" "}
                      {formatDateTime(thread.lastMessageAt ?? thread.createdAt, timezone)}
                    </span>
                  </span>
                  <ChevronRightIcon size={16} className="flex-none text-ink-300" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="pb-2 text-[11px] leading-relaxed text-ink-500">
        Pertanyaan dan jawaban tersimpan permanen dan tidak dapat diubah atau dihapus, sehingga dasar sebuah keputusan
        pendampingan tetap dapat ditelusuri.
      </p>
    </div>
  );
}

export default function ChatPage() {
  return (
    <>
      <PageHeader
        title="Diskusi AI"
        description="Tanya jawab dengan asisten lokal tentang data panti ini. Bukan penilaian psikologis dan bukan pengganti tinjauan manusia."
      />
      <Suspense fallback={<LoadingState label="Memuat diskusi…" rows={5} />}>
        <Threads />
      </Suspense>
    </>
  );
}
