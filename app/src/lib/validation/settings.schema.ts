import { z } from "zod";

/**
 * Request validation for the two admin configuration screens: the panti
 * letterhead (FR-17, SCR-13) and the dynamic AI configuration (FR-10, SCR-11).
 */

/**
 * Both forms submit every field they own, so a cleared input must clear the
 * stored value. `null` and `""` therefore both mean "kosongkan".
 */
const optionalText = (max: number, message: string) =>
  z
    .union([z.string().trim().max(max, message), z.null()])
    .optional()
    .transform((value) => (value === undefined || value === null || value === "" ? null : value));

const timezoneSchema = z
  .string()
  .trim()
  .min(1, "Zona waktu wajib diisi")
  .max(60, "Zona waktu terlalu panjang")
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("id-ID", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Zona waktu tidak dikenal; contoh yang berlaku: Asia/Jakarta");

export const generalSettingsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nama panti minimal 2 karakter")
    .max(120, "Nama panti maksimal 120 karakter"),
  address: optionalText(300, "Alamat maksimal 300 karakter"),
  phone: optionalText(32, "Nomor telepon maksimal 32 karakter").refine(
    (value) => value === null || /^[0-9+()\-.\s]+$/.test(value),
    "Nomor telepon hanya boleh berisi angka dan tanda + ( ) - .",
  ),
  email: optionalText(200, "Email maksimal 200 karakter").refine(
    (value) => value === null || z.email().safeParse(value).success,
    "Format email tidak valid",
  ),
  contact: optionalText(200, "Kontak lain maksimal 200 karakter"),
  leaderName: optionalText(120, "Nama pimpinan maksimal 120 karakter"),
  leaderTitle: optionalText(120, "Jabatan pimpinan maksimal 120 karakter"),
  registrationNumber: optionalText(80, "Nomor izin maksimal 80 karakter"),
  printNote: optionalText(300, "Catatan kop maksimal 300 karakter"),
  timezone: timezoneSchema,
  revision: z.number().int().min(1, "Revisi tidak valid"),
});

export type GeneralSettingsInput = z.infer<typeof generalSettingsSchema>;

export const AI_MODES = ["mock", "local_endpoint", "remote_endpoint"] as const;

export const aiSettingsUpdateSchema = z
  .object({
    mode: z.enum(AI_MODES, { message: "Mode AI tidak dikenal" }),
    providerName: z
      .string()
      .trim()
      .min(2, "Nama penyedia minimal 2 karakter")
      .max(80, "Nama penyedia maksimal 80 karakter"),
    baseUrl: optionalText(200, "URL maksimal 200 karakter"),
    model: optionalText(120, "Nama model maksimal 120 karakter"),
    extension: z
      .string()
      .trim()
      .min(1, "Path permintaan wajib diisi")
      .max(120, "Path permintaan maksimal 120 karakter")
      .refine((value) => !value.includes("//"), "Path permintaan tidak valid"),
    temperature: z
      .number()
      .min(0, "Temperature minimal 0")
      .max(1, "Temperature maksimal 1"),
    maxTokens: z
      .number()
      .int()
      .min(1, "Panjang keluaran minimal 1 token")
      .max(2000, "Panjang keluaran maksimal 2.000 token"),
    timeoutSeconds: z
      .number()
      .int()
      .min(5, "Timeout minimal 5 detik")
      .max(60, "Timeout maksimal 60 detik"),
    dailyLimit: z
      .number()
      .int()
      .min(1, "Kuota harian minimal 1")
      .max(100, "Kuota harian maksimal 100"),
    enabled: z.boolean(),
    /** Omitted preserves the stored key; an empty string is refused (PRD 10.2). */
    apiKey: z
      .string()
      .min(1, "API key tidak boleh string kosong")
      .max(400, "API key terlalu panjang")
      .optional(),
    clearApiKey: z.boolean().optional(),
    revision: z.number().int().min(1, "Revisi tidak valid"),
  })
  .refine((value) => !(value.apiKey !== undefined && value.clearApiKey === true), {
    message: "Pilih salah satu: ganti API key atau hapus API key",
    path: ["apiKey"],
  });

export type AiSettingsUpdateInput = z.infer<typeof aiSettingsUpdateSchema>;
