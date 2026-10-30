import { expect, test, type Page } from "@playwright/test";

/**
 * The two admin configuration screens the admin asked for (FR-10, FR-17), plus
 * the letterhead reaching the dashboard and the printed assessment page. All
 * data here is fictional and lives in the isolated e2e installation.
 */
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("FictionalE2e2026!");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/**
 * The phone shell keeps four tabs at the bottom; every administrative screen
 * lives in the overflow sheet behind the "Menu" tab.
 */
async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu aplikasi" })).toBeVisible();
}

test.describe("admin configuration screens", () => {
  test("keeps both screens behind authentication", async ({ page, request }) => {
    await page.goto("/admin/general-settings");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/admin/ai-settings");
    await expect(page).toHaveURL(/\/login$/);

    const write = await request.put("/api/admin/general-settings", {
      data: { name: "Panti Penyusup", timezone: "Asia/Jakarta", revision: 1 },
    });
    expect(write.status()).toBe(401);

    const read = await request.get("/api/admin/ai-settings");
    expect(read.status()).toBe(401);
    expect(await read.text()).not.toContain("keyCiphertext");
  });

  test("hides both screens from a non-admin caregiver", async ({ page }) => {
    await login(page, "e2e-pengasuh@panti.test");

    await openMenu(page);
    await expect(page.getByRole("link", { name: "Profil panti", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Konfigurasi AI", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    // The dashboard identity card stays readable, but without an edit link.
    await expect(page.getByText("Panti penyelenggara")).toBeVisible();
    await expect(page.getByRole("link", { name: "Ubah profil panti" })).toHaveCount(0);

    await page.goto("/admin/ai-settings");
    await expect(page.getByText("Akses ditolak")).toBeVisible();

    const denied = await page.request.get("/api/admin/ai-settings");
    expect(denied.status()).toBe(403);
  });

  test("saves the panti profile and shows it on the dashboard and printed page", async ({
    page,
  }) => {
    await login(page, "e2e-a@panti.test");

    await openMenu(page);
    await page.getByRole("link", { name: "Profil panti", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/general-settings$/);

    await page.locator("#org-name").fill("Panti Asuhan Fiktif Melati");
    await page.locator("#org-address").fill("Jl. Fiktif 42, Bandung");
    await page.locator("#org-phone").fill("+62 22 555 0001");
    await page.locator("#org-email").fill("kontak@melati.test");
    await page.locator("#org-leader").fill("Ibu Fiktif Sari");
    await page.locator("#org-leader-title").fill("Kepala Panti");
    await page.getByRole("button", { name: "Simpan profil panti" }).click();

    await expect(page.getByRole("status")).toContainText("Profil panti disimpan");
    // A second save must not be refused as a stale revision.
    await page.locator("#org-registration").fill("AHU-FIKTIF-01");
    await page.getByRole("button", { name: "Simpan profil panti" }).click();
    await expect(page.getByRole("status")).toContainText("Profil panti disimpan");

    await page.reload();
    await expect(page.locator("#org-name")).toHaveValue("Panti Asuhan Fiktif Melati");
    await expect(page.locator("#org-registration")).toHaveValue("AHU-FIKTIF-01");

    // The readiness card reports the letterhead as complete.
    await expect(page.getByText("Kop panti")).toBeVisible();

    await page.goto("/dashboard");
    await expect(page.getByText("Panti Asuhan Fiktif Melati").first()).toBeVisible();
    await expect(page.getByText("Jl. Fiktif 42, Bandung")).toBeVisible();
    await expect(page.getByText(/\+62 22 555 0001/)).toBeVisible();

    // The letterhead is hidden on screen and only revealed by print media.
    const child = await page.request.post("/api/children", {
      data: {
        name: "Anak Fiktif Kop",
        fictional: true,
        estimatedAge: 10,
        ageReferenceDate: new Date().toISOString().slice(0, 10),
      },
    });
    expect(child.ok(), await child.text()).toBe(true);
    const childData = (await child.json()).data as { id: string; revision: number };
    await page.request.post(`/api/children/${childData.id}/verify`, {
      data: { revision: childData.revision },
    });
    const cycle = await page.request.post(`/api/children/${childData.id}/cycles`, { data: {} });
    const cycleId = ((await cycle.json()).data as { id: string }).id;
    const assessment = await page.request.post(`/api/cycles/${cycleId}/assessments`, {
      data: { target: "child" },
    });
    const assessmentId = ((await assessment.json()).data as { id: string }).id;

    await page.goto(`/assessments/${assessmentId}`);
    const letterhead = page.getByText("No. registrasi: AHU-FIKTIF-01");
    await expect(letterhead).toBeHidden();

    await page.emulateMedia({ media: "print" });
    await expect(letterhead).toBeVisible();
    await expect(page.getByText("Rekaman Jawaban Asesmen Psikososial")).toBeVisible();
    await expect(page.getByText("Ibu Fiktif Sari")).toBeVisible();
    // Interactive controls must not reach paper.
    await expect(page.getByRole("button", { name: "Cetak jawaban" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Koreksi & penarikan" })).toBeHidden();
    await page.emulateMedia({ media: "screen" });
    await expect(page.getByRole("button", { name: "Cetak jawaban" })).toBeVisible();
  });

  test("refuses to enable AI before the saved configuration passes a test", async ({ page }) => {
    await login(page, "e2e-c@panti.test");

    await openMenu(page);
    await page.getByRole("link", { name: "Konfigurasi AI", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/ai-settings$/);

    await expect(page.getByText("AI nonaktif")).toBeVisible();
    await expect(page.getByText("Belum diuji")).toBeVisible();
    await expect(page.getByText("API key tersimpan", { exact: true })).toBeVisible();

    // Remote providers are refused by policy, so the option cannot be chosen.
    await expect(page.locator('#ai-mode option[value="remote_endpoint"]')).toBeDisabled();

    const enable = page.getByRole("checkbox", {
      name: /Aktifkan bantuan AI untuk konfigurasi ini/,
    });
    await expect(enable).toBeDisabled();

    // The server refuses the same thing even when the form is bypassed.
    const settings = await page.request.get("/api/admin/ai-settings");
    const current = (await settings.json()).data as { revision: number };
    const refused = await page.request.put("/api/admin/ai-settings", {
      data: {
        mode: "mock",
        providerName: "Mock lokal",
        extension: "/v1/chat/completions",
        temperature: 0.2,
        maxTokens: 2000,
        timeoutSeconds: 45,
        dailyLimit: 20,
        enabled: true,
        revision: current.revision,
      },
    });
    expect(refused.status()).toBe(422);
    expect((await refused.json()).error.fieldErrors.enabled).toBeTruthy();

    // A mock test passes without any outbound request and then permits enabling.
    await page.getByRole("button", { name: "Uji konfigurasi" }).click();
    await expect(page.getByRole("status").first()).toContainText(
      "tidak menguji provider AI nyata",
    );
    await expect(page.getByText("Uji lulus untuk konfigurasi ini")).toBeVisible();

    await enable.check();
    await page.getByRole("button", { name: "Simpan konfigurasi" }).click();
    await expect(page.getByText("AI aktif")).toBeVisible();
  });

  test("refuses a local endpoint the server has not allowlisted", async ({ page }) => {
    await login(page, "e2e-b@panti.test");
    await page.goto("/admin/ai-settings");

    await page.locator("#ai-mode").selectOption("local_endpoint");
    await page.locator("#ai-base-url").fill("http://169.254.169.254");
    await page.locator("#ai-model").fill("llama3");
    await page.getByRole("button", { name: "Simpan konfigurasi" }).click();

    // ALLOW_LOCAL_AI_ENDPOINT is false in the e2e installation, so the mode
    // itself is refused before the address is even considered. The whole run
    // shares one organization, so only the stored mode is asserted here.
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByText("Mode mock (simulasi)")).toBeVisible();

    const stored = await page.request.get("/api/admin/ai-settings");
    const data = (await stored.json()).data as { mode: string; baseUrl: string | null };
    expect(data.mode).toBe("mock");
    expect(data.baseUrl).toBeNull();
  });
});
