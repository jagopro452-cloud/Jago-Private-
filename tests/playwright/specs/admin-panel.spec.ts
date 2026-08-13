import { expect, test } from "@playwright/test";
import { installAdminUiMocks, seedAdminSession } from "../support/ui-mocks";

test.describe("Admin Panel", () => {
  test.beforeEach(async ({ page }) => {
    await installAdminUiMocks(page);
    await seedAdminSession(page);
  });

  test("dashboard loads live cards and navigation search", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await expect(page.getByTestId("dashboard-banner")).toBeVisible();
    await expect(page.getByTestId("stat-card-total-customers")).toBeVisible();
    await page.getByTestId("sidebar-search").fill("settings");
    await expect(page.getByTestId("nav-system-settings")).toBeVisible();
  });

  test("otp settings save through stable controls", async ({ page }) => {
    await page.goto("/admin/settings");
    await page.getByTestId("settings-tab-otp").click();
    await page.getByTestId("otp-toggle-fallbackEnabled").click();
    await page.getByTestId("otp-expiry-seconds").fill("180");
    await page.getByTestId("btn-save-otp-settings").click();
    await expect(page.getByTestId("btn-save-otp-settings")).toBeVisible();
  });
});
