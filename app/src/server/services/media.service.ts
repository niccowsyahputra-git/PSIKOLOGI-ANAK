import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { and, eq, isNull } from "drizzle-orm";
import { getDbReady } from "@/lib/db";
import * as s from "@/lib/db/assessment-schema";
import { getEnv } from "@/lib/env";
import { ensurePrivateDirectory } from "@/lib/paths";
import { sha256Hex } from "@/lib/crypto";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertGate, assessment, cycle, validSession, type IntakeRow } from "./assessment.service";
import { recordAudit, type AuditActor } from "./audit.service";
import type { Answer } from "@/lib/instruments";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export async function normalizeImage(file: File): Promise<Buffer> {
  if (!file.size || file.size > MAX_IMAGE_BYTES || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new ValidationError("Gunakan gambar PNG, JPG, atau WebP maksimal 5 MB");
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const decoder = sharp(bytes, { limitInputPixels: 16000000, animated: false, failOn: "warning" });
    const metadata = await decoder.metadata();
    const declared = { "image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp" }[file.type];
    if (metadata.format !== declared || (metadata.pages ?? 1) > 1) throw new Error("Invalid image");
    return await decoder.rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch { throw new ValidationError("Isi gambar tidak valid. Metadata foto tidak disimpan."); }
}
export async function uploadMedia(org: string, assessmentId: string, file: File, actor: AuditActor, late = false) {
  const db = await getDbReady(); const a = await assessment(db, org, assessmentId);
  if (a.module !== "A" || a.status !== (late ? "submitted" : "draft") || late && actor.type !== "staff") throw new ConflictError("Lampiran tidak diizinkan pada asesmen ini");
  if (late && !(JSON.parse(a.answersJson) as Answer[]).some((v) => v.kind === "media" && v.state === "answered" && v.activityMode === "paper_pending")) throw new ConflictError("Lampiran susulan hanya untuk gambar kertas yang belum diunggah");
  const c = await cycle(db, org, a.cycleId); await assertGate(db, c, a.target, a.guardianId, true);
  const bytes = await normalizeImage(file); const id = randomUUID(); const storageKey = `${id}.png`; const root = getEnv().storage.rootAbsolutePath; ensurePrivateDirectory(root);
  await writeFile(path.join(root, storageKey), bytes, { mode: 0o600, flag: "wx" });
  // A failed transaction leaves an unreferenced private file, never an accessible attachment.
  return db.transaction(async (tx) => { const current = await assessment(tx, org, assessmentId); if (current.status !== a.status) throw new ConflictError(); if (actor.type === "participant") { const scoped = await validSession(tx, actor.sessionId); if (scoped.assessmentId !== a.id) throw new NotFoundError(); } await assertGate(tx, await cycle(tx, org, a.cycleId), a.target, a.guardianId, true);
    const actorStaffId = actor.type === "staff" ? actor.membershipId : null; const actorSessionId = actor.type === "participant" ? actor.sessionId : null;
    await tx.insert(s.attachments).values({ id, organizationId: org, childId: a.childId, assessmentId, storageKey, mime: "image/png", size: bytes.length, sha256: sha256Hex(bytes), status: "ready", actorStaffId, actorSessionId });
    await tx.insert(s.attachmentEvents).values({ organizationId: org, assessmentId, attachmentId: id, actorStaffId, actorSessionId, eventType: late ? "late_uploaded" : "uploaded" }); await recordAudit(tx, { organizationId: org, actor, action: late ? "attachment.late_upload" : "attachment.upload", entityType: "attachments", entityId: id, metadata: { assessmentId } }); return { id, mime: "image/png", size: bytes.length };
  });
}
export async function mediaContent(org: string, id: string, participant?: IntakeRow) {
  const db = await getDbReady(); const [file] = await db.select().from(s.attachments).where(and(eq(s.attachments.id, id), eq(s.attachments.organizationId, org), eq(s.attachments.status, "ready"), isNull(s.attachments.archivedAt)));
  if (!file || participant && file.assessmentId !== participant.assessmentId) throw new NotFoundError(); const a = await assessment(db, org, file.assessmentId); if (a.status === "withdrawn") throw new NotFoundError(); if (participant) await validSession(db, participant.id);
  if (!/^[0-9a-f-]{36}\.png$/.test(file.storageKey)) throw new NotFoundError(); const bytes = await readFile(path.join(getEnv().storage.rootAbsolutePath, file.storageKey));
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline; filename=activity.png", "Cross-Origin-Resource-Policy": "same-origin" } });
}
