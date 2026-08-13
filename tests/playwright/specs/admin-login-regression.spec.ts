import { expect, test } from "@playwright/test";
import { requireLiveSuiteState } from "../support/live-suite-state";

test.describe("Admin Login Regression", () => {
  test.describe.configure({ mode: "serial" });

  test("@live redirects unauthenticated admin dashboard access to login", async ({ page }) => {
    await page.goto("/admin/login");
    await page.evaluate(() => window.localStorage.removeItem("jago-admin"));
    await page.goto("/admin/dashboard");
    await page.waitForURL("**/admin/login");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("@live keeps admin dashboard accessible after seeded session redirect and refresh", async ({ page }) => {
    const state = await requireLiveSuiteState();
    const adminSession = state.admin.session;

    await page.addInitScript((session) => {
      localStorage.setItem("jago-admin", JSON.stringify({
        ...session.admin,
        admin: session.admin,
        token: session.token,
        expiresAt: session.expiresAt,
      }));
    }, adminSession);

    await page.goto("/admin/dashboard");
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.getByRole("searchbox", { name: "Search Here" })).toBeVisible();
    await expect(page.getByRole("link", { name: /JAGO ADMIN PANEL/i })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.getByRole("searchbox", { name: "Search Here" })).toBeVisible();
    await expect(page.getByRole("link", { name: /JAGO ADMIN PANEL/i })).toBeVisible();
  });
});
