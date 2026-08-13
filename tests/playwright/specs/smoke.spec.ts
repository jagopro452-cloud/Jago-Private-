import { expect, test } from "@playwright/test";
import { installAdminUiMocks } from "../support/ui-mocks";

test.describe("Smoke", () => {
  test.beforeEach(async ({ page }) => {
    await installAdminUiMocks(page);
  });

  test("landing page renders critical CTAs", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("landing-page")).toBeVisible();
    await expect(page.getByTestId("hero-section")).toBeVisible();
    await expect(page.getByTestId("btn-book-ride-primary")).toBeVisible();
    await expect(page.getByTestId("download-section")).toBeVisible();
    await expect(page.getByTestId("download-cta-customer-app")).toBeVisible();
    await expect(page.getByTestId("download-cta-driver-app")).toBeVisible();
  });

  test("policy pages render without a 404 shell", async ({ page }) => {
    for (const route of ["/about-us", "/privacy", "/terms", "/refund-policy", "/contact-us"]) {
      await page.goto(route);
      await expect(page).not.toHaveTitle(/404/i);
    }
  });

  test("admin login renders stable selectors", async ({ page }) => {
    await page.goto("/admin/login");
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(page.getByTestId("input-email")).toBeVisible();
    await expect(page.getByTestId("input-password")).toBeVisible();
    await expect(page.getByTestId("btn-login")).toBeVisible();
  });
});
