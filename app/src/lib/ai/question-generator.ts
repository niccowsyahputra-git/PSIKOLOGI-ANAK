import { z } from "zod";
import { boundedJson } from "@/lib/bounded-body";
import { QUESTION_SYSTEM_PROMPT, QUESTION_OUTPUT_BYTES, type QuestionGenerationInput } from "@/lib/assessment-builder/ai-output";
import { LocalModelError, resolveLocalModelTarget, type LocalModelConfig } from "./local-model";

/** A separate, bounded question-only adapter. It never receives case context. */
export async function callQuestionModel(config: LocalModelConfig, input: QuestionGenerationInput, apiKey: string | null, allowedOrigins: readonly string[]): Promise<string> {
  const target = resolveLocalModelTarget(config, allowedOrigins);
  const payload = JSON.stringify({ model: config.model, temperature: config.temperature, max_tokens: config.maxTokens, stream: false, response_format: { type: "json_object" }, messages: [{ role: "system", content: QUESTION_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify({ instructions: input.instructions, target: input.target, count: input.count, sources: input.sources.map(({ ref, hash, question }) => ({ ref, hash, question })) }) }] });
  if (Buffer.byteLength(payload) > 256 * 1024) throw new LocalModelError("Definisi sumber AI terlalu besar.");
  try {
    const response = await fetch(target, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(config.timeoutSeconds * 1000), headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, body: payload });
    if (!response.ok) throw new Error("Provider failed");
    const envelope = z.object({ choices: z.array(z.object({ finish_reason: z.literal("stop"), message: z.object({ content: z.string().min(1) }) })).length(1) }).parse(await boundedJson(new Request("http://localhost/response", { method: "POST", body: response.body, duplex: "half" } as RequestInit), QUESTION_OUTPUT_BYTES * 2));
    if (Buffer.byteLength(envelope.choices[0].message.content) > QUESTION_OUTPUT_BYTES) throw new Error("Output too large");
    return envelope.choices[0].message.content;
  } catch {
    throw new LocalModelError("Generasi pertanyaan lokal gagal, terpotong, atau tidak sesuai kontrak. Tidak ada percobaan ulang otomatis.");
  }
}
