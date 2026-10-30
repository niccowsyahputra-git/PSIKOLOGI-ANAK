import { describe, expect, it } from "vitest";
import { compileDefinition, emptyDefinition, formatAnswer, newQuestion, normalizeAnswers, remapDefinition, visibleQuestionIds, type Definition, type DynamicAnswer, type Question, type Rule } from "@/lib/assessment-builder/definition";
const id = () => crypto.randomUUID();
function fixture(type: Question["type"] = "short_text"): Definition {
  const d = emptyDefinition("Asesmen dukungan keluarga");
  const section = { id: id(), title: "Keluarga", instructions: "", active: true, archived: false };
  d.sections = [section]; const q = newQuestion(section.id, type); q.required = true;
  if (["single_choice", "multiple_choice", "dropdown"].includes(type)) q.options = [{ id: id(), label: "Pertama", value: 1 }, { id: id(), label: "Kedua", value: 2 }];
  if (type === "information") q.required = false;
  if (type === "file") d.allowImages = true;
  d.questions = [q]; return d;
}
const answer = (q: Question, value: DynamicAnswer["value"]): DynamicAnswer => ({ questionId: q.id, value, state: "answered", assistance: "none", skipReason: null });

describe("dynamic form definition", () => {
  it("compiles all eleven input types and keeps input immutable", () => {
    for (const type of ["short_text", "long_text", "single_choice", "multiple_choice", "yes_no", "number", "date", "dropdown", "scale", "information", "file"] as const) {
      const d = fixture(type); d.questions[0].allowSkip = false;
      const result = compileDefinition(d, type !== "information");
      expect(result.definition.questions[0].allowSkip).toBe(true);
      expect(d.questions[0].allowSkip).toBe(false);
    }
  });
  it("permits incomplete drafts but never publishes an empty or unlabeled form", () => {
    expect(compileDefinition(emptyDefinition()).ordered).toHaveLength(0);
    expect(() => compileDefinition(emptyDefinition(), true)).toThrow();
    const d = fixture(); d.questions[0].label = "";
    expect(() => compileDefinition(d)).not.toThrow();
    expect(() => compileDefinition(d, true)).toThrow();
  });
  it("rejects unknown scoring fields and incompatible validation", () => {
    expect(() => compileDefinition({ ...fixture(), cutoff: 10 })).toThrow();
    const d = fixture("yes_no"); d.questions[0].validation = { min: 2 };
    expect(() => compileDefinition(d)).toThrow();
  });
  it("rejects duplicate question and option identities", () => {
    const d = fixture("single_choice"); d.questions.push(structuredClone(d.questions[0]));
    expect(() => compileDefinition(d)).toThrow(/duplikat/);
    d.questions.pop(); d.questions[0].options[1].id = d.questions[0].options[0].id;
    expect(() => compileDefinition(d)).toThrow(/duplikat/);
  });
  it("refuses images unless enabled and information-only publication", () => {
    const d = fixture("file"); d.allowImages = false;
    expect(() => compileDefinition(d)).toThrow(/gambar/);
    expect(() => compileDefinition(fixture("information"), true)).toThrow();
  });
  it("warns about duplicate wording", () => {
    const d = fixture(); d.questions.push({ ...d.questions[0], id: id() });
    expect(compileDefinition(d).warnings).toHaveLength(1);
  });
  it("remaps identities and dependent rules when duplicating a template", () => {
    const d = fixture("single_choice"); const source = d.questions[0];
    d.questions.push({ ...newQuestion(d.sections[0].id), condition: { questionId: source.id, operator: "equals", value: source.options[0].id } });
    const clone = remapDefinition(d); expect(clone.questions[0].id).not.toBe(source.id);
    expect(clone.questions[1].condition).toEqual({ questionId: clone.questions[0].id, operator: "equals", value: clone.questions[0].options[0].id });
    expect(() => compileDefinition(clone, true)).not.toThrow();
  });
});
describe("conditional logic", () => {
  function branching() {
    const d = fixture("yes_no"); const root = d.questions[0];
    const follow = { ...newQuestion(d.sections[0].id), required: true, condition: { questionId: root.id, operator: "equals" as const, value: false } };
    d.questions.push(follow); return { d, root, follow };
  }
  it("supports a negative answer and evaluates dependencies independent of display order", () => {
    const { d, root, follow } = branching(); d.questions.reverse();
    const c = compileDefinition(d, true);
    expect(c.topological[0].id).toBe(root.id);
    expect(visibleQuestionIds(c, [answer(root, false)]).has(follow.id)).toBe(true);
    expect(visibleQuestionIds(c, [answer(root, true)]).has(follow.id)).toBe(false);
  });
  it("does not treat unanswered or skipped as not-equal", () => {
    const { d, root, follow } = branching(); follow.condition.operator = "not_equals" as "equals";
    const c = compileDefinition(d);
    expect(visibleQuestionIds(c, []).has(follow.id)).toBe(false);
    expect(visibleQuestionIds(c, [{ ...answer(root, null), state: "skipped" }]).has(follow.id)).toBe(false);
  });
  it("clears previously answered hidden questions and never restores them after reveal", () => {
    const { d, root, follow } = branching(); const c = compileDefinition(d);
    const hidden = normalizeAnswers(c, [answer(root, true), answer(follow, "Do not retain this")], true);
    expect(hidden.find((a) => a.questionId === follow.id)).toMatchObject({ state: "not_applicable", value: null });
    expect(JSON.stringify(hidden)).not.toContain("Do not retain");
    const revealed = normalizeAnswers(c, hidden.map((a) => a.questionId === root.id ? answer(root, false) : a));
    expect(revealed.find((a) => a.questionId === follow.id)).toBeUndefined();
    expect(() => normalizeAnswers(c, revealed, true)).toThrow(/wajib/);
  });
  it("ignores hidden source values even when a client submits them", () => {
    const { d, root, follow } = branching();
    const third = { ...newQuestion(d.sections[0].id), condition: { questionId: follow.id, operator: "equals" as const, value: "secret" } };
    d.questions.push(third);
    const normalized = normalizeAnswers(compileDefinition(d), [answer(root, true), answer(follow, "secret"), answer(third, "injected")]);
    expect(normalized.filter((a) => a.state === "not_applicable")).toHaveLength(2);
  });
  it("supports AND/OR and text contains", () => {
    const d = fixture(); const root = d.questions[0]; const leaf: Rule = { questionId: root.id, operator: "contains", value: "keluarga" };
    const q = { ...newQuestion(d.sections[0].id), condition: { op: "all" as const, rules: [leaf, { op: "any" as const, rules: [leaf, { ...leaf, value: "teman" }] }] } };
    d.questions.push(q); const c = compileDefinition(d);
    expect(visibleQuestionIds(c, [answer(root, "KELUARGA membantu")]).has(q.id)).toBe(true);
    expect(visibleQuestionIds(c, [answer(root, "lainnya")]).has(q.id)).toBe(false);
  });
  it("validates multiple-choice membership against option IDs", () => {
    const d = fixture("multiple_choice"); const source = d.questions[0];
    const q = { ...newQuestion(d.sections[0].id), condition: { questionId: source.id, operator: "contains" as const, value: source.options[0].id } };
    d.questions.push(q);
    expect(visibleQuestionIds(compileDefinition(d), [answer(source, [source.options[0].id])]).has(q.id)).toBe(true);
    q.condition.value = id(); expect(() => compileDefinition(d)).toThrow(/Opsi/);
  });
  it("rejects cycles, foreign and archived dependencies, and excessive depth", () => {
    const { d, root, follow } = branching(); root.condition = { questionId: follow.id, operator: "contains", value: "x" };
    expect(() => compileDefinition(d)).toThrow(/melingkar/);
    root.condition = null; follow.condition.questionId = id(); expect(() => compileDefinition(d)).toThrow();
    follow.condition.questionId = root.id; root.archived = true; expect(() => compileDefinition(d)).toThrow();
    root.archived = false; let rule: Rule = follow.condition;
    for (let i = 0; i < 5; i++) rule = { op: "all", rules: [rule] };
    d.questions[1].condition = rule; expect(() => compileDefinition(d)).toThrow(/tingkat/);
  });
});
describe("answer validation", () => {
  it.each(["short_text", "long_text"] as const)("validates %s length", (type) => {
    const d = fixture(type); const q = d.questions[0]; q.validation = { minLength: 2, maxLength: 5 };
    const c = compileDefinition(d); expect(normalizeAnswers(c, [answer(q, "baik")], true)).toHaveLength(1);
    for (const value of ["", "x", "too long", 123]) expect(() => normalizeAnswers(c, [answer(q, value)], true)).toThrow();
  });
  it.each(["single_choice", "dropdown", "multiple_choice"] as const)("validates %s IDs", (type) => {
    const d = fixture(type); const q = d.questions[0]; const c = compileDefinition(d); const oid = q.options[0].id;
    const a = answer(q, type === "multiple_choice" ? [oid] : oid);
    expect(formatAnswer(q, normalizeAnswers(c, [a], true)[0])).toBe("Pertama");
    expect(() => normalizeAnswers(c, [answer(q, type === "multiple_choice" ? [oid, oid] : id())], true)).toThrow();
  });
  it("validates numeric range, step, finite values, and integer requirements", () => {
    const d = fixture("number"); const q = d.questions[0]; q.validation = { min: 0, max: 10, step: 2, integer: true };
    const c = compileDefinition(d); expect(normalizeAnswers(c, [answer(q, 4)], true)).toHaveLength(1);
    for (const value of [Infinity, NaN, -2, 11, 3, "4"]) expect(() => normalizeAnswers(c, [answer(q, value)], true)).toThrow();
  });
  it("validates date-only leap years and bounds", () => {
    const d = fixture("date"); const q = d.questions[0]; q.validation = { minDate: "2024-01-01", maxDate: "2024-12-31" }; const c = compileDefinition(d);
    expect(normalizeAnswers(c, [answer(q, "2024-02-29")], true)).toHaveLength(1);
    for (const value of ["2024-02-30", "2023-02-29", "2025-01-01", "2024-01-01T00:00:00Z"]) expect(() => normalizeAnswers(c, [answer(q, value)], true)).toThrow();
  });
  it("requires explicit answers/skips without coercing false or zero", () => {
    const d = fixture("yes_no"); const q = d.questions[0]; const c = compileDefinition(d);
    expect(formatAnswer(q, normalizeAnswers(c, [answer(q, false)], true)[0])).toBe("Tidak");
    expect(() => normalizeAnswers(c, [], true)).toThrow();
    expect(normalizeAnswers(c, [{ ...answer(q, null), state: "skipped" }], true)[0].state).toBe("skipped");
    expect(() => normalizeAnswers(c, [{ ...answer(q, false), state: "skipped" }], true)).toThrow();
  });
  it("rejects unknown/duplicate answers and answers to information", () => {
    const d = fixture(); const a = answer(d.questions[0], "okay");
    expect(() => normalizeAnswers(compileDefinition(d), [a, a])).toThrow();
    expect(() => normalizeAnswers(compileDefinition(d), [{ ...a, questionId: id() }])).toThrow();
    const info = fixture("information"); expect(() => normalizeAnswers(compileDefinition(info), [answer(info.questions[0], "x")])).toThrow();
  });
});
