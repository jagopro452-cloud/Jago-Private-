import { expect, test, type Page } from "@playwright/test";
import { adminModules } from "../support/admin-live";
import { installAdminUiMocks, seedAdminSession } from "../support/ui-mocks";

type Diagnostics = {
  consoleErrors: string[];
  pageErrors: string[];
  badResponses: string[];
};

function installDiagnostics(page: Page): Diagnostics {
  const diagnostics: Diagnostics = {
    consoleErrors: [],
    pageErrors: [],
    badResponses: [],
  };

  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text();
      if (text.includes("Failed to load resource: net::ERR_NETWORK_ACCESS_DENIED")) return;
      diagnostics.consoleErrors.push(text);
    }
  });

  page.on("pageerror", (error) => {
    diagnostics.pageErrors.push(error.message);
  });

  page.on("response", (response) => {
    const url = response.url();
    const isLocalApp = url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost");
    if (isLocalApp && response.status() >= 400) {
      diagnostics.badResponses.push(`${response.status()} ${response.request().method()} ${url}`);
    }
  });

  return diagnostics;
}

test.describe("Admin Layout Sweep", () => {
  test.beforeEach(async ({ page }) => {
    await installAdminUiMocks(page);
    await seedAdminSession(page);
  });

  for (const module of adminModules) {
    test(`admin page layout stays aligned: ${module.category} / ${module.label}`, async ({ page }) => {
      const diagnostics = installDiagnostics(page);

      await page.goto(module.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("domcontentloaded");
      await expect(page.locator(".admin-shell")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("sidebar-user-email")).toBeVisible({ timeout: 20_000 });

      const bodyText = await page.locator("body").innerText();
      expect(bodyText).not.toContain("Module Not Found");
      expect(bodyText).not.toContain("Cannot GET");
      expect(bodyText).not.toContain("500 Internal Server Error");
      expect(bodyText).not.toContain("Login to Admin");

      const tableIssues = await page.evaluate(() => {
        const issues: string[] = [];
        document.querySelectorAll(".admin-shell .table-responsive").forEach((wrapper, index) => {
          const headerCell = wrapper.querySelector("thead th");
          const bodyRow = wrapper.querySelector("tbody tr");
          if (!(wrapper instanceof HTMLElement) || !(headerCell instanceof HTMLElement)) return;

          const wrapperRect = wrapper.getBoundingClientRect();
          const headerRect = headerCell.getBoundingClientRect();
          if (wrapperRect.width === 0 || wrapperRect.height === 0 || headerRect.width === 0 || headerRect.height === 0) return;

          const headerTopDelta = Math.round(headerRect.top - wrapperRect.top);
          if (headerTopDelta > 24) {
            issues.push(`table ${index}: header top offset ${headerTopDelta}px`);
          }

          if (bodyRow instanceof HTMLElement) {
            const rowRect = bodyRow.getBoundingClientRect();
            const rowVisible = rowRect.width > 0 && rowRect.height > 0;
            const headerOverlapsRow = rowVisible && headerRect.bottom > rowRect.top + 4;
            if (headerOverlapsRow) {
              issues.push(`table ${index}: header overlaps first row`);
            }
          }
        });
        return issues;
      });

      expect.soft(tableIssues, `${module.path} table alignment`).toEqual([]);
      expect.soft(diagnostics.consoleErrors, `${module.path} console errors`).toEqual([]);
      expect.soft(diagnostics.pageErrors, `${module.path} page errors`).toEqual([]);
      expect.soft(diagnostics.badResponses, `${module.path} bad local responses`).toEqual([]);
    });
  }
});
