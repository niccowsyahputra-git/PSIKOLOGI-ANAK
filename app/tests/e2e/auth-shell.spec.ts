import { expect, test } from "@playwright/test";

/**
 * There is no public signup: an anonymous visitor can only reach `/login`
 * (FR-01, section 4). These checks are read-only and never touch participant
 * data, so they are safe to run against the local installation.
 */
test.describe("authentication shell", () => {
  test("redirects an anonymous visitor to the login page", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: "Masuk ke sistem lokal" }),
    ).toBeVisible();
  });

  test("shows that the installation is local and has no signup link", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByText("LOCAL ONLY")).toBeVisible();
    await expect(page.getByRole("button", { name: "Masuk" })).toBeVisible();
    await expect(
      page.getByText("Pendaftaran mandiri dinonaktifkan."),
    ).toBeVisible();
  });

  test("reports a validation message instead of crashing on an empty submit", async ({
    page,
  }) => {
    await page.goto("/login");

    await page.getByRole("button", { name: "Masuk" }).click();

    await expect(page.locator("#email")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Masuk ke sistem lokal" })).toBeVisible();
  });
});
