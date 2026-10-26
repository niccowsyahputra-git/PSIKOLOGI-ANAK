import { z } from "zod";
import { STAFF_ROLES } from "@/lib/roles";

/**
 * Request validation for FR-01. Passwords are never echoed back and staff
 * emails are always trimmed and lower-cased before they reach Better Auth.
 */
const emailSchema = z
  .string()
  .trim()
  .max(200, "Email terlalu panjang")
  .pipe(z.email("Format email tidak valid"))
  .transform((value) => value.toLowerCase());

const passwordSchema = z
  .string()
  .min(12, "Kata sandi minimal 12 karakter")
  .max(128, "Kata sandi maksimal 128 karakter");

const credentialReferenceSchema = z
  .string()
  .trim()
  .min(3, "Referensi kredensial profesi wajib diisi")
  .max(200, "Referensi kredensial terlalu panjang");

export const staffRoleSchema = z.enum(STAFF_ROLES, {
  message: "Peran staf tidak dikenal",
});

export const createStaffSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter").max(120),
  email: emailSchema,
  password: passwordSchema,
  role: staffRoleSchema,
  credentialReference: credentialReferenceSchema.optional(),
  chairpersonConfirmation: z.boolean().optional(),
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z
  .object({
    role: staffRoleSchema.optional(),
    active: z.boolean().optional(),
    credentialReference: credentialReferenceSchema.nullable().optional(),
    chairpersonConfirmation: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.role !== undefined ||
      value.active !== undefined ||
      value.credentialReference !== undefined,
    { message: "Tidak ada perubahan yang dikirim" },
  );

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Kata sandi wajib diisi").max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;
