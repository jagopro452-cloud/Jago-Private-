import { expect, test, type Page } from "@playwright/test";
import {
  adminModules,
  assertAdminPageHealthy,
  createPageDiagnostics,
  loginLiveAdmin,
  seedLiveAdminSession,
  type AdminModule,
  type PageDiagnostic,
} from "../support/admin-live";

let adminSession: Awaited<ReturnType<typeof loginLiveAdmin>>;

async function openAdminModule(page: Page, module: AdminModule, diagnostics: PageDiagnostic) {
  await seedLiveAdminSession(page, adminSession);
  await assertAdminPageHealthy(page, module, diagnostics);
}

test.describe("Admin Live Page Validation", () => {
  test("@live @admin-live redirects unauthenticated admins to login", async ({ page }) => {
    await page.goto("/admin/login");
    await page.evaluate(() => {
      window.localStorage.removeItem("jago-admin");
    });
    await page.goto("/admin/dashboard");
    await page.waitForURL("**/admin/login");
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  for (const module of adminModules) {
    test(`@live @admin-live ${module.category} :: ${module.label}`, async ({ page }) => {
      adminSession ??= await loginLiveAdmin();
      const diagnostics = createPageDiagnostics(page);
      await openAdminModule(page, module, diagnostics);
    });
  }

  test("@live @admin-live keeps admin session valid across refresh", async ({ page }) => {
    adminSession ??= await loginLiveAdmin();
    const diagnostics = createPageDiagnostics(page);
    await seedLiveAdminSession(page, adminSession);
    await page.goto("/admin/dashboard");
    await expect(page.locator("h1.admin-page-title")).toContainText("Dashboard");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("h1.admin-page-title")).toContainText("Dashboard");
    expect.soft(diagnostics.consoleErrors).toEqual([]);
    expect.soft(diagnostics.pageErrors).toEqual([]);
  });
});
