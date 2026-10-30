import { expect, test, type Page } from "@playwright/test";
import { INSTRUMENTS, type Answer, type Module } from "../../src/lib/instruments";

/**
 * FR-11 / FR-12 through the browser: the generate button on a submitted
 * assessment, the simulation labelling on the result, and the review controls.
 * The installation runs in mock mode, so nothing here may reach a network
 * provider and nothing may be approved as real support.
 *
 * Everything shares one sign-in on purpose: the auth rate limit allows five
 * sign-ins per minute per address, and the whole suite runs from one address.
 */
async function login(page: Page, identity: string) {
  await page.goto("/login");
  await page.locator("#email").fill(`e2e-${identity}@panti.test`);
  await page.locator("#password").fill("FictionalE2e2026!");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const result = await page.request.post(url, { data });
  expect(result.ok(), await result.text()).toBe(true);
  return (await result.json()).data as T;
}

/** Turns AI on the way the admin screen does: save, pass the test, then enable. */
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

/** Fills every item of a module so staff can submit the fictional assessment. */
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

/** Returns the id of a submitted fictional child assessment, built over the API. */
async function submittedAssessment(page: Page, name: string): Promise<string> {
  const child = await post<{ id: string; revision: number }>(page, "/api/children", { name, fictional: true, estimatedAge: 10, ageReferenceDate: new Date().toISOString().slice(0, 10) });
  await post(page, `/api/children/${child.id}/verify`, { revision: child.revision });
  const cycle = await post<{ id: string }>(page, `/api/children/${child.id}/cycles`, {});
  const draft = await post<{ id: string; revision: number; module: Module }>(page, `/api/cycles/${cycle.id}/assessments`, { target: "child" });
  await post(page, `/api/assessments/${draft.id}/submit`, { revision: draft.revision, answers: fullAnswers(draft.module) });
  return draft.id;
}

test("generates a labelled simulation from a submitted assessment and records a review", async ({ page }) => {
  await login(page, "a");
  await enableAi(page);
  const assessmentId = await submittedAssessment(page, "Anak E2E Analisis");

  await page.goto(`/assessments/${assessmentId}`);
  await expect(page.getByRole("heading", { name: "Analisis & review AI" })).toBeVisible();
  await expect(page.getByText("Belum ada analisis untuk jawaban ini.")).toBeVisible();
  // The card is a staff control, so it must not reach paper.
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("heading", { name: "Analisis & review AI" })).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  await page.getByRole("button", { name: "Buat analisis AI", exact: true }).click();
  await expect(page).toHaveURL(/\/analyses\/[^/]+$/);
  const analysisPath = new URL(page.url()).pathname;

  await expect(page.getByRole("heading", { name: "Ringkasan pendukung berbantuan AI" })).toBeVisible();
  await expect(page.getByText(/SIMULASI DEVELOPMENT — BUKAN ANALISIS NYATA/).first()).toBeVisible();
  await expect(page.getByText("Simulasi lokal (bukan AI nyata)").first()).toBeVisible();
  await expect(page.getByText("Belum direview")).toBeVisible();
  // Evidence must lead back to the real answers rather than stand alone.
  await expect(page.getByRole("link", { name: "asesmen 1", exact: true })).toHaveAttribute("href", `/assessments/${assessmentId}`);

  // An admin may flag a revision but never decide, and a simulation can never
  // be approved as real support even when the request bypasses the form.
  const options = page.locator("#disposition option");
  await expect(options).toHaveText(["Perlu perbaikan"]);
  const refused = await page.request.post(`/api/ai${analysisPath}/reviews`, { data: { disposition: "support_approved", comment: "Mencoba menyetujui simulasi" } });
  expect(refused.status()).toBe(403);

  await page.locator("#comment").fill("Perlu dibaca ulang psikolog sebelum dipakai mendampingi anak.");
  await page.getByRole("button", { name: "Simpan keputusan" }).click();
  await expect(page.getByText("Perlu perbaikan").first()).toBeVisible();
  await expect(page.getByText("Perlu dibaca ulang psikolog sebelum dipakai mendampingi anak.")).toBeVisible();

  // A repeat run is a judgement call: the reason is mandatory and the old
  // result stays readable next to the new one.
  await page.goto(`/assessments/${assessmentId}`);
  await expect(page.getByRole("link", { name: "Analisis 1" })).toBeVisible();
  await page.getByRole("button", { name: "Analisis ulang", exact: true }).click();
  await page.locator("#regenerate-reason").fill("Menguji ulang setelah review meminta perbaikan.");
  await page.getByRole("button", { name: "Jalankan analisis ulang" }).click();
  await expect(page).toHaveURL(/\/analyses\/[^/]+$/);
  expect(new URL(page.url()).pathname).not.toBe(analysisPath);
  await expect(page.getByText("Menguji ulang setelah review meminta perbaikan.")).toBeVisible();

  await page.goto(`/assessments/${assessmentId}`);
  await expect(page.getByRole("link", { name: "Analisis 2" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Analisis 1" })).toBeVisible();
  await expect(page.getByText(/Kuota hari ini: \d+\/20 permintaan/)).toBeVisible();

  // A draft carries no submitted answers, so neither the card nor the service
  // may accept it.
  const draftChild = await post<{ id: string; revision: number }>(page, "/api/children", { name: "Anak E2E Draft AI", fictional: true, estimatedAge: 10, ageReferenceDate: new Date().toISOString().slice(0, 10) });
  await post(page, `/api/children/${draftChild.id}/verify`, { revision: draftChild.revision });
  const draftCycle = await post<{ id: string }>(page, `/api/children/${draftChild.id}/cycles`, {});
  const draft = await post<{ id: string }>(page, `/api/cycles/${draftCycle.id}/assessments`, { target: "child" });
  await page.goto(`/assessments/${draft.id}`);
  await expect(page.getByRole("heading", { name: "Analisis & review AI" })).toHaveCount(0);
  const refusedDraft = await page.request.post("/api/ai/analyses", {
    data: { childId: draftChild.id, cycleId: draftCycle.id, scope: "child", sourceAssessmentIds: [draft.id], idempotencyKey: crypto.randomUUID() },
  });
  expect(refusedDraft.status()).toBe(422);
});
