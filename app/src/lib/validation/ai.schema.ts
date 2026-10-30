import { z } from "zod";
import { MAX_CHAT_QUESTION_CHARS } from "@/lib/ai/chat-prompt";

/** Generate request contract (PRD section 10.1). */
export const aiJobInput = z
  .object({
    childId: z.uuid(),
    guardianId: z.uuid().nullable().default(null),
    cycleId: z.uuid(),
    scope: z.enum(["child", "guardian", "combined"]),
    sourceAssessmentIds: z.array(z.uuid()).min(1).max(20),
    allowPartial: z.boolean().default(false),
    partialReason: z.string().trim().min(10).max(1000).nullable().default(null),
    regenerateReason: z.string().trim().min(10).max(1000).nullable().default(null),
    /** Created by the client before POST so a replay returns the same job. */
    idempotencyKey: z.uuid(),
  })
  .strict()
  .refine((value) => (value.scope === "child" ? value.guardianId === null : value.guardianId !== null), {
    message: "Lingkup wali dan gabungan memerlukan pilihan wali",
    path: ["guardianId"],
  })
  .refine((value) => (value.allowPartial ? value.partialReason !== null : true), {
    message: "Mode sebagian memerlukan alasan",
    path: ["partialReason"],
  });

export type AiJobInput = z.infer<typeof aiJobInput>;

export const aiReviewInput = z
  .object({
    disposition: z.enum(["support_approved", "needs_revision", "rejected"]),
    comment: z.string().trim().min(5).max(2000),
  })
  .strict();

export const aiJobQuery = z
  .object({
    childId: z.uuid().optional(),
    guardianId: z.uuid().optional(),
    cycleId: z.uuid().optional(),
    scope: z.enum(["child", "guardian", "combined"]).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();

/**
 * A discussion thread is either about the whole panti or about exactly one
 * child, because the context pack is assembled from that choice alone.
 */
export const aiChatThreadInput = z
  .object({
    childId: z.uuid().nullable().default(null),
    title: z.string().trim().min(3).max(120),
  })
  .strict();

export const aiChatMessageInput = z
  .object({
    question: z.string().trim().min(3).max(MAX_CHAT_QUESTION_CHARS),
    /** Created by the client before POST so a double tap resolves to one turn. */
    idempotencyKey: z.uuid(),
  })
  .strict();
