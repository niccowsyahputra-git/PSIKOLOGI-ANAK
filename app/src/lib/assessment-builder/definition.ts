import { z } from "zod";
import { ValidationError } from "@/lib/errors";

export const DEFINITION_MAX_BYTES = 512 * 1024;
export const SAFETY_LABEL = "Formulir intake psikososial belum tervalidasi. Persetujuan konten bukan validasi psikometrik. Tidak menghasilkan skor atau diagnosis.";
export const QUESTION_TYPES = ["short_text", "long_text", "single_choice", "multiple_choice", "yes_no", "number", "date", "dropdown", "scale", "information", "file"] as const;
export type QuestionType = typeof QUESTION_TYPES[number];
export type Rule = { op: "all" | "any"; rules: Rule[] } | { questionId: string; operator: "equals" | "not_equals" | "contains"; value: string | number | boolean };
const scalar = z.union([z.string().max(4000), z.number().finite(), z.boolean()]);
const ruleSchema: z.ZodType<Rule> = z.lazy(() => z.union([
  z.object({ op: z.enum(["all", "any"]), rules: z.array(ruleSchema).min(1).max(100) }).strict(),
  z.object({ questionId: z.uuid(), operator: z.enum(["equals", "not_equals", "contains"]), value: scalar }).strict(),
]));
const plain = (max: number) => z.string().max(max);
export const optionSchema = z.object({ id: z.uuid(), label: plain(200), value: z.union([plain(200), z.number().finite()]) }).strict();
export const validationSchema = z.object({
  minLength: z.number().int().min(0).max(4000).optional(), maxLength: z.number().int().min(1).max(4000).optional(),
  min: z.number().finite().optional(), max: z.number().finite().optional(), step: z.number().positive().finite().optional(), integer: z.boolean().optional(),
  minDate: z.iso.date().optional(), maxDate: z.iso.date().optional(),
  minSelections: z.number().int().min(0).max(50).optional(), maxSelections: z.number().int().min(1).max(50).optional(),
}).strict();
export const questionSchema = z.object({
  id: z.uuid(), sectionId: z.uuid(), type: z.enum(QUESTION_TYPES), label: plain(2000),
  instructions: plain(2000).default(""), placeholder: plain(200).default(""), purpose: plain(2000).default(""),
  sensitive: z.boolean().default(false), personal: z.boolean().default(true), required: z.boolean().default(false), allowSkip: z.boolean().default(true),
  active: z.boolean().default(true), archived: z.boolean().default(false), options: z.array(optionSchema).max(50).default([]),
  validation: validationSchema.default({}), condition: ruleSchema.nullable().default(null),
  provenance: z.object({ origin: z.enum(["manual", "ai", "mock"]), candidateId: z.uuid().optional() }).strict().default({ origin: "manual" }),
}).strict();
export type Question = z.infer<typeof questionSchema>;
export const definitionSchema = z.object({
  schemaVersion: z.literal(1), name: z.string().trim().min(3).max(200), description: plain(4000).default(""), category: plain(100).default(""), purpose: plain(4000).default(""),
  target: z.enum(["child", "guardian", "both"]).default("both"), language: z.enum(["id", "en"]).default("id"),
  minAge: z.number().int().min(0).max(100).nullable().default(null), maxAge: z.number().int().min(0).max(100).nullable().default(null),
  allowImages: z.boolean().default(false),
  sections: z.array(z.object({ id: z.uuid(), title: plain(200), instructions: plain(2000).default(""), active: z.boolean().default(true), archived: z.boolean().default(false) }).strict()).max(20),
  questions: z.array(questionSchema).max(100),
}).strict();
export type Definition = z.infer<typeof definitionSchema>;
export type CompiledDefinition = { definition: Definition; ordered: Question[]; topological: Question[]; warnings: string[] };
export const answerSchema = z.object({
  questionId: z.uuid(), state: z.enum(["answered", "skipped", "not_applicable"]),
  value: z.union([scalar, z.array(z.string().max(4000)).max(50), z.null()]),
  assistance: z.enum(["none", "read_aloud", "scribed"]).default("none"),
  skipReason: plain(500).nullable().default(null),
}).strict();
export type DynamicAnswer = z.infer<typeof answerSchema>;
const choiceTypes: readonly QuestionType[] = ["single_choice", "multiple_choice", "dropdown"];
const textTypes: readonly QuestionType[] = ["short_text", "long_text"];
function fail(path: string, message: string): never { throw new ValidationError(message, { [path]: [message] }); }

/** Bound recursion before handing untrusted rules to the recursive Zod schema. */
export function assertRuleBudget(input: unknown): void {
  const stack: { value: unknown; depth: number }[] = [];
  if (input && typeof input === "object" && "questions" in input && Array.isArray(input.questions)) {
    for (const q of input.questions) if (q && typeof q === "object" && "condition" in q && q.condition) stack.push({ value: q.condition, depth: 1 });
  }
  let count = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++count > 200 || depth > 4) fail("questions.condition", "Aturan terlalu dalam atau terlalu banyak (maksimum 4 tingkat / 200 simpul).");
    if (value && typeof value === "object" && "rules" in value && Array.isArray(value.rules)) {
      for (const child of value.rules) stack.push({ value: child, depth: depth + 1 });
    }
  }
}
export function ruleLeaves(rule: Rule): Extract<Rule, { questionId: string }>[] {
  return "op" in rule ? rule.rules.flatMap(ruleLeaves) : [rule];
}

export function compileDefinition(input: unknown, publish = false): CompiledDefinition {
  assertRuleBudget(input);
  const definition = definitionSchema.parse(input);
  if (new TextEncoder().encode(JSON.stringify(definition)).length > DEFINITION_MAX_BYTES) fail("definition", "Definisi melebihi 512 KiB.");
  if (definition.minAge !== null && definition.maxAge !== null && definition.minAge > definition.maxAge) fail("minAge", "Rentang usia tidak valid.");
  const sections = new Map(definition.sections.map((s) => [s.id, s]));
  const all = new Map(definition.questions.map((q) => [q.id, q]));
  if (sections.size !== definition.sections.length || all.size !== definition.questions.length) fail("questions", "ID section atau pertanyaan duplikat.");
  const active = (q: Question) => q.active && !q.archived && sections.get(q.sectionId)?.active && !sections.get(q.sectionId)?.archived;
  const warnings: string[] = [];
  const labels = new Set<string>();
  const optionIds = new Set<string>();
  for (const q of definition.questions) {
    const p = `questions.${q.id}`;
    if (!sections.has(q.sectionId)) fail(p, "Section pertanyaan tidak ditemukan.");
    if (q.personal || q.sensitive) q.allowSkip = true;
    if (publish && active(q) && !q.label.trim()) fail(`${p}.label`, "Label pertanyaan wajib diisi.");
    const normalized = q.label.trim().toLocaleLowerCase().replace(/\s+/g, " ");
    if (normalized && labels.has(normalized)) warnings.push(`Pertanyaan berulang: ${q.label}`);
    labels.add(normalized);
    const v = q.validation;
    const permitted = textTypes.includes(q.type) ? ["minLength", "maxLength"] : q.type === "number" || q.type === "scale" ? ["min", "max", "step", "integer"] : q.type === "date" ? ["minDate", "maxDate"] : q.type === "multiple_choice" ? ["minSelections", "maxSelections"] : [];
    if (Object.keys(v).some((key) => !permitted.includes(key))) fail(`${p}.validation`, "Validasi tidak sesuai jenis pertanyaan.");
    for (const [lo, hi] of [[v.minLength, v.maxLength], [v.min, v.max], [v.minDate, v.maxDate], [v.minSelections, v.maxSelections]]) {
      if (lo !== undefined && hi !== undefined && lo > hi) fail(`${p}.validation`, "Batas minimum melebihi maksimum.");
    }
    if (q.type === "scale" && (v.min === undefined || v.max === undefined || v.step === undefined || v.max <= v.min || (v.max - v.min) / v.step > 100)) fail(`${p}.validation`, "Skala memerlukan min, max, step, dan maksimum 101 posisi.");
    if (!choiceTypes.includes(q.type) && q.options.length) fail(`${p}.options`, "Jenis ini tidak menggunakan opsi.");
    if (publish && active(q) && choiceTypes.includes(q.type) && q.options.length < 2) fail(`${p}.options`, "Pilihan memerlukan sedikitnya dua opsi.");
    if (q.type === "multiple_choice" && (v.minSelections ?? 0) > q.options.length) fail(`${p}.validation`, "Minimum pilihan melebihi jumlah opsi.");
    const values = new Set<string>();
    for (const option of q.options) {
      if (optionIds.has(option.id)) fail(`${p}.options`, "ID opsi duplikat.");
      optionIds.add(option.id);
      const key = JSON.stringify(option.value);
      if (values.has(key)) fail(`${p}.options`, "Nilai opsi duplikat.");
      values.add(key);
      if (publish && active(q) && !option.label.trim()) fail(`${p}.options`, "Label opsi wajib diisi.");
    }
    if (q.type === "information" && (q.required || q.options.length)) fail(p, "Informasi bukan pertanyaan wajib.");
    if (active(q) && q.type === "file" && !definition.allowImages) fail(p, "Aktifkan izin gambar untuk jenis unggahan.");
    if (q.condition) for (const leaf of ruleLeaves(q.condition)) {
      const source = all.get(leaf.questionId);
      if (!source || !active(source) || source.type === "information" || source.type === "file") fail(`${p}.condition`, "Sumber kondisi harus pertanyaan aktif dalam versi yang sama.");
      if (leaf.operator === "contains") {
        if ((!textTypes.includes(source.type) && source.type !== "multiple_choice") || typeof leaf.value !== "string") fail(`${p}.condition`, "Contains hanya untuk teks atau pilihan jamak.");
      } else if (source.type === "multiple_choice") fail(`${p}.condition`, "Gunakan contains untuk pilihan jamak.");
      if (choiceTypes.includes(source.type) && !source.options.some((o) => o.id === leaf.value)) fail(`${p}.condition`, "Opsi sumber kondisi tidak ditemukan.");
      if ((source.type === "yes_no" && typeof leaf.value !== "boolean") || ((source.type === "number" || source.type === "scale") && typeof leaf.value !== "number") || ((textTypes.includes(source.type) || source.type === "date") && typeof leaf.value !== "string")) fail(`${p}.condition`, "Nilai kondisi tidak sesuai jenis sumber.");
      if (source.type === "date" && !z.iso.date().safeParse(leaf.value).success) fail(`${p}.condition`, "Tanggal kondisi tidak valid.");
    }
  }
  const ordered = definition.sections.filter((s) => s.active && !s.archived).flatMap((s) => definition.questions.filter((q) => q.sectionId === s.id && active(q)));
  if (publish && !ordered.some((q) => q.type !== "information")) fail("questions", "Tambahkan sedikitnya satu pertanyaan aktif.");
  if (publish && definition.sections.some((s) => s.active && !s.archived && !s.title.trim())) fail("sections", "Judul section wajib diisi.");
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const topological: Question[] = [];
  const visit = (q: Question) => {
    if (visiting.has(q.id)) fail(`questions.${q.id}.condition`, "Kondisi melingkar tidak diizinkan.");
    if (visited.has(q.id)) return;
    visiting.add(q.id);
    if (q.condition) for (const leaf of ruleLeaves(q.condition)) visit(all.get(leaf.questionId)!);
    visiting.delete(q.id); visited.add(q.id); topological.push(q);
  };
  for (const q of ordered) visit(q);
  return { definition, ordered, topological, warnings };
}

function ruleMatches(rule: Rule, answers: Map<string, DynamicAnswer>, visible: Set<string>): boolean {
  if ("op" in rule) return rule.op === "all" ? rule.rules.every((r) => ruleMatches(r, answers, visible)) : rule.rules.some((r) => ruleMatches(r, answers, visible));
  const answer = answers.get(rule.questionId);
  if (!visible.has(rule.questionId) || answer?.state !== "answered" || answer.value === null) return false;
  if (rule.operator === "contains") return Array.isArray(answer.value) ? answer.value.includes(String(rule.value)) : typeof answer.value === "string" && answer.value.normalize("NFKC").toLowerCase().includes(String(rule.value).normalize("NFKC").toLowerCase());
  return rule.operator === "equals" ? answer.value === rule.value : answer.value !== rule.value;
}
export function visibleQuestionIds(compiled: CompiledDefinition, answers: readonly DynamicAnswer[]): Set<string> {
  const map = new Map(answers.map((a) => [a.questionId, a]));
  const visible = new Set<string>();
  for (const q of compiled.topological) if (!q.condition || ruleMatches(q.condition, map, visible)) visible.add(q.id);
  return visible;
}
const empty = (id: string, state: DynamicAnswer["state"]): DynamicAnswer => ({ questionId: id, state, value: null, assistance: "none", skipReason: state === "not_applicable" ? "hidden_by_rule" : null });

/** Both clients and the server discard hidden values; no hidden answer can feed another rule. */
export function normalizeAnswers(compiled: CompiledDefinition, input: unknown, final = false): DynamicAnswer[] {
  const answers = z.array(answerSchema).max(100).parse(input);
  const map = new Map(answers.map((a) => [a.questionId, a]));
  if (map.size !== answers.length) fail("answers", "Jawaban duplikat.");
  const all = new Map(compiled.definition.questions.map((q) => [q.id, q]));
  for (const a of answers) if (!all.has(a.questionId)) fail("answers", "Pertanyaan tidak ada pada versi ini.");
  const visible = visibleQuestionIds(compiled, answers);
  const result: DynamicAnswer[] = [];
  for (const q of compiled.definition.questions) {
    if (q.type === "information") {
      if (map.has(q.id)) fail(`answers.${q.id}`, "Informasi tidak menerima jawaban.");
      continue;
    }
    if (!visible.has(q.id)) { result.push(empty(q.id, "not_applicable")); continue; }
    const a = map.get(q.id);
    // A revealed item must be answered afresh, never revived from a hidden state.
    if (!a || a.state === "not_applicable") {
      if (final && q.required) fail(`answers.${q.id}`, "Jawab atau pilih dilewati untuk pertanyaan wajib.");
      continue;
    }
    if (a.state === "skipped") {
      if (!q.allowSkip || a.value !== null) fail(`answers.${q.id}`, "Pilihan dilewati tidak diizinkan atau masih memiliki nilai.");
    } else validateValue(q, a.value);
    result.push({ ...a, skipReason: a.state === "skipped" ? a.skipReason : null });
  }
  return result;
}
function validateValue(q: Question, value: DynamicAnswer["value"]): void {
  const p = `answers.${q.id}`;
  const v = q.validation;
  if (textTypes.includes(q.type)) {
    if (typeof value !== "string" || !value.trim() || value.length < (v.minLength ?? 0) || value.length > (v.maxLength ?? (q.type === "short_text" ? 300 : 4000))) fail(p, "Panjang teks tidak sesuai.");
  } else if (q.type === "single_choice" || q.type === "dropdown") {
    if (typeof value !== "string" || !q.options.some((o) => o.id === value)) fail(p, "Pilihan tidak dikenal.");
  } else if (q.type === "multiple_choice") {
    if (!Array.isArray(value) || new Set(value).size !== value.length || value.length < (v.minSelections ?? 1) || value.length > (v.maxSelections ?? q.options.length) || value.some((id) => !q.options.some((o) => o.id === id))) fail(p, "Pilihan jamak tidak sesuai.");
  } else if (q.type === "yes_no") {
    if (typeof value !== "boolean") fail(p, "Pilih Ya atau Tidak.");
  } else if (q.type === "number" || q.type === "scale") {
    if (typeof value !== "number" || !Number.isFinite(value) || v.integer && !Number.isInteger(value) || v.min !== undefined && value < v.min || v.max !== undefined && value > v.max) fail(p, "Angka di luar batas.");
    if (v.step !== undefined) { const n = (value - (v.min ?? 0)) / v.step; if (Math.abs(n - Math.round(n)) > 1e-8) fail(p, "Angka tidak sesuai kelipatan."); }
  } else if (q.type === "date") {
    if (typeof value !== "string" || !z.iso.date().safeParse(value).success || v.minDate && value < v.minDate || v.maxDate && value > v.maxDate) fail(p, "Tanggal tidak sesuai.");
  } else if (q.type === "file" && !z.uuid().safeParse(value).success) fail(p, "Unggah gambar yang diizinkan.");
}
export function formatAnswer(q: Question, a: DynamicAnswer | undefined): string {
  if (!a) return "Belum diisi";
  if (a.state === "skipped") return "Dilewati";
  if (a.state === "not_applicable") return "Tidak relevan (tersembunyi)";
  if (q.type === "yes_no") return a.value ? "Ya" : "Tidak";
  if (q.type === "file") return "Gambar tersimpan privat";
  if (choiceTypes.includes(q.type)) return (Array.isArray(a.value) ? a.value : [a.value]).map((id) => q.options.find((o) => o.id === id)?.label ?? "—").join(", ");
  return String(a.value ?? "");
}
export function emptyDefinition(name = "Template baru"): Definition {
  return definitionSchema.parse({ schemaVersion: 1, name, sections: [], questions: [] });
}
export function newQuestion(sectionId: string, type: QuestionType = "short_text"): Question {
  return questionSchema.parse({ id: crypto.randomUUID(), sectionId, type, label: "Pertanyaan baru", ...(type === "scale" ? { validation: { min: 1, max: 5, step: 1, integer: true } } : {}) });
}
export function remapDefinition(definition: Definition): Definition {
  const clone = structuredClone(definition);
  const ids = new Map<string, string>();
  for (const s of clone.sections) ids.set(s.id, crypto.randomUUID());
  for (const q of clone.questions) { ids.set(q.id, crypto.randomUUID()); for (const o of q.options) ids.set(o.id, crypto.randomUUID()); }
  for (const s of clone.sections) s.id = ids.get(s.id)!;
  for (const q of clone.questions) {
    q.id = ids.get(q.id)!; q.sectionId = ids.get(q.sectionId)!;
    for (const o of q.options) o.id = ids.get(o.id)!;
    if (q.condition) for (const leaf of ruleLeaves(q.condition)) { leaf.questionId = ids.get(leaf.questionId)!; if (typeof leaf.value === "string" && ids.has(leaf.value)) leaf.value = ids.get(leaf.value)!; }
  }
  return clone;
}
