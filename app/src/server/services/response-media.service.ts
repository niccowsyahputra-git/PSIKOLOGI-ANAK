import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDbReady } from "@/lib/db";
import { responseAttachments, responseAttachmentEvents } from "@/lib/db/response-schema";
import { getEnv } from "@/lib/env";
import { ensurePrivateDirectory } from "@/lib/paths";
import { sha256Hex } from "@/lib/crypto";
import { compileDefinition, visibleQuestionIds, normalizeAnswers } from "@/lib/assessment-builder/definition";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { normalizeImage, MAX_IMAGE_BYTES } from "./media.service";
import { authorizeResponse, assertResponseGate, loadResponse, readResponseAnswers, responseDefinition, responseAuditActor, type ResponseActor } from "./response.service";
import { recordAudit } from "./audit.service";
import type { TemplateExecutor } from "./template.service";

async function uploadGate(tx: TemplateExecutor, org: string, responseId: string, questionId: string, actor: ResponseActor) {
  const row = await loadResponse(tx, org, responseId); await authorizeResponse(tx, row, actor, true);
  if (row.status !== "draft") throw new ConflictError("Gambar hanya untuk draft.");
  const { definition } = await assertResponseGate(tx, row, true);
  const q = definition.questions.find((q) => q.id === questionId);
  if (q?.type !== "file" || !visibleQuestionIds(compileDefinition(definition), await readResponseAnswers(tx, row)).has(questionId)) throw new ValidationError("Pertanyaan gambar tidak aktif atau tersembunyi.");
  return row;
}
export async function uploadResponseMedia(org: string, responseId: string, questionId: string, file: File, actor: ResponseActor) {
  const db = await getDbReady(); await uploadGate(db, org, responseId, questionId, actor);
  const bytes = await normalizeImage(file); const id = randomUUID(); const storageKey = `${id}.png`;
  ensurePrivateDirectory(getEnv().storage.rootAbsolutePath);
  await writeFile(path.join(getEnv().storage.rootAbsolutePath, storageKey), bytes, { mode: 0o600, flag: "wx" });
  // An interrupted transaction can leave only a private, unreferenced file.
  return db.transaction(async (tx) => {
    const row = await uploadGate(tx, org, responseId, questionId, actor);
    await tx.insert(responseAttachments).values({ id, organizationId: org, responseId, templateVersionId: row.templateVersionId, questionId, storageKey, mime: "image/png", size: bytes.length, sha256: sha256Hex(bytes), actorStaffId: actor.type === "staff" ? actor.staff.membershipId : null, actorSessionId: actor.type === "participant" ? actor.sessionId : null });
    await tx.insert(responseAttachmentEvents).values({ organizationId: org, responseId, attachmentId: id });
    await recordAudit(tx, { organizationId: org, actor: responseAuditActor(actor), action: "response.attachment_upload", entityType: "assessment_responses", entityId: responseId, metadata: { questionId, attachmentId: id } });
    return { id, mime: "image/png", size: bytes.length };
  });
}
export async function responseMediaContent(org: string, attachmentId: string, actor: ResponseActor) {
  const db = await getDbReady(); const [file] = await db.select().from(responseAttachments).where(and(eq(responseAttachments.id, attachmentId), eq(responseAttachments.organizationId, org)));
  if (!file) throw new NotFoundError(); const row = await loadResponse(db, org, file.responseId); await authorizeResponse(db, row, actor);
  if (actor.type === "participant" || row.status === "draft") await assertResponseGate(db, row, true);
  const { definition } = await responseDefinition(db, row);
  const answers = normalizeAnswers(compileDefinition(definition), await readResponseAnswers(db, row));
  if (!answers.some((a) => a.questionId === file.questionId && a.state === "answered" && a.value === file.id)) throw new NotFoundError();
  if (!/^[0-9a-f-]{36}\.png$/.test(file.storageKey)) throw new NotFoundError();
  const bytes = await readFile(path.join(getEnv().storage.rootAbsolutePath, file.storageKey));
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline; filename=intake.png", "Cross-Origin-Resource-Policy": "same-origin" } });
}
export async function responseUploadBody(request: Request) {
  const limit = MAX_IMAGE_BYTES + 65536;
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw new ValidationError("Gambar maksimal 5 MB.");
  const reader = request.body?.getReader(); if (!reader) throw new ValidationError();
  const parts: Uint8Array[] = []; let size = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new ValidationError("Gambar maksimal 5 MB."); } parts.push(value); } } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  let form: FormData;
  try { form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(); } catch { throw new ValidationError("Format unggahan tidak valid."); }
  if ([...form.keys()].some((key) => !["file", "questionId", "responseId"].includes(key)) || [...new Set(form.keys())].some((key) => form.getAll(key).length !== 1)) throw new ValidationError("Field unggahan tidak valid.");
  const file = form.get("file"); const questionId = form.get("questionId"); const responseId = form.get("responseId");
  if (!(file instanceof File) || typeof questionId !== "string") throw new ValidationError("Pertanyaan dan gambar diperlukan.");
  return { file, questionId, responseId };
}
