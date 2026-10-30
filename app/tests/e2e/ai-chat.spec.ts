import { expect, test, type Page } from "@playwright/test";
import { INSTRUMENTS, type Answer, type Module } from "../../src/lib/instruments";

/**
 * The staff discussion assistant through the browser: the menu entry, the data
 * boundary stated on screen, and one stored turn. The installation runs in mock
 * mode, so nothing here may reach a network provider, and the answer on screen
 * must carry only pseudonymous material read from this database.
 *
 * One sign-in on purpose: the login limiter allows five attempts per minute per
 * account and the whole suite runs from one address.
 */
const CHILD_NAME = "Anak E2E Diskusi";
const CHILD_NOTE = "Catatan bebas pengasuh tentang kerabat";

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const result = await page.request.post(url, { data });
  expect(result.ok(), await result.text()).toBe(true);
  return (await result.json()).data as T;
}

/** Turns AI on the way the admin screen does: test the configuration, then save it enabled. */
async function enableAi(page: Page) {
  const tested = await page.request.post("/api/admin/ai-settings/test");
  expect(tested.ok(), await tested.text()).toBe(true);
  const current = await page.request.get("/api/admin/ai-settings");
  const { revision } = (await current.json()).data as { revision: number };
  const saved = await page.request.put("/api/admin/ai-settings", {
    data: { mode: "mock", providerName: "Mock lokal", extension: "/v1/chat/completions", temperature: 0.2, maxTokens: 2000, timeoutSeconds: 45, dailyLimit: 20, enabled: true, revision },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
}

function fullAnswers(module: Module): Answer[] {
  return INSTRUMENTS[module].map((item, index) => {
    if (item.kind === "likert") return { itemId: item.id, kind: "likert", state: "answered", assistance: "none", value: (index % 5) + 1 };
    if (item.kind === "emotion") return { itemId: "A01", kind: "emotion", state: "answered", assistance: "none", value: "senang" };
    if (item.kind === "media") return { itemId: "A02", kind: "media", state: "answered", assistance: "none", activityMode: "paper_pending", initialAttachmentId: null };
    return item.sensitive
      ? { itemId: item.id, kind: "text", state: "skipped", assistance: "none", value: null }
      : { itemId: item.id, kind: "text", state: "answered", assistance: "none", value: `Jawaban fiktif ${item.id}` };
  });
}

/** A fictional child with one submitted assessment, so the thread has data to read. */
async function childWithSubmittedCycle(page: Page): Promise<string> {
  const child = await post<{ id: string; revision: number }>(page, "/api/children", {
    name: CHILD_NAME, fictional: true, estimatedAge: 15, ageReferenceDate: new Date().toISOString().slice(0, 10), notes: CHILD_NOTE,
  });
  await post(page, `/api/children/${child.id}/verify`, { revision: child.revision });
  const cycle = await post<{ id: string }>(page, `/api/children/${child.id}/cycles`, {});
  const draft = await post<{ id: string; revision: number; module: Module }>(page, `/api/cycles/${cycle.id}/assessments`, { target: "child" });
  await post(page, `/api/assessments/${draft.id}/submit`, { revision: draft.revision, answers: fullAnswers(draft.module) });
  return child.id;
}

test("discusses a child from this database only, and labels the simulation", async ({ page, request }) => {
  // The assistant is staff-only: an anonymous caller reaches neither screen nor API.
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/login$/);
  expect((await request.get("/api/ai-chat")).status()).toBe(401);
  expect((await request.post("/api/ai-chat", { data: { title: "Diskusi penyusup", childId: null } })).status()).toBe(401);

  await page.goto("/login");
  await page.locator("#email").fill("e2e-c@panti.test");
  await page.locator("#password").fill("FictionalE2e2026!");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await enableAi(page);
  const childId = await childWithSubmittedCycle(page);

  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu aplikasi" })).toBeVisible();
  await page.getByRole("link", { name: "Diskusi AI", exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);

  // Staff must be able to read the boundary before they type the first question.
  await expect(page.getByRole("heading", { name: "Apa yang dibaca asisten" })).toBeVisible();
  await expect(page.getByText("Tidak ada internet, berkas luar, atau data panti lain.")).toBeVisible();
  await expect(page.getByText(/catatan bebas staf/)).toBeVisible();
  await expect(page.getByText(/\d+\/20 permintaan hari ini/).first()).toBeVisible();
  await expect(page.getByText(/Mode simulasi aktif/)).toBeVisible();

  await page.locator("#thread-title").fill("Pendampingan harian setelah siklus pertama");
  await page.locator("#thread-child").selectOption(childId);
  await page.getByRole("button", { name: "Mulai diskusi" }).click();
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  await expect(page.getByText("Belum ada pertanyaan")).toBeVisible();

  await page.locator("#chat-question").fill("Siklus mana yang sudah ditutup untuk anak ini?");
  await page.getByRole("button", { name: "Kirim pertanyaan" }).click();

  const answer = page.getByRole("listitem").filter({ hasText: "SIMULASI LOKAL" });
  await expect(answer).toBeVisible();
  await expect(answer.getByText("Simulasi", { exact: true })).toBeVisible();
  await expect(answer).toContainText("SIKLUS-1");
  await expect(answer).toContainText("basis data lokal ini");
  // The answer travels with aliases, so neither the real name nor the internal
  // id nor a caregiver's free-text note may appear inside it.
  const answerText = await answer.innerText();
  expect(answerText).not.toContain(CHILD_NAME);
  expect(answerText).not.toContain(CHILD_NOTE);
  expect(answerText).not.toContain(childId);

  // The question is retained as its own turn, attributed to the staff member.
  const question = page.getByRole("listitem").filter({ hasText: "Siklus mana yang sudah ditutup" });
  await expect(question).toContainText("Staf Uji");
  await expect(page.locator("#chat-question")).toHaveValue("");

  await page.goto("/chat");
  await expect(page.getByRole("link", { name: /Pendampingan harian setelah siklus pertama/ })).toBeVisible();
  await expect(page.getByText(/2 pesan/)).toBeVisible();

  // A thread without a child reads aggregate counts, never a child's answers.
  await page.locator("#thread-title").fill("Gambaran panti minggu ini");
  await page.getByRole("button", { name: "Mulai diskusi" }).click();
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  await expect(page.getByText(/Diskusi umum panti · dibuka/)).toBeVisible();
  await page.locator("#chat-question").fill("Berapa siklus yang masih berjalan di panti ini?");
  await page.getByRole("button", { name: "Kirim pertanyaan" }).click();
  const generalAnswer = page.getByRole("listitem").filter({ hasText: "SIMULASI LOKAL" });
  await expect(generalAnswer).toContainText("Siklus per status");
  expect(await generalAnswer.innerText()).not.toContain("Jawaban fiktif");
});
