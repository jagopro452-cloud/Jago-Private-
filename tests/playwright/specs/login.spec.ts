import { expect, test } from "@playwright/test";
import { AdminLoginPage } from "../support/page-objects/admin-login-page";
import { runtime } from "../support/runtime";
import { installAdminUiMocks } from "../support/ui-mocks";

test.describe("Login", () => {
  test.beforeEach(async ({ page }) => {
    await installAdminUiMocks(page);
  });

  test("shows clear feedback for invalid credentials", async ({ page }) => {
    const login = new AdminLoginPage(page);
    await login.goto();
    await login.login("wrong@jago.test", "bad-password");
    await expect(page.getByTestId("login-error")).toContainText("Invalid credentials");
  });

  test("completes forgot password flow", async ({ page }) => {
    const login = new AdminLoginPage(page);
    await login.goto();
    await login.requestPasswordReset(runtime.adminEmail);
    await expect(page.getByTestId("forgot-success")).toContainText("Reset OTP sent");
    await page.getByTestId("input-otp").fill("654321");
    await page.getByTestId("input-new-password").fill(runtime.adminPassword || "pw-reset-value");
    await page.getByTestId("btn-reset-password").click();
    await expect(page.getByTestId("forgot-success")).toContainText("Password reset completed");
  });

  test("signs in and lands on the dashboard", async ({ page }) => {
    const login = new AdminLoginPage(page);
    await login.goto();
    await login.login(runtime.adminEmail, runtime.adminPassword);
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    await expect(page.getByTestId("dashboard-banner")).toBeVisible();
  });
});
