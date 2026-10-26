import { z } from "zod";
import { FAMILY_CONTEXT } from "@/lib/labels";
const familyContext = z.enum(FAMILY_CONTEXT.map((entry) => entry.value) as [string, ...string[]]);
const date = z.iso.date().refine((value) => value <= new Date().toISOString().slice(0, 10), "Tanggal tidak boleh di masa depan");
const nullableDate = date.nullable().optional();
export const childInput = z.object({
  name: z.string().trim().min(2).max(200), fictional: z.boolean().default(false), birthDate: nullableDate,
  estimatedAge: z.number().int().min(0).max(100).nullable().optional(), ageReferenceDate: nullableDate,
  sex: z.enum(["female", "male", "unknown"]).default("unknown"), background: z.array(familyContext).max(FAMILY_CONTEXT.length).refine((list) => new Set(list).size === list.length, "Konteks keluarga duplikat").default([]), admissionDate: nullableDate,
  notes: z.string().max(4000).default(""), accessibility: z.string().max(1000).default(""),
}).strict().refine((v) => Boolean(v.birthDate) ? v.estimatedAge == null && !v.ageReferenceDate : v.estimatedAge != null && Boolean(v.ageReferenceDate), "Gunakan tanggal lahir ATAU usia perkiraan dengan tanggal acuan");
export const guardianInput = z.object({ name: z.string().trim().min(2).max(200), fictional: z.boolean().default(false), safeContact: z.string().max(200).nullable().optional(), communicationPreference: z.string().max(200).default("tatap muka") }).strict();
export const linkInput = z.object({ guardianId: z.uuid(), relationship: z.string().trim().min(2).max(100), isPrimary: z.boolean().default(false), contactSafety: z.enum(["safe", "unsafe", "unknown"]).default("unknown"), contactReviewNote: z.string().max(1000).default("") }).strict().refine((v) => v.contactSafety !== "safe" || v.contactReviewNote.trim().length >= 5, "Verifikasi kontak aman memerlukan catatan");
export const consentInput = z.object({ subjectType: z.enum(["child", "guardian"]), subjectId: z.uuid(), type: z.enum(["intake", "assent", "media", "ai"]), status: z.enum(["granted", "declined", "withdrawn", "pending_authority_review"]), noticeVersion: z.string().min(1).max(100), authorityBasis: z.string().trim().min(5).max(2000), notes: z.string().max(2000).optional(), actorType: z.enum(["child", "guardian", "authorized_representative"]) }).strict();
export const reviewInput = z.object({ decision: z.enum(["approved", "pending", "declined"]), lawfulBasisNote: z.string().trim().min(10).max(2000) }).strict();
export const draftInput = z.object({ target: z.enum(["child", "guardian"]), guardianId: z.uuid().optional(), parentAssessmentId: z.uuid().optional(), correctionReason: z.string().trim().min(5).max(1000).optional() }).strict();
export const saveInput = z.object({ revision: z.number().int().min(1), answers: z.unknown() }).strict();
export const sessionInput = z.object({ assessmentId: z.uuid() }).strict();
export const reasonInput = z.object({ reason: z.string().trim().min(5).max(2000) }).strict();
