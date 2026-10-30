import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { emptyDefinition, newQuestion, type Definition } from "../../src/lib/assessment-builder/definition";

test.beforeEach(({ page }) => { page.setDefaultTimeout(15000); });

type Detail = { version: { id: string; templateId: string; revision: number; status: string; contentHash: string }; definition: Definition };
async function login(page: Page, identity = "builder") {
  await page.goto("/login");
  await page.locator("#email").fill(`e2e-${identity}@panti.test`);
  await page.locator("#password").fill("FictionalE2e2026!");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}
async function post<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const response = await request.post(url, { data }); expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).data as T;
}
async function get<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(url); expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).data as T;
}
async function save(page: Page, touch = false) {
  const button = page.getByRole("button", { name: "Simpan draft", exact: true });
  if (touch) await button.tap(); else await button.click();
  await expect(page.getByRole("status").filter({ hasText: "Draft tersimpan." })).toBeVisible();
}
async function reviewTab(page: Page) { await page.getByRole("button", { name: "Review & riwayat", exact: true }).click(); }
async function reason(page: Page) { await page.getByLabel("Catatan review / alasan tindakan").fill("Fictional operational review; not psychometric validation"); }

test("manual authoring, review, publication, scoped intake, and immutable v1 history", async ({ page, browser }, testInfo) => {
  test.setTimeout(150000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.goto("/assessment-templates");
  await page.getByLabel("Nama template baru").fill("Fictional supportive intake E2E");
  await page.getByRole("button", { name: "Buat template", exact: true }).click();
  await expect(page).toHaveURL(/\/template-versions\//);
  const versionId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.getByRole("button", { name: "Tambah bagian", exact: true }).click();
  await page.getByLabel("Judul bagian", { exact: true }).fill("Support and choices");
  await page.getByLabel("Jenis pertanyaan baru").selectOption("yes_no");
  await page.getByRole("button", { name: "Tambah pertanyaan", exact: true }).click();
  await page.getByRole("textbox", { name: "Label pertanyaan", exact: true }).fill("Do you have support?");
  await page.getByLabel("Wajib ditanggapi", { exact: true }).check();
  await page.getByLabel("Jenis pertanyaan baru").selectOption("long_text");
  await page.getByRole("button", { name: "Tambah pertanyaan", exact: true }).click();
  await page.getByRole("textbox", { name: "Label pertanyaan", exact: true }).fill("Tell us about your support");
  await page.getByLabel("Wajib ditanggapi", { exact: true }).check();
  await page.getByRole("button", { name: "Tambah kondisi", exact: true }).click();
  await page.getByLabel("Nilai kondisi").selectOption("false");
  await page.getByLabel("Jenis pertanyaan baru").selectOption("single_choice");
  await page.getByRole("button", { name: "Tambah pertanyaan", exact: true }).click();
  await page.getByRole("textbox", { name: "Label pertanyaan", exact: true }).fill("Preferred support");
  await page.getByLabel("Label opsi 1").fill("Conversation");
  await page.getByLabel("Label opsi 2").fill("Quiet time");
  await save(page);

  let detail = await get<Detail>(page.request, `/api/template-versions/${versionId}`);
  const neighbour = detail.definition.questions[1]; const picked = detail.definition.questions[2];
  const handle = page.getByRole("button", { name: "Geser Preferred support", exact: true });
  await handle.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").filter({ hasText: `droppable area ${picked.id}` })).toBeVisible();
  // dnd-kit scrolls the list toward the top before it reorders, so keep pressing until the move is announced.
  await expect(async () => {
    await handle.press("ArrowUp");
    await expect(page.getByRole("status").filter({ hasText: `droppable area ${neighbour.id}` })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20000, intervals: [0] });
  await handle.press("Space");
  await expect(page.getByRole("status").filter({ hasText: "Urutan pertanyaan dipindah ke 2." })).toBeVisible();
  await save(page);
  detail = await get<Detail>(page.request, `/api/template-versions/${versionId}`);
  expect(detail.definition.questions.map((q) => q.label)).toEqual(["Do you have support?", "Preferred support", "Tell us about your support"]);
  await page.screenshot({ path: testInfo.outputPath("builder-desktop.png"), fullPage: true });

  await page.getByRole("button", { name: "Pratinjau", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Tell us about your support", exact: true })).toBeHidden();
  await page.getByRole("radio", { name: "Tidak", exact: true }).check();
  await page.getByRole("textbox", { name: "Tell us about your support", exact: true }).fill("Ephemeral preview answer");
  await page.getByRole("radio", { name: "Ya", exact: true }).check();
  await page.getByRole("radio", { name: "Tidak", exact: true }).check();
  await expect(page.getByRole("textbox", { name: "Tell us about your support", exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Validasi jawaban", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /wajib|ditanggapi/i })).not.toHaveCount(0);
  await page.getByRole("button", { name: "Reset pratinjau", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Tidak", exact: true })).not.toBeChecked();
  expect((await get<{ total: number }>(page.request, "/api/assessment-responses")).total).toBe(0);

  // Actual HTTP verb, path, origin, body limits, and stale revision checks.
  for (const url of [`/api/template-versions/${versionId}/publish/extra`, `/api/template-versions/${versionId}/x/y/z`]) expect((await page.request.post(url, { data: {} })).status()).toBe(404);
  expect((await page.request.delete(`/api/template-versions/${versionId}`)).status()).toBe(405);
  expect((await page.request.patch(`/api/template-versions/${versionId}`, { headers: { origin: "http://untrusted.test" }, data: {} })).status()).toBe(403);
  expect((await page.request.patch(`/api/template-versions/${versionId}`, { data: { revision: 1, definition: detail.definition } })).status()).toBe(409);
  expect((await page.request.patch(`/api/template-versions/${versionId}`, { data: { revision: detail.version.revision, definition: { ...detail.definition, score: 1 } } })).status()).toBe(422);
  expect((await page.request.patch(`/api/template-versions/${versionId}`, { headers: { "content-type": "application/json" }, data: JSON.stringify({ padding: "x".repeat(520 * 1024) }) })).status()).toBe(422);

  await reviewTab(page); await reason(page);
  await page.getByRole("button", { name: "Ajukan review psikolog", exact: true }).click();
  await expect(page.getByText(/v1 · in_review/)).toBeVisible();
  detail = await get<Detail>(page.request, `/api/template-versions/${versionId}`);
  expect((await page.request.post(`/api/template-versions/${versionId}/publish`, { data: { revision: detail.version.revision, note: "Not yet approved" } })).status()).toBe(403);
  const psychContext = await browser.newContext(); const psych = await psychContext.newPage();
  await login(psych, "psych"); await psych.goto(`/template-versions/${versionId}`);
  await psych.getByLabel("Periksa pertanyaan").selectOption(detail.definition.questions.at(-1)!.id);
  await expect(psych.getByRole("textbox", { name: "Label pertanyaan", exact: true })).toHaveValue("Tell us about your support");
  await reviewTab(psych); await reason(psych);
  await psych.getByRole("button", { name: "Setujui konten", exact: true }).click();
  await expect(psych.getByText(/approved · revisi/)).toBeVisible();
  await page.getByRole("button", { name: "Muat ulang", exact: true }).click();
  await page.getByRole("button", { name: "Publikasikan versi disetujui", exact: true }).click();
  await expect(page.getByText(/v1 · published/)).toBeVisible();
  detail = await get<Detail>(page.request, `/api/template-versions/${versionId}`);
  await psychContext.close();

  const child = await post<{ id: string; revision: number }>(page.request, "/api/children", { name: "Builder fictional participant", fictional: true, estimatedAge: 12, ageReferenceDate: "2026-10-01" });
  await post(page.request, `/api/children/${child.id}/verify`, { revision: child.revision });
  const cycle = await post<{ id: string }>(page.request, `/api/children/${child.id}/cycles`, {});
  await page.goto(`/cycles/${cycle.id}`);
  await page.getByRole("button", { name: "Cari template", exact: true }).click();
  await page.getByRole("combobox", { name: "Template", exact: true }).selectOption(detail.version.templateId);
  await page.getByRole("button", { name: "Tugaskan formulir", exact: true }).click();
  await page.getByRole("link", { name: /Builder fictional participant · / }).click();
  await expect(page).toHaveURL(/\/assessment-responses\//);
  const responseId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.getByRole("button", { name: "Siapkan sesi peserta", exact: true }).click();
  const handoff = await page.getByRole("link", { name: "Serahkan perangkat & mulai", exact: true }).getAttribute("href");
  const participantContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const participant = await participantContext.newPage();
  await participant.goto(handoff!);
  await expect(participant).toHaveURL(/\/intake$/);
  for (const url of ["/api/assessment-templates", `/api/template-versions/${versionId}`, "/api/assessment-responses", "/api/ai-question-jobs/forged"]) expect((await participant.request.get(url)).status()).toBe(403);
  const wire = await get<{ revision: number }>(participant.request, "/api/intake/current");
  expect((await participant.request.patch("/api/intake/current", { data: { revision: wire.revision, responseId: crypto.randomUUID(), answers: [] } })).status()).toBe(422);
  const choice = detail.definition.questions.find((q) => q.type === "single_choice")!;
  expect((await participant.request.patch("/api/intake/current", { data: { revision: wire.revision, answers: [{ questionId: choice.id, value: crypto.randomUUID(), state: "answered", assistance: "none", skipReason: null }] } })).status()).toBe(422);
  await participant.getByRole("radio", { name: "Tidak", exact: true }).check();
  await participant.getByRole("textbox", { name: "Tell us about your support", exact: true }).fill("Discard this hidden answer");
  await participant.getByRole("button", { name: "Simpan sekarang", exact: true }).click();
  await expect(participant.getByRole("status").filter({ hasText: /^Tersimpan$/ })).toBeVisible();
  await participant.getByRole("radio", { name: "Ya", exact: true }).check();
  await participant.getByRole("button", { name: "Simpan & jeda", exact: true }).click();
  await participant.getByRole("button", { name: "Lanjutkan", exact: true }).click();
  await participant.reload();
  await expect(participant.getByRole("radio", { name: "Ya", exact: true })).toBeChecked();
  expect(JSON.stringify(await get(participant.request, "/api/intake/current"))).not.toContain("Discard this hidden answer");
  await participant.getByRole("radio", { name: "Tidak", exact: true }).check();
  await expect(participant.getByRole("textbox", { name: "Tell us about your support", exact: true })).toHaveValue("");
  await participant.getByRole("textbox", { name: "Tell us about your support", exact: true }).fill("Fresh fictional support answer");
  await participant.getByRole("radio", { name: "Conversation", exact: true }).check();
  await participant.screenshot({ path: testInfo.outputPath("intake-mobile.png"), fullPage: true });
  await participant.getByRole("button", { name: "Periksa jawaban", exact: true }).click();
  await participant.getByRole("button", { name: "Kirim jawaban", exact: true }).click();
  await expect(participant.getByRole("heading", { name: "Jawaban sudah terkirim", exact: true })).toBeVisible();
  const receipt = await get<{ answers: unknown[] }>(participant.request, "/api/intake/current"); expect(receipt.answers).toEqual([]);
  await participant.getByRole("button", { name: "Selesai & kembalikan perangkat", exact: true }).click();
  await participantContext.close();
  const before = await get<{ answers: unknown[]; response: { contentHash: string } }>(page.request, `/api/assessment-responses/${responseId}`);

  // Publishing v2 cannot rewrite the old submitted response or its labels/hash.
  let v2 = await post<Detail>(page.request, `/api/assessment-templates/${detail.version.templateId}/versions`, { sourceVersionId: versionId });
  v2.definition.questions[0].label = "Revised support wording v2";
  const saved = await page.request.patch(`/api/template-versions/${v2.version.id}`, { data: { revision: v2.version.revision, definition: v2.definition } });
  expect(saved.ok()).toBe(true); v2 = (await saved.json()).data;
  v2 = await post<Detail>(page.request, `/api/template-versions/${v2.version.id}/submit-review`, { revision: v2.version.revision, note: "Review second version" });
  const reviewer = await browser.newContext(); const reviewerPage = await reviewer.newPage(); await login(reviewerPage, "psych");
  v2 = await post<Detail>(reviewerPage.request, `/api/template-versions/${v2.version.id}/review`, { revision: v2.version.revision, note: "Approved second intake version", decision: "approved" });
  await post(page.request, `/api/template-versions/${v2.version.id}/publish`, { revision: v2.version.revision, note: "Publish exact second version" });
  const after = await get<{ answers: unknown[]; response: { contentHash: string } }>(page.request, `/api/assessment-responses/${responseId}`);
  expect(after.answers).toEqual(before.answers); expect(after.response.contentHash).toBe(before.response.contentHash);
  await page.goto(`/assessment-responses/${responseId}`);
  await expect(page.getByText("Fresh fictional support answer", { exact: true })).toBeVisible();
  await expect(page.getByText("Do you have support?", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("historical-v1.png"), fullPage: true });
  await reviewer.close();
});

test("mobile touch sorting and explicit image opt-in", async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(); await login(page);
  const d = emptyDefinition("Touch sorting fixture"); const section = { id: crypto.randomUUID(), title: "Touch questions", instructions: "", active: true, archived: false };
  d.sections = [section]; d.questions = ["First touch question", "Second touch question"].map((label) => ({ ...newQuestion(section.id, "short_text"), label }));
  const created = await post<Detail>(page.request, "/api/assessment-templates", { name: d.name });
  expect((await page.request.patch(`/api/template-versions/${created.version.id}`, { data: { revision: 1, definition: d } })).ok()).toBe(true);
  await page.goto(`/template-versions/${created.version.id}`);
  const second = page.getByRole("button", { name: "Geser Second touch question", exact: true });
  await second.scrollIntoViewIfNeeded();
  const from = await second.boundingBox(); const to = await page.getByRole("button", { name: "Geser First touch question", exact: true }).boundingBox();
  expect(from).not.toBeNull(); expect(to).not.toBeNull();
  const cdp = await context.newCDPSession(page);
  const x = from!.x + from!.width / 2; const y = from!.y + from!.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - 15 }] });
  await expect(page.getByRole("status").filter({ hasText: `droppable area ${d.questions[1].id}` })).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: to!.y + to!.height / 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.getByRole("status").filter({ hasText: "Urutan pertanyaan dipindah ke 1." })).toBeVisible();
  await save(page, true);
  expect((await get<Detail>(page.request, `/api/template-versions/${created.version.id}`)).definition.questions[0].label).toBe("Second touch question");
  await page.getByLabel("Jenis pertanyaan baru").selectOption("file");
  await page.getByRole("button", { name: "Tambah pertanyaan", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /Aktifkan izin unggahan/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("builder-mobile.png"), fullPage: true });
  await context.close();
});
