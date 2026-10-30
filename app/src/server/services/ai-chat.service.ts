import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  buildChatContext,
  type ChatContextAnalysis,
  type ChatContextAssessment,
  type ChatContextBundle,
  type ChatContextChild,
  type ChatContextCycle,
  type ChatCounts,
  type ChatOrganizationFacts,
} from "@/lib/ai/chat-context";
import { MOCK_CHAT_PROVIDER, runMockChat } from "@/lib/ai/chat-mock";
import { buildChatMessages } from "@/lib/ai/chat-prompt";
import { callLocalChat } from "@/lib/ai/local-model";
import type { AiResult } from "@/lib/ai/result.schema";
import { toSnapshotAnswers } from "@/lib/ai/snapshot";
import { openSecret } from "@/lib/crypto";
import { getDbReady, type AppDatabase } from "@/lib/db";
import * as ai from "@/lib/db/ai-schema";
import * as s from "@/lib/db/assessment-schema";
import { user } from "@/lib/db/auth-schema";
import { staffMemberships } from "@/lib/db/domain-schema";
import { getEnv } from "@/lib/env";
import { ForbiddenError, NotFoundError, NotReadyError } from "@/lib/errors";
import type { Answer, Module } from "@/lib/instruments";
import { assertCan } from "@/lib/permissions";
import { aiChatMessageInput, aiChatThreadInput } from "@/lib/validation/ai.schema";
import { ensureAiSettings } from "@/server/repositories/ai-settings.repository";
import {
  organizationTimezone,
  reserveQuota,
  safeErrorOf,
  settleQuota,
  staffName,
  todayKey,
} from "./ai.service";
import { activeActor, consentGranted, person } from "./assessment.service";
import { recordAudit } from "./audit.service";
import type { StaffActor } from "./staff.service";

/**
 * Grounded discussion assistant for staff. Two properties define this file.
 *
 * First, the only knowledge source is this database: every turn rebuilds a
 * context pack from local rows, the pack is the only factual input in the
 * request, and the provider is still the one allowlisted loopback endpoint the
 * analysis feature uses. Nothing is fetched from the web or from any file
 * outside the installation, and nothing is sent anywhere else.
 *
 * Second, nothing is learned in the training sense. The assistant has no
 * memory beyond the stored thread, so a wrong answer cannot become a fact: the
 * next turn reads the database again.
 */
type Executor = Pick<AppDatabase, "select" | "insert" | "update" | "delete">;

/** Cycles carried into one pack, newest first — enough history to discuss a case. */
const MAX_CONTEXT_CYCLES = 6;

/** Threads listed on the index screen. */
const MAX_THREADS = 40;

const audit = (db: Executor, actor: StaffActor, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) =>
  recordAudit(db, { organizationId: actor.organizationId, actor: { type: "staff", membershipId: actor.membershipId }, action, entityType, entityId, metadata });

export type ChatThreadView = {
  id: string;
  title: string;
  childId: string | null;
  childName: string | null;
  createdBy: string;
  createdByName: string | null;
  createdAt: Date;
  lastMessageAt: Date | null;
  messageCount: number;
};

export type ChatMessageView = {
  id: string;
  role: ai.AiChatMessageRow["role"];
  content: string;
  authorName: string | null;
  simulated: boolean;
  provider: string | null;
  model: string | null;
  createdAt: Date;
};

export type ChatThreadDetail = {
  thread: ChatThreadView;
  messages: ChatMessageView[];
};

/** Turns `[{status,total}]` rows into the plain counter object the pack carries. */
function toCounts(rows: ReadonlyArray<{ key: string | null; total: number }>): ChatCounts {
  const counts: ChatCounts = {};
  for (const row of rows) {
    counts[row.key ?? "tidak_diketahui"] = row.total;
  }
  return counts;
}

async function organizationFacts(db: Executor, organizationId: string, timezone: string): Promise<ChatOrganizationFacts> {
  const [children, guardians, links, cycles, byStatus, byTarget, analyses, reviews, observations, sessions] = await Promise.all([
    db.select({ key: s.children.profileState, total: count() }).from(s.children).where(eq(s.children.organizationId, organizationId)).groupBy(s.children.profileState),
    db.select({ total: count() }).from(s.guardians).where(eq(s.guardians.organizationId, organizationId)),
    db.select({ total: count() }).from(s.childGuardians).where(and(eq(s.childGuardians.organizationId, organizationId), isNull(s.childGuardians.validTo))),
    db.select({ key: s.assessmentCycles.status, total: count() }).from(s.assessmentCycles).where(eq(s.assessmentCycles.organizationId, organizationId)).groupBy(s.assessmentCycles.status),
    db.select({ key: s.assessments.status, total: count() }).from(s.assessments).where(eq(s.assessments.organizationId, organizationId)).groupBy(s.assessments.status),
    db.select({ key: s.assessments.target, total: count() }).from(s.assessments).where(eq(s.assessments.organizationId, organizationId)).groupBy(s.assessments.target),
    db.select({ key: ai.aiAnalyses.resultOrigin, total: count() }).from(ai.aiAnalyses).where(eq(ai.aiAnalyses.organizationId, organizationId)).groupBy(ai.aiAnalyses.resultOrigin),
    db.select({ key: ai.aiReviews.disposition, total: count() }).from(ai.aiReviews).where(eq(ai.aiReviews.organizationId, organizationId)).groupBy(ai.aiReviews.disposition),
    db.select({ total: count() }).from(s.assessmentObservations).where(eq(s.assessmentObservations.organizationId, organizationId)),
    db.select({ total: count() }).from(s.intakeSessions).where(and(eq(s.intakeSessions.organizationId, organizationId), isNull(s.intakeSessions.revokedAt), gt(s.intakeSessions.expiresAt, new Date()))),
  ]);
  return {
    timezone,
    childrenByState: toCounts(children),
    guardianTotal: guardians[0]?.total ?? 0,
    linkTotal: links[0]?.total ?? 0,
    cyclesByStatus: toCounts(cycles),
    assessmentsByStatus: toCounts(byStatus),
    assessmentsByTarget: toCounts(byTarget),
    analysesByOrigin: toCounts(analyses),
    reviewsByDisposition: toCounts(reviews),
    observationTotal: observations[0]?.total ?? 0,
    liveIntakeSessions: sessions[0]?.total ?? 0,
  };
}

/**
 * Child facts for one thread. Answers are attached per cycle only when the AI
 * consent for that cycle is granted (or the cycle is fictional training data),
 * so the consent decision in FR-11 also governs what a discussion may read.
 */
async function childFacts(db: Executor, organizationId: string, childId: string): Promise<ChatContextChild> {
  const [child] = await db.select().from(s.children).where(and(eq(s.children.organizationId, organizationId), eq(s.children.id, childId)));
  if (!child) throw new NotFoundError("Anak asuh tidak ditemukan");

  const links = await db
    .select()
    .from(s.childGuardians)
    .where(and(eq(s.childGuardians.organizationId, organizationId), eq(s.childGuardians.childId, childId), isNull(s.childGuardians.validTo)))
    .orderBy(asc(s.childGuardians.guardianId));
  const guardianAlias = new Map(links.map((link, index) => [link.guardianId, `WALI-${index + 1}`]));

  const cycleRows = await db
    .select()
    .from(s.assessmentCycles)
    .where(and(eq(s.assessmentCycles.organizationId, organizationId), eq(s.assessmentCycles.childId, childId)))
    .orderBy(desc(s.assessmentCycles.startedAt), desc(s.assessmentCycles.id))
    .limit(MAX_CONTEXT_CYCLES);

  const cycles: ChatContextCycle[] = [];
  for (const [index, cycle] of cycleRows.entries()) {
    const alias = `SIKLUS-${index + 1}`;
    const aiConsentGranted = cycle.fictional || (await consentGranted(db, cycle.id, childId, "ai"));
    const consentRows = await db
      .select({ type: s.consents.type, status: s.consents.status, subjectType: s.consents.subjectType, subjectId: s.consents.subjectId })
      .from(s.consents)
      .where(eq(s.consents.cycleId, cycle.id))
      .orderBy(desc(s.consents.capturedAt));
    const assessmentRows = await db
      .select()
      .from(s.assessments)
      .where(and(eq(s.assessments.organizationId, organizationId), eq(s.assessments.cycleId, cycle.id)))
      .orderBy(asc(s.assessments.id));
    const observationCounts = assessmentRows.length
      ? await db
          .select({ key: s.assessmentObservations.assessmentId, total: count() })
          .from(s.assessmentObservations)
          .where(inArray(s.assessmentObservations.assessmentId, assessmentRows.map((row) => row.id)))
          .groupBy(s.assessmentObservations.assessmentId)
      : [];
    const observationByAssessment = toCounts(observationCounts);

    const assessments: ChatContextAssessment[] = assessmentRows.map((row, position) => ({
      alias: `ASS-${position + 1}`,
      target: row.target,
      guardianAlias: row.guardianId ? guardianAlias.get(row.guardianId) ?? null : null,
      module: row.module as Module,
      status: row.status,
      respondent: row.respondentType,
      assistance: row.assistance,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      observationCount: observationByAssessment[row.id] ?? 0,
      // A withdrawn assessment is no longer material for a discussion, and a
      // draft has not been handed in yet, so neither contributes answers.
      answers:
        aiConsentGranted && row.status === "submitted"
          ? toSnapshotAnswers(row.module as Module, JSON.parse(row.answersJson) as Answer[])
          : null,
    }));

    const analysisRows = await db
      .select()
      .from(ai.aiAnalyses)
      .where(and(eq(ai.aiAnalyses.organizationId, organizationId), eq(ai.aiAnalyses.cycleId, cycle.id)))
      .orderBy(desc(ai.aiAnalyses.createdAt), desc(ai.aiAnalyses.id));
    const analyses: ChatContextAnalysis[] = [];
    for (const [position, row] of analysisRows.entries()) {
      const result = JSON.parse(row.resultJson) as AiResult;
      const [review] = await db
        .select({ disposition: ai.aiReviews.disposition })
        .from(ai.aiReviews)
        .where(eq(ai.aiReviews.analysisId, row.id))
        .orderBy(desc(ai.aiReviews.createdAt), desc(ai.aiReviews.id))
        .limit(1);
      analyses.push({
        alias: `ANALISIS-${position + 1}`,
        scope: row.scope,
        resultOrigin: row.resultOrigin,
        createdAt: row.createdAt.toISOString(),
        supportPriority: result.supportPriority,
        summary: result.summary,
        disposition: review?.disposition ?? null,
      });
    }

    cycles.push({
      alias,
      kind: cycle.kind,
      module: cycle.module as Module,
      status: cycle.status,
      startedAt: cycle.startedAt.toISOString(),
      fictional: cycle.fictional,
      ageAtStart: cycle.ageAtStart,
      ageIsEstimated: cycle.ageIsEstimated,
      aiConsentGranted,
      consents: consentRows.map((row) => ({
        type: row.type,
        status: row.status,
        subject: row.subjectType === "child" ? "Anak" : guardianAlias.get(row.subjectId) ?? "WALI lain",
      })),
      assessments,
      analyses,
    });
  }

  const accessibility = JSON.parse(child.accessibilityJson) as { needs?: string };
  return {
    pseudonym: "Anak",
    profileState: child.profileState,
    fictional: child.fictional,
    backgroundContext: JSON.parse(child.backgroundJson) as string[],
    accessibilityRecorded: Boolean(accessibility.needs && accessibility.needs.trim().length > 0),
    notesRecorded: Boolean(child.notes && child.notes.trim().length > 0),
    guardians: links.map((link) => ({
      alias: guardianAlias.get(link.guardianId) ?? "WALI",
      relationship: link.relationship,
      isPrimary: link.isPrimary,
      authorityStatus: link.authorityStatus,
      contactSafety: link.contactSafety,
    })),
    cycles,
  };
}

async function buildContext(db: Executor, actor: StaffActor, childId: string | null): Promise<ChatContextBundle> {
  const timezone = await organizationTimezone(db, actor.organizationId);
  return buildChatContext({
    generatedAt: new Date(),
    organization: await organizationFacts(db, actor.organizationId, timezone),
    child: childId ? await childFacts(db, actor.organizationId, childId) : null,
  });
}

async function threadRow(db: Executor, actor: StaffActor, threadId: string): Promise<ai.AiChatThreadRow> {
  const [row] = await db
    .select()
    .from(ai.aiChatThreads)
    .where(and(eq(ai.aiChatThreads.organizationId, actor.organizationId), eq(ai.aiChatThreads.id, threadId)));
  if (!row) throw new NotFoundError("Diskusi tidak ditemukan");
  return row;
}

/** Refuses before any row is written, so the UI can explain itself on open. */
async function assertChatReady(db: AppDatabase, organizationId: string) {
  const settings = await ensureAiSettings(db, organizationId);
  if (!settings.enabled) {
    throw new NotReadyError("Bantuan AI belum diaktifkan. Admin perlu menyimpan dan menguji konfigurasi di halaman Konfigurasi AI.");
  }
  if (settings.mode === "remote_endpoint") {
    throw new ForbiddenError("Provider jarak jauh ditolak kebijakan local-only instalasi ini");
  }
  return settings;
}

export async function listThreads(actor: StaffActor): Promise<ChatThreadView[]> {
  assertCan(actor.role, "ai.chat");
  const db = await getDbReady();
  await activeActor(db, actor);
  const rows = await db
    .select({
      thread: ai.aiChatThreads,
      childName: s.children.name,
      createdByName: user.name,
    })
    .from(ai.aiChatThreads)
    .leftJoin(s.children, eq(s.children.id, ai.aiChatThreads.childId))
    .leftJoin(staffMemberships, eq(staffMemberships.id, ai.aiChatThreads.createdBy))
    .leftJoin(user, eq(user.id, staffMemberships.authUserId))
    .where(eq(ai.aiChatThreads.organizationId, actor.organizationId))
    .orderBy(desc(ai.aiChatThreads.lastMessageAt), desc(ai.aiChatThreads.createdAt), desc(ai.aiChatThreads.id))
    .limit(MAX_THREADS);
  const counts = toCounts(
    rows.length
      ? await db
          .select({ key: ai.aiChatMessages.threadId, total: count() })
          .from(ai.aiChatMessages)
          .where(inArray(ai.aiChatMessages.threadId, rows.map(({ thread }) => thread.id)))
          .groupBy(ai.aiChatMessages.threadId)
      : [],
  );
  return rows.map(({ thread, childName, createdByName }) => ({
    id: thread.id,
    title: thread.title,
    childId: thread.childId,
    childName,
    createdBy: thread.createdBy,
    createdByName,
    createdAt: thread.createdAt,
    lastMessageAt: thread.lastMessageAt,
    messageCount: counts[thread.id] ?? 0,
  }));
}

export async function threadDetail(actor: StaffActor, threadId: string): Promise<ChatThreadDetail> {
  assertCan(actor.role, "ai.chat");
  const db = await getDbReady();
  await activeActor(db, actor);
  const thread = await threadRow(db, actor, threadId);
  const rows = await db
    .select({ message: ai.aiChatMessages, authorName: user.name })
    .from(ai.aiChatMessages)
    .leftJoin(staffMemberships, eq(staffMemberships.id, ai.aiChatMessages.authorId))
    .leftJoin(user, eq(user.id, staffMemberships.authUserId))
    .where(eq(ai.aiChatMessages.threadId, threadId))
    .orderBy(asc(ai.aiChatMessages.createdAt), asc(sql`ai_chat_messages.rowid`));
  const [child] = thread.childId
    ? await db.select({ name: s.children.name }).from(s.children).where(eq(s.children.id, thread.childId))
    : [];
  return {
    thread: {
      id: thread.id,
      title: thread.title,
      childId: thread.childId,
      childName: child?.name ?? null,
      createdBy: thread.createdBy,
      createdByName: await staffName(db, thread.createdBy),
      createdAt: thread.createdAt,
      lastMessageAt: thread.lastMessageAt,
      messageCount: rows.length,
    },
    messages: rows.map(({ message, authorName }) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      authorName,
      simulated: message.resultOrigin === "mock",
      provider: message.provider,
      model: message.model,
      createdAt: message.createdAt,
    })),
  };
}

export async function createThread(actor: StaffActor, input: unknown): Promise<ChatThreadDetail> {
  assertCan(actor.role, "ai.chat");
  const data = aiChatThreadInput.parse(input);
  const db = await getDbReady();
  await activeActor(db, actor);
  await assertChatReady(db, actor.organizationId);
  if (data.childId) await person(db, actor.organizationId, "children", data.childId);

  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(ai.aiChatThreads).values({ id, organizationId: actor.organizationId, childId: data.childId, title: data.title, createdBy: actor.membershipId });
    await audit(tx, actor, "ai.chat.thread_create", "ai_chat_threads", id, { chatScope: data.childId ? "child" : "organization", childId: data.childId });
  });
  return threadDetail(actor, id);
}

/**
 * One discussion turn. The provider call happens outside any transaction so a
 * slow local model never holds a write lock on the SQLite file, and the staff
 * question is stored first: what a human asked is a fact worth keeping even
 * when the engine then fails to answer.
 */
export async function postMessage(actor: StaffActor, threadId: string, input: unknown): Promise<ChatThreadDetail> {
  assertCan(actor.role, "ai.chat");
  const data = aiChatMessageInput.parse(input);
  const db = await getDbReady();
  await activeActor(db, actor);
  const settings = await assertChatReady(db, actor.organizationId);
  const thread = await threadRow(db, actor, threadId);

  // A replayed POST must never spend quota or call the provider twice.
  const [replay] = await db
    .select()
    .from(ai.aiChatMessages)
    .where(and(eq(ai.aiChatMessages.organizationId, actor.organizationId), eq(ai.aiChatMessages.idempotencyKey, data.idempotencyKey)));
  if (replay) return threadDetail(actor, threadId);

  const history = await db
    .select({ role: ai.aiChatMessages.role, content: ai.aiChatMessages.content })
    .from(ai.aiChatMessages)
    .where(eq(ai.aiChatMessages.threadId, threadId))
    .orderBy(asc(ai.aiChatMessages.createdAt), asc(sql`ai_chat_messages.rowid`));

  const bundle = await buildContext(db, actor, thread.childId);
  const messages = buildChatMessages({ bundle, history, question: data.question });

  const timezone = bundle.context.organization.timezone;
  const dateKey = todayKey(timezone);
  const mock = settings.mode === "mock";
  const askedId = randomUUID();
  await db.transaction(async (tx) => {
    await reserveQuota(tx, actor.organizationId, dateKey, settings.dailyLimit);
    await tx.insert(ai.aiChatMessages).values({
      id: askedId,
      organizationId: actor.organizationId,
      threadId,
      role: "staff",
      authorId: actor.membershipId,
      content: data.question,
      contextHash: bundle.contextHash,
      idempotencyKey: data.idempotencyKey,
    });
    await audit(tx, actor, "ai.chat.ask", "ai_chat_messages", askedId, {
      threadId,
      chatScope: thread.childId ? "child" : "organization",
      aiMode: settings.mode,
      contextCharCount: bundle.serialized.length,
      historyCount: history.length,
    });
  });

  let answer: string;
  try {
    answer = mock
      ? runMockChat(bundle.context)
      : await callLocalChat(
          { baseUrl: settings.baseUrl, model: settings.model, extension: settings.extension, temperature: settings.temperature, maxTokens: settings.maxTokens, timeoutSeconds: settings.timeoutSeconds },
          messages,
          settings.keyCiphertext ? openSecret(settings.keyCiphertext) : null,
          getEnv().ai.allowedEndpointOrigins,
        );
  } catch (error) {
    const safeError = safeErrorOf(error);
    await db.transaction(async (tx) => {
      await settleQuota(tx, actor.organizationId, dateKey, mock);
      await tx.update(ai.aiChatThreads).set({ lastMessageAt: new Date() }).where(eq(ai.aiChatThreads.id, threadId));
      await audit(tx, actor, "ai.chat.fail", "ai_chat_messages", askedId, { threadId, aiMode: settings.mode, failureReason: safeError.slice(0, 120) });
    });
    throw error;
  }

  const answerId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(ai.aiChatMessages).values({
      id: answerId,
      organizationId: actor.organizationId,
      threadId,
      role: "assistant",
      content: answer,
      resultOrigin: mock ? "mock" : "local_model",
      provider: mock ? MOCK_CHAT_PROVIDER : settings.providerName,
      model: mock ? null : settings.model,
      promptVersion: settings.promptVersion,
      contextHash: bundle.contextHash,
    });
    await tx.update(ai.aiChatThreads).set({ lastMessageAt: new Date() }).where(eq(ai.aiChatThreads.id, threadId));
    await settleQuota(tx, actor.organizationId, dateKey, mock);
    await audit(tx, actor, "ai.chat.answer", "ai_chat_messages", answerId, { threadId, resultOrigin: mock ? "mock" : "local_model", aiMode: settings.mode });
  });

  return threadDetail(actor, threadId);
}
