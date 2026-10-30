import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { MOCK_CHAT_NOTICE, MOCK_CHAT_PROVIDER } from "@/lib/ai/chat-mock";
import { CHAT_SYSTEM_PROMPT } from "@/lib/ai/chat-prompt";
import { LocalModelError } from "@/lib/ai/local-model";
import { closeDb, getDbReady, type AppDatabase } from "@/lib/db";
import { aiChatMessages, aiChatThreads, aiUsageCounters } from "@/lib/db/ai-schema";
import { auditLogs } from "@/lib/db/domain-schema";
import { resetEnvCacheForTests } from "@/lib/env";
import { NotFoundError, NotReadyError, RateLimitError } from "@/lib/errors";
import { INSTRUMENTS, type Answer, type Module } from "@/lib/instruments";
import { resolveFromProjectRoot } from "@/lib/paths";
import { ensureAiSettings, updateAiSettingsRow, type AiSettingsPatch } from "@/server/repositories/ai-settings.repository";
import { createOrganization } from "@/server/repositories/organization.repository";
import * as aiChat from "@/server/services/ai-chat.service";
import * as service from "@/server/services/assessment.service";
import { createStaffAccount, ensureStaffAccount, type StaffActor } from "@/server/services/staff.service";

let tempDir: string;
let db: AppDatabase;
let admin: StaffActor;
let pengasuh: StaffActor;
let ketua: StaffActor;
let psikolog: StaffActor;
let outsider: StaffActor;

let childId: string;
let guardianId: string;
let cycleId: string;
let childAssessmentId: string;
let orgThreadId: string;
let threadId: string;
let firstQuestionId: string;

const today = new Date().toISOString().slice(0, 10);
const key = () => crypto.randomUUID();
const dateKeyNow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function staff(organizationId: string, email: string, role: StaffActor["role"]): Promise<StaffActor> {
  const result = await ensureStaffAccount(db, { organizationId, email, name: `Staf ${role}`, password: "StafLokal2026!", role, actorLabel: "test" });
  return { membershipId: result.membershipId, authUserId: result.authUserId, organizationId, role };
}

async function configureAi(organizationId: string, patch: AiSettingsPatch = {}): Promise<void> {
  const current = await ensureAiSettings(db, organizationId);
  await updateAiSettingsRow(db, { organizationId, expectedRevision: current.revision, patch: { enabled: true, dailyLimit: 60, mode: "mock", ...patch } });
}

function fullAnswers(module: Module): Answer[] {
  return INSTRUMENTS[module].map((item, index) => {
    if (item.kind === "likert") return { itemId: item.id, kind: "likert", state: "answered", assistance: "none", value: (index % 5) + 1 };
    if (item.kind === "emotion") return { itemId: "A01", kind: "emotion", state: "answered", assistance: "none", value: "sedih" };
    if (item.kind === "media") return { itemId: "A02", kind: "media", state: "answered", assistance: "none", activityMode: "paper_pending", initialAttachmentId: null };
    return item.sensitive
      ? { itemId: item.id, kind: "text", state: "skipped", assistance: "none", value: null }
      : { itemId: item.id, kind: "text", state: "answered", assistance: "none", value: `Jawaban fiktif ${item.id}` };
  });
}

/** Hands an assessment in through a participant session, as the real flow does. */
async function submitAssessment(cycle: string, assessmentId: string, module: Module): Promise<void> {
  const created = await service.createIntakeSession(pengasuh, cycle, { assessmentId });
  const { secret } = await service.exchangeIntake(created.id, created.token, null);
  const row = await service.resolveIntake(secret);
  const current = await service.assessment(db, row.organizationId, assessmentId);
  await service.saveAssessment(db, row.organizationId, assessmentId, { revision: current.revision, answers: fullAnswers(module) }, { type: "participant", sessionId: row.id }, true);
}

async function verifiedProfile(kind: "children" | "guardians", input: Record<string, unknown>): Promise<string> {
  const profile = await service.createProfile(pengasuh, kind, { name: kind === "children" ? "Anak Fiktif" : "Wali Fiktif", fictional: true, ...input });
  await service.profileTransition(pengasuh, kind, profile.id, "verify", { revision: profile.revision });
  return profile.id;
}

const lastAnswerOf = (detail: aiChat.ChatThreadDetail) => detail.messages.filter((message) => message.role === "assistant").at(-1);

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "panti-chat-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_MODE: "local-development",
    LOCAL_ONLY: "true",
    DATABASE_PROVIDER: "local",
    DATABASE_URL: `file:${path.join(tempDir, "test.db")}`,
    STORAGE_PROVIDER: "local",
    LOCAL_STORAGE_ROOT: path.join(tempDir, "storage"),
    BACKUP_ROOT: path.join(tempDir, "backups"),
    AI_MODE: "mock",
    LOCAL_AI_ALLOWED_ENDPOINTS: "http://127.0.0.1:11434",
    LIVE_INTAKE_ENABLED: "true",
    BETTER_AUTH_SECRET: "e".repeat(48),
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
  resetEnvCacheForTests();
  db = await getDbReady();
  await migrate(db, { migrationsFolder: resolveFromProjectRoot("migrations") });

  const home = await createOrganization(db, { name: "Panti Diskusi", timezone: "Asia/Jakarta" });
  const other = await createOrganization(db, { name: "Panti Lain", timezone: "Asia/Jakarta" });
  admin = await staff(home.id, "admin@chat.test", "admin");
  pengasuh = await staff(home.id, "pengasuh@chat.test", "pengasuh");
  ketua = await staff(home.id, "ketua@chat.test", "ketua");
  outsider = await staff(other.id, "pengasuh@lain.test", "pengasuh");
  // The other organization is configured too, so an isolation test proves
  // isolation instead of accidentally hitting the "not configured" refusal.
  await configureAi(other.id);
  const created = await createStaffAccount(db, {
    actor: admin,
    input: { name: "Psikolog Uji", email: "psikolog@chat.test", password: "PsikologLokal2026!", role: "psikolog", credentialReference: "STR-1234509876", chairpersonConfirmation: true },
  });
  psikolog = { membershipId: created.membershipId, authUserId: created.authUserId, organizationId: home.id, role: "psikolog" };

  childId = await verifiedProfile("children", { estimatedAge: 15, ageReferenceDate: today, background: ["kehilangan_ayah"], accessibility: "Perlu pendampingan membaca", notes: "Catatan pengasuh menyebut nama kerabat" });
  guardianId = await verifiedProfile("guardians", {});
  await service.linkGuardian(pengasuh, childId, { guardianId, relationship: "Nenek", isPrimary: true });
  cycleId = (await service.createCycle(pengasuh, childId)).id;
  childAssessmentId = (await service.createAssessment(pengasuh, cycleId, { target: "child" })).id;
  await submitAssessment(cycleId, childAssessmentId, "C");
});

afterAll(async () => {
  await closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("opening a discussion", () => {
  it("refuses while the admin has not enabled AI", async () => {
    await expect(aiChat.createThread(pengasuh, { title: "Diskusi pertama", childId: null })).rejects.toThrow(NotReadyError);
  });

  it("opens an organization thread and a child thread", async () => {
    await configureAi(pengasuh.organizationId);
    const organization = await aiChat.createThread(pengasuh, { title: "Gambaran panti minggu ini", childId: null });
    orgThreadId = organization.thread.id;
    expect(organization.thread.childId).toBeNull();
    expect(organization.messages).toHaveLength(0);

    const scoped = await aiChat.createThread(ketua, { title: "Pendampingan harian anak ini", childId });
    threadId = scoped.thread.id;
    expect(scoped.thread.childName).toBe("Anak Fiktif");
    expect(scoped.thread.createdByName).toBe("Staf ketua");
  });

  it("refuses an empty topic and a child from another organization", async () => {
    await expect(aiChat.createThread(pengasuh, { title: "x", childId: null })).rejects.toThrow(ZodError);
    await expect(aiChat.createThread(pengasuh, { title: "Topik dengan bidang asing", childId: null, scope: "all" })).rejects.toThrow(ZodError);
    await expect(aiChat.createThread(outsider, { title: "Mencoba anak panti lain", childId })).rejects.toThrow(NotFoundError);
  });

  it("keeps threads inside their own organization", async () => {
    const mine = await aiChat.listThreads(pengasuh);
    expect(mine.map((thread) => thread.id)).toEqual(expect.arrayContaining([orgThreadId, threadId]));
    expect(await aiChat.listThreads(outsider)).toHaveLength(0);
    await expect(aiChat.threadDetail(outsider, threadId)).rejects.toThrow(NotFoundError);
  });
});

describe("one turn in mock mode", () => {
  it("answers without making any outbound call", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("mock mode must not reach the network")));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const detail = await aiChat.postMessage(ketua, threadId, { question: "Siklus mana yang sudah ditutup?", idempotencyKey: key() });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(detail.messages).toHaveLength(2);
      expect(detail.messages[0]).toMatchObject({ role: "staff", authorName: "Staf ketua", simulated: false });
      expect(detail.messages[1]).toMatchObject({ role: "assistant", simulated: true, provider: MOCK_CHAT_PROVIDER, model: null });
      expect(detail.messages[1].content.startsWith(MOCK_CHAT_NOTICE)).toBe(true);
      expect(detail.thread.lastMessageAt).not.toBeNull();
      firstQuestionId = detail.messages[0].id;
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("grounds the answer in the pack built from this database", async () => {
    const detail = await aiChat.threadDetail(pengasuh, threadId);
    const answer = lastAnswerOf(detail)?.content ?? "";
    expect(answer).toContain("SIKLUS-1");
    expect(answer).toContain("basis data lokal ini");
    // The alias exists precisely so no real name has to travel with the pack.
    expect(answer).not.toContain("Anak Fiktif");
    expect(answer).not.toContain("Wali Fiktif");
    expect(answer).not.toContain(childId);
  });

  it("never carries staff free text into the pack hash input or the answer", async () => {
    const detail = await aiChat.threadDetail(pengasuh, threadId);
    const stored = JSON.stringify(detail.messages);
    expect(stored).not.toContain("Perlu pendampingan membaca");
    expect(stored).not.toContain("Catatan pengasuh menyebut nama kerabat");
  });

  it("records both turns in the audit trail without the question text", async () => {
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.entityId, firstQuestionId));
    expect(rows.map((row) => row.action)).toContain("ai.chat.ask");
    expect(JSON.parse(rows[0].safeMetadata)).toMatchObject({ threadId, chatScope: "child", aiMode: "mock" });
    expect(rows[0].safeMetadata).not.toContain("Siklus mana yang sudah ditutup");
    const answers = await db.select().from(auditLogs).where(eq(auditLogs.action, "ai.chat.answer"));
    expect(answers.length).toBeGreaterThan(0);
    expect(JSON.parse(answers[0].safeMetadata)).toMatchObject({ resultOrigin: "mock" });
  });

  it("stores the pack hash on both turns, so an answer stays tied to what it read", async () => {
    const rows = await db.select().from(aiChatMessages).where(eq(aiChatMessages.threadId, threadId));
    expect(rows).toHaveLength(2);
    expect(rows[0].contextHash).toHaveLength(64);
    expect(rows[1].contextHash).toBe(rows[0].contextHash);
  });

  it("never lets a stored turn be edited or deleted", async () => {
    await expect(db.update(aiChatMessages).set({ content: "diubah" }).where(eq(aiChatMessages.id, firstQuestionId))).rejects.toThrow();
    await expect(db.delete(aiChatMessages).where(eq(aiChatMessages.id, firstQuestionId))).rejects.toThrow();
  });

  it("never lets the scope of a thread move to another child or organization", async () => {
    await expect(db.update(aiChatThreads).set({ childId: null }).where(eq(aiChatThreads.id, threadId))).rejects.toThrow();
    await expect(db.update(aiChatThreads).set({ organizationId: outsider.organizationId }).where(eq(aiChatThreads.id, threadId))).rejects.toThrow();
    // The activity column must still be writable, or no turn could be appended.
    await expect(db.update(aiChatThreads).set({ lastMessageAt: new Date() }).where(eq(aiChatThreads.id, threadId))).resolves.toBeTruthy();
  });

  it("returns the existing thread for a replayed key instead of asking twice", async () => {
    const replay = { question: "Apakah ada asesmen yang belum terkirim?", idempotencyKey: key() };
    const first = await aiChat.postMessage(pengasuh, threadId, replay);
    const second = await aiChat.postMessage(pengasuh, threadId, replay);
    expect(second.messages).toHaveLength(first.messages.length);
    const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(aiChatMessages).where(eq(aiChatMessages.idempotencyKey, replay.idempotencyKey));
    expect(Number(total)).toBe(1);
  });

  it("keeps the whole discussion readable to every staff role in the panti", async () => {
    const detail = await aiChat.threadDetail(psikolog, threadId);
    expect(detail.messages).toHaveLength(4);
    expect(detail.thread.messageCount).toBe(4);
    const listed = (await aiChat.listThreads(psikolog)).find((thread) => thread.id === threadId);
    expect(listed?.messageCount).toBe(4);
  });

  it("answers an organization thread from aggregate counts only", async () => {
    const detail = await aiChat.postMessage(pengasuh, orgThreadId, { question: "Berapa siklus yang masih berjalan?", idempotencyKey: key() });
    const answer = lastAnswerOf(detail)?.content ?? "";
    expect(answer).toContain("Wali tercatat:");
    expect(answer).not.toContain("SIKLUS-1");
    expect(answer).not.toContain("Jawaban fiktif");
  });
});

describe("a real local model", () => {
  it("sends the fixed prompt and the pack, and nothing else", async () => {
    const sent: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", vi.fn((url: URL | string, init: RequestInit) => {
      sent.push({ url: String(url), body: String(init.body) });
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "Menurut SIKLUS-1 belum ada asesmen wali.\nKeterbatasan: hanya dari basis data panti ini." } }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }));
    try {
      await configureAi(pengasuh.organizationId, { mode: "local_endpoint", baseUrl: "http://127.0.0.1:11434", model: "llama-lokal", providerName: "Ollama lokal" });
      const detail = await aiChat.postMessage(pengasuh, threadId, { question: "Apa yang perlu disiapkan staf?", idempotencyKey: key() });
      expect(lastAnswerOf(detail)).toMatchObject({ simulated: false, provider: "Ollama lokal", model: "llama-lokal" });

      expect(sent).toHaveLength(1);
      expect(sent[0].url).toBe("http://127.0.0.1:11434/v1/chat/completions");
      const payload = JSON.parse(sent[0].body) as { stream: boolean; messages: Array<{ role: string; content: string }> };
      expect(payload.stream).toBe(false);
      expect(payload.messages[0]).toEqual({ role: "system", content: CHAT_SYSTEM_PROMPT });
      expect(payload.messages[1].content).toContain("KONTEKS DATA");
      // The outbound request is the whole data boundary: whatever is not here
      // cannot reach the model, however the model is configured.
      expect(sent[0].body).not.toContain("Anak Fiktif");
      expect(sent[0].body).not.toContain("Wali Fiktif");
      expect(sent[0].body).not.toContain(childId);
      expect(sent[0].body).not.toContain("Catatan pengasuh menyebut nama kerabat");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the question, settles the quota and records the failure when the model is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("connection refused"))));
    try {
      const before = await aiChat.threadDetail(pengasuh, threadId);
      await expect(aiChat.postMessage(pengasuh, threadId, { question: "Pertanyaan saat model mati", idempotencyKey: key() })).rejects.toThrow(LocalModelError);
      const after = await aiChat.threadDetail(pengasuh, threadId);
      expect(after.messages).toHaveLength(before.messages.length + 1);
      expect(after.messages.at(-1)).toMatchObject({ role: "staff", content: "Pertanyaan saat model mati" });

      const failures = await db.select().from(auditLogs).where(eq(auditLogs.action, "ai.chat.fail"));
      expect(failures).toHaveLength(1);
      expect(JSON.parse(failures[0].safeMetadata).failureReason).toContain("tidak dapat dihubungi");
      const [counter] = await db.select().from(aiUsageCounters).where(and(eq(aiUsageCounters.organizationId, pengasuh.organizationId), eq(aiUsageCounters.dateKey, dateKeyNow())));
      expect(counter.reservedCount).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      await configureAi(pengasuh.organizationId);
    }
  });

  it("refuses a remote provider outright, whatever the saved configuration says", async () => {
    await configureAi(pengasuh.organizationId, { mode: "remote_endpoint", baseUrl: "https://api.contoh.test", model: "gpt-x" });
    await expect(aiChat.postMessage(pengasuh, threadId, { question: "Pertanyaan ke penyedia jarak jauh", idempotencyKey: key() })).rejects.toThrow(/local-only/);
    await expect(aiChat.createThread(pengasuh, { title: "Diskusi lewat penyedia luar", childId: null })).rejects.toThrow(/local-only/);
    await configureAi(pengasuh.organizationId);
  });
});

describe("AI consent on real data", () => {
  it("withholds a real child's answers from the pack until the AI consent is granted", async () => {
    // The whole lawful chain is built first, so the only thing missing when the
    // answers are withheld is the AI consent itself.
    const child = await service.createProfile(pengasuh, "children", { name: "Anak Nyata", fictional: false, estimatedAge: 14, ageReferenceDate: today, background: ["kehilangan_ibu"] });
    await service.profileTransition(pengasuh, "children", child.id, "verify", { revision: child.revision });
    const realCycleId = (await service.createCycle(pengasuh, child.id)).id;

    const overview = await service.instrumentOverview(psikolog);
    await service.instrumentDecision(psikolog, "approvals", { contentHash: overview.contentHash, note: "Instrumen ditinjau untuk uji diskusi" });
    await service.addAuthority(ketua, realCycleId, { decision: "approved", lawfulBasisNote: "Dasar kewenangan tercatat pada berkas" });
    const consent = { noticeVersion: "test-v1", authorityBasis: "Surat kuasa pengasuhan", status: "granted" as const };
    await service.addConsent(pengasuh, realCycleId, { ...consent, subjectType: "child", subjectId: child.id, type: "intake", actorType: "authorized_representative" });
    await service.addConsent(pengasuh, realCycleId, { ...consent, subjectType: "child", subjectId: child.id, type: "assent", actorType: "child" });
    const realAssessmentId = (await service.createAssessment(pengasuh, realCycleId, { target: "child" })).id;
    await submitAssessment(realCycleId, realAssessmentId, "C");

    const thread = await aiChat.createThread(pengasuh, { title: "Diskusi anak dengan data nyata", childId: child.id });
    const withheld = await aiChat.postMessage(pengasuh, thread.thread.id, { question: "Apa yang tercatat untuk anak ini?", idempotencyKey: key() });
    expect(lastAnswerOf(withheld)?.content).toContain("jawabannya tidak disertakan");

    await service.addConsent(pengasuh, realCycleId, { ...consent, subjectType: "child", subjectId: child.id, type: "ai", actorType: "authorized_representative" });
    const granted = await aiChat.postMessage(pengasuh, thread.thread.id, { question: "Dan setelah persetujuan diberikan?", idempotencyKey: key() });
    expect(lastAnswerOf(granted)?.content).not.toContain("jawabannya tidak disertakan");

    // A withdrawal is a newer consent row and must close the pack again.
    await service.addConsent(pengasuh, realCycleId, { ...consent, status: "withdrawn", subjectType: "child", subjectId: child.id, type: "ai", actorType: "authorized_representative" });
    const withdrawn = await aiChat.postMessage(pengasuh, thread.thread.id, { question: "Dan setelah persetujuan ditarik?", idempotencyKey: key() });
    expect(lastAnswerOf(withdrawn)?.content).toContain("jawabannya tidak disertakan");
  });
});

describe("equal-timestamp history ordering", () => {
  it("keeps insertion order even when random IDs sort in reverse", async () => {
    const thread = await aiChat.createThread(pengasuh, { title: "Timestamp collision regression", childId: null });
    const createdAt = new Date();
    const staffId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const answerId = "00000000-0000-4000-8000-000000000001";
    await db.insert(aiChatMessages).values({ id: staffId, organizationId: pengasuh.organizationId, threadId: thread.thread.id, role: "staff", authorId: pengasuh.membershipId, content: "Question first", createdAt });
    await db.insert(aiChatMessages).values({ id: answerId, organizationId: pengasuh.organizationId, threadId: thread.thread.id, role: "assistant", resultOrigin: "mock", content: "Answer second", createdAt });
    expect((await aiChat.threadDetail(pengasuh, thread.thread.id)).messages.map((m) => m.id)).toEqual([staffId, answerId]);
  });
});

describe("daily quota", () => {
  it("shares the analysis budget and refuses the turn past the limit", async () => {
    const [counter] = await db.select().from(aiUsageCounters).where(and(eq(aiUsageCounters.organizationId, pengasuh.organizationId), eq(aiUsageCounters.dateKey, dateKeyNow())));
    expect(counter.requestCount).toBeGreaterThan(0);
    expect(counter.reservedCount).toBe(0);

    await configureAi(pengasuh.organizationId, { dailyLimit: counter.requestCount });
    const before = await aiChat.threadDetail(pengasuh, threadId);
    await expect(aiChat.postMessage(pengasuh, threadId, { question: "Pertanyaan melewati kuota harian", idempotencyKey: key() })).rejects.toThrow(RateLimitError);
    const after = await aiChat.threadDetail(pengasuh, threadId);
    expect(after.messages).toHaveLength(before.messages.length);
  });
});
