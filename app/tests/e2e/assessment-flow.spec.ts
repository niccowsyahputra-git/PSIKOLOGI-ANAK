import { expect, test, type Page } from "@playwright/test";
import { INSTRUMENTS, type Module } from "../../src/lib/instruments";

/** Fictional test account, seeded only in the isolated e2e installation. */
async function login(page: Page, identity = "a") {
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

async function openHandoff(page: Page, participant: string) {
  await page.getByRole("button", { name: `Mulai sesi ${participant}`, exact: true }).click();
  await page.getByRole("button", { name: "Serahkan perangkat & mulai", exact: true }).click();
  await expect(page).toHaveURL(/\/intake$/);
  await expect(page.getByText("SESI DEMONSTRASI — DATA FIKTIF")).toBeVisible();
  const denied = await page.request.get("/api/children");
  expect(denied.status()).toBe(403);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/intake$/);
  await page.getByRole("button", { name: "Mulai", exact: true }).click();
}

async function finish(page: Page) {
  await page.getByRole("button", { name: "Kirim jawaban", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Jawaban sudah terkirim ✓" })).toBeVisible();
  await page.getByRole("button", { name: "Selesai & kembalikan perangkat" }).click();
  await page.getByRole("link", { name: "Masuk staf" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function answerModule(page: Page, module: Module) {
  for (let i = 0; i < INSTRUMENTS[module].length; i++) {
    const item = INSTRUMENTS[module][i];
    await expect(page.getByRole("heading", { name: item.text, exact: true })).toBeVisible();
    if (item.sensitive) {
      await expect(page.getByText(/Pertanyaan berikut mungkin terasa berat/)).toBeVisible();
      await page.getByRole("button", { name: module === "W" ? "Tidak ingin menjawab" : "Aku belum ingin menjawab", exact: true }).click();
    } else if (item.kind === "likert") {
      await page.getByRole("radio", { name: "Setuju", exact: true }).click();
    } else {
      await page.getByRole("textbox", { name: "Jawaban", exact: true }).fill(`Jawaban fiktif ${item.id}`);
    }
    await page.getByRole("button", { name: i === INSTRUMENTS[module].length - 1 ? "Periksa jawaban →" : "Lanjut →", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Periksa sebelum mengirim" })).toBeVisible();
}

test("module A drawing, autosave, child/guardian handoff and staff comparison", async ({ page }) => {
  await login(page);
  await page.goto("/children/new");
  await page.getByLabel("Nama anak", { exact: true }).fill("Anak E2E Fiktif");
  await page.getByLabel("Hanya usia perkiraan").check();
  await page.getByLabel("Usia perkiraan (tahun)").fill("7");
  await page.getByRole("button", { name: "Simpan profil anak" }).click();
  await expect(page).toHaveURL(/\/children\/[^/]+$/);
  await page.getByRole("button", { name: "Verifikasi profil", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mulai siklus", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "+ Tambah orang tua / wali" }).click();
  await page.getByLabel("Nama orang tua / wali").fill("Wali E2E Fiktif");
  await page.getByLabel("Hubungan dengan anak").selectOption("Nenek");
  await page.getByRole("button", { name: "Simpan & hubungkan" }).click();
  await page.getByRole("button", { name: "Verifikasi wali", exact: true }).click();
  await expect(page.getByRole("button", { name: "Verifikasi wali" })).toHaveCount(0);
  await page.getByRole("button", { name: "Mulai siklus", exact: true }).click();
  await page.getByRole("link", { name: "Buka siklus aktif →" }).click();
  await expect(page).toHaveURL(/\/cycles\/[^/]+$/);
  const cyclePath = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "Siapkan kuesioner", exact: true }).first().click();
  await openHandoff(page, "Anak E2E Fiktif");
  await page.getByRole("radio", { name: "Senang", exact: true }).click();
  await page.getByLabel("Diisi pendamping:").selectOption("read_aloud");
  await page.getByRole("button", { name: "Lanjut →", exact: true }).click();
  await page.getByRole("button", { name: "Gambar di layar", exact: false }).click();
  const canvas = page.getByLabel("Kanvas menggambar");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 40, box!.y + 40);
  await page.mouse.down();
  await page.mouse.move(box!.x + 120, box!.y + 100, { steps: 8 });
  await page.mouse.up();
  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByRole("button", { name: "Simpan gambar", exact: true }).click();
  await expect(page.getByRole("img", { name: "Gambar yang sudah disimpan" })).toBeVisible();
  await page.getByRole("button", { name: "Lanjut →", exact: true }).click();
  await page.getByRole("textbox", { name: "Jawaban", exact: true }).fill("Aku ingin taman bermain yang aman.");
  await expect(page.getByRole("status")).toHaveText("Tersimpan ✓");
  await page.getByRole("button", { name: "⏸ Istirahat" }).click();
  await page.getByRole("button", { name: "Lanjutkan", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Mulai", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Senang", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Diisi pendamping:")).toHaveValue("read_aloud");
  await page.getByRole("button", { name: "Lanjut →", exact: true }).click();
  await expect(page.getByRole("img", { name: "Gambar yang sudah disimpan" })).toBeVisible();
  await page.getByRole("button", { name: "Lanjut →", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Jawaban", exact: true })).toHaveValue("Aku ingin taman bermain yang aman.");
  await page.getByRole("button", { name: "Periksa jawaban →", exact: true }).click();
  await finish(page);
  await login(page);
  await page.goto(cyclePath);
  await expect(page.getByText("Wali belum mengirim jawaban.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Siapkan kuesioner", exact: true }).click();
  await openHandoff(page, "Wali E2E Fiktif");
  await expect(page.getByText("Aku ingin taman bermain yang aman.")).toHaveCount(0);
  await answerModule(page, "W");
  await finish(page);
  await login(page);
  await page.goto(cyclePath);
  await expect(page.getByText("Aku ingin taman bermain yang aman.", { exact: true })).toBeVisible();
  await expect(page.getByText("Jawaban fiktif W05", { exact: true })).toBeVisible();
  await expect(page.getByText("Dibacakan", { exact: false }).first()).toBeVisible();
});

for (const [module, age] of [["B", 10], ["C", 15]] as const) {
  test(`module ${module} text/likert, sensitive skips and saved results`, async ({ page }) => {
    await login(page, module.toLowerCase());
    const child = await post<{ id: string; revision: number }>(page, "/api/children", { name: `Anak E2E Modul ${module}`, fictional: true, estimatedAge: age, ageReferenceDate: new Date().toISOString().slice(0, 10) });
    await post(page, `/api/children/${child.id}/verify`, { revision: child.revision });
    const cycle = await post<{ id: string }>(page, `/api/children/${child.id}/cycles`, {});
    const draft = await post<{ id: string }>(page, `/api/cycles/${cycle.id}/assessments`, { target: "child" });
    await page.goto(`/cycles/${cycle.id}`);
    await openHandoff(page, `Anak E2E Modul ${module}`);
    await answerModule(page, module);
    await finish(page);
    await login(page, module.toLowerCase());
    await page.goto(`/assessments/${draft.id}`);
    await expect(page.getByText(`Jawaban fiktif ${module === "B" ? "B01" : "C11"}`, { exact: true })).toBeVisible();
    await expect(page.getByText("Dilewati", { exact: true }).first()).toBeVisible();
  });
}
