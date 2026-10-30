import { afterEach, describe, expect, it, vi } from "vitest";
import { materializeCandidates, mockQuestionOutput, parseQuestionOutput, QUESTION_OUTPUT_BYTES, QUESTION_SYSTEM_PROMPT, type QuestionGenerationInput } from "@/lib/assessment-builder/ai-output";
import { callQuestionModel } from "@/lib/ai/question-generator";
import { newQuestion } from "@/lib/assessment-builder/definition";

const input: QuestionGenerationInput = { instructions: "Suggest supportive intake questions", target: "child", count: 2, sources: [] };
const valid = () => mockQuestionOutput(input);
const config = { baseUrl: "http://127.0.0.1:11434", model: "test-local", extension: "/v1/chat/completions", temperature: 0.2, maxTokens: 4000, timeoutSeconds: 10 };
afterEach(() => vi.unstubAllGlobals());

describe("strict question generation output", () => {
  it("is deterministic in mock mode but assigns fresh server identities", () => {
    expect(valid()).toEqual(valid());
    const parsed = parseQuestionOutput(JSON.stringify(valid()), 2, []);
    const first = materializeCandidates(parsed, "mock");
    const second = materializeCandidates(parsed, "mock");
    expect(first.candidates).toHaveLength(2);
    expect(first.candidates[0].question.id).not.toBe(second.candidates[0].question.id);
    expect(first.candidates[0].question.provenance).toEqual({ origin: "mock", candidateId: first.candidates[0].id });
    expect(first.candidates[0].question.allowSkip).toBe(true);
  });

  it.each(["score", "weights", "cutoff", "validated", "formula"])("rejects a protected %s field", (field) => {
    const output = valid();
    Object.assign(output.questions[0], { [field]: 1 });
    expect(() => parseQuestionOutput(output, 2, [])).toThrow();
  });

  it.each(["<script>alert(1)</script>", "javascript:alert(1)", "data:text/html,evil", "onclick=evil()", "```js", "eval('x')"])("rejects executable text %s", (label) => {
    const output = valid(); output.questions[0].label = label;
    expect(() => parseQuestionOutput(output, 2, [])).toThrow();
  });

  it("rejects malformed, truncated, oversized, or partial output", () => {
    expect(() => parseQuestionOutput('{"questions":', 2, [])).toThrow();
    expect(() => parseQuestionOutput(" ".repeat(QUESTION_OUTPUT_BYTES + 1), 2, [])).toThrow();
    expect(() => parseQuestionOutput(valid(), 1, [])).toThrow();
    expect(() => parseQuestionOutput({ ...valid(), extra: true }, 2, [])).toThrow();
  });

  it("rejects fabricated sources and duplicate temporary keys", () => {
    const output = valid(); output.questions[0].sourceRefs = ["invented"];
    expect(() => parseQuestionOutput(output, 2, ["s1"])).toThrow();
    output.questions[0].sourceRefs = ["s1", "s1"];
    expect(() => parseQuestionOutput(output, 2, ["s1"])).toThrow();
    output.questions[0].sourceRefs = ["s1"];
    output.questions[1].key = output.questions[0].key;
    expect(() => parseQuestionOutput(output, 2, ["s1"])).toThrow();
  });

  it("remaps branching question and option keys to stable IDs", () => {
    const output = valid();
    output.questions[0].type = "single_choice";
    output.questions[0].options = [{ key: "yes", label: "Yes", value: 99 }, { key: "no", label: "No", value: -7 }];
    output.questions[1].condition = { questionKey: "q1", operator: "equals", value: "yes" };
    const { candidates } = materializeCandidates(parseQuestionOutput(output, 2, []), "ai");
    expect(candidates[1].question.condition).toEqual({ questionId: candidates[0].question.id, operator: "equals", value: candidates[0].question.options[0].id });
    expect(candidates[0].question.options[0].value).toBe(99);
    output.questions[1].condition.value = "invalid";
    expect(() => materializeCandidates(parseQuestionOutput(output, 2, []), "ai")).toThrow();
  });

  it("rejects cycles, missing dependencies, incompatible operands, and deep rules", () => {
    const output = valid();
    output.questions[0].condition = { questionKey: "q2", operator: "contains", value: "support" };
    output.questions[1].condition = { questionKey: "q1", operator: "contains", value: "support" };
    expect(() => materializeCandidates(parseQuestionOutput(output, 2, []), "ai")).toThrow();
    output.questions[0].condition = null;
    output.questions[1].condition.questionKey = "unknown";
    expect(() => materializeCandidates(parseQuestionOutput(output, 2, []), "ai")).toThrow();
    output.questions[1].condition = { questionKey: "q1", operator: "equals", value: 5 };
    expect(() => materializeCandidates(parseQuestionOutput(output, 2, []), "ai")).toThrow();
    for (let i = 0; i < 5; i++) output.questions[1].condition = { op: "all", rules: [output.questions[1].condition!] };
    expect(() => parseQuestionOutput(output, 2, [])).toThrow();
  });

  it("retains duplicate-label warnings without claiming equivalence", () => {
    const output = valid();
    const result = materializeCandidates(output, "ai", [output.questions[0].label.toUpperCase()]);
    expect(result.candidates[0].warnings.join(" ")).toContain("review manusia");
  });
});

describe("question-only local adapter", () => {
  it("sends only explicitly selected definitions under a locked prompt", async () => {
    const question = { ...newQuestion(crypto.randomUUID(), "long_text"), label: "Selected question" };
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(valid()) } }] })));
    vi.stubGlobal("fetch", fetchSpy);
    await callQuestionModel(config, { ...input, sources: [{ ref: "s1", versionId: "private-version-id", questionId: question.id, hash: "source-hash", demoOnly: false, question }] }, null, [config.baseUrl]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
    const body = JSON.parse(init.body);
    expect(body.messages[0]).toEqual({ role: "system", content: QUESTION_SYSTEM_PROMPT });
    const context = JSON.parse(body.messages[1].content);
    expect(Object.keys(context).sort()).toEqual(["count", "instructions", "sources", "target"]);
    expect(context.sources).toEqual([{ ref: "s1", hash: "source-hash", question }]);
    expect(init.body).not.toContain("private-version-id");
  });

  it.each(["https://example.com", "http://169.254.169.254", "http://127.0.0.1:9999", "http://user:pass@127.0.0.1:11434"])("refuses unsafe endpoint %s before fetch", async (baseUrl) => {
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    await expect(callQuestionModel({ ...config, baseUrl }, input, null, [config.baseUrl])).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(["length", "tool_calls", null])("rejects incomplete finish reason %s without retry", async (finish_reason) => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason, message: { content: JSON.stringify(valid()) } }] })));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(callQuestionModel(config, input, null, [config.baseUrl])).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("bounds response streams, rejects bad envelopes, and never retries a network failure", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(new Response("x".repeat(QUESTION_OUTPUT_BYTES * 2 + 1)))
      .mockResolvedValueOnce(new Response('{"choices":'))
      .mockRejectedValueOnce(new Error("private provider details"));
    vi.stubGlobal("fetch", fetchSpy);
    for (let i = 0; i < 3; i++) await expect(callQuestionModel(config, input, null, [config.baseUrl])).rejects.toThrow(/Tidak ada percobaan ulang/);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
