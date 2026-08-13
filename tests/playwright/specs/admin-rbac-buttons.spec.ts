import { expect, test } from "@playwright/test";
import { installAdminUiMocks, seedAdminSession } from "../support/ui-mocks";

// Verifies the frontend never shows an action button for a role that the
// backend would 403 - the two layers are single-sourced from
// shared/permissions.ts, but this test guards against future drift by
// asserting actual rendered DOM per role, not just reading the matrix.
type ButtonCheck = {
  path: string;
  testId: string;
  // Roles that MUST see this button (or, for switch/disabled-style controls,
  // must see it enabled)
  allowedRoles: string[];
  // A representative sample of roles that must NOT see (or must see
  // disabled) this button - not exhaustive of all 11 roles, but covers the
  // specific escalation risks this RBAC initiative exists to prevent.
  deniedRoles: string[];
  mode?: "hidden" | "disabled";
};

const checks: ButtonCheck[] = [
  {
    path: "/admin/employees",
    testId: "btn-add-employee",
    allowedRoles: ["admin", "superadmin"],
    deniedRoles: ["operations_head", "zone_head", "zone_manager", "support_agent", "marketing_exec", "driver_onboarding_exec"],
    mode: "hidden",
  },
  {
    path: "/admin/withdrawals",
    testId: "btn-approve-wd-001",
    allowedRoles: ["admin", "superadmin", "operations_head", "zone_head"],
    deniedRoles: ["zone_manager", "support_agent", "marketing_exec", "driver_onboarding_exec"],
    mode: "hidden",
  },
  {
    path: "/admin/driver-verification",
    testId: "button-approve-driver-driver-qa-001",
    allowedRoles: ["admin", "superadmin", "operations_head", "zone_head", "driver_onboarding_exec"],
    deniedRoles: ["zone_manager", "support_agent", "marketing_exec"],
    mode: "disabled",
  },
  {
    // zone_head is intentionally excluded here: ROLE_SECTION_ACCESS (layout.tsx,
    // unchanged by this RBAC initiative) does not grant zone_head the
    // "Promotion Management" category at all, so it cannot reach this page
    // regardless of the withdrawals.write permission it holds - a category
    // -level restriction, not a permission-level one.
    path: "/admin/referrals",
    testId: "btn-pay-ref-001",
    allowedRoles: ["admin", "superadmin", "operations_head"],
    deniedRoles: ["zone_manager", "support_agent", "marketing_exec", "driver_onboarding_exec"],
    mode: "hidden",
  },
];

test.describe("Admin RBAC — button visibility matches backend permissions", () => {
  for (const check of checks) {
    for (const role of check.allowedRoles) {
      test(`${role} SEES enabled "${check.testId}" on ${check.path}`, async ({ page }) => {
        await installAdminUiMocks(page, role);
        await seedAdminSession(page, role);
        await page.goto(check.path, { waitUntil: "domcontentloaded" });
        await expect(page.locator(".admin-shell")).toBeVisible({ timeout: 20_000 });
        const button = page.getByTestId(check.testId);
        await expect(button).toBeVisible({ timeout: 10_000 });
        await expect(button).toBeEnabled();
      });
    }

    for (const role of check.deniedRoles) {
      test(`${role} CANNOT use "${check.testId}" on ${check.path}`, async ({ page }) => {
        await installAdminUiMocks(page, role);
        await seedAdminSession(page, role);
        await page.goto(check.path, { waitUntil: "domcontentloaded" });
        await expect(page.locator(".admin-shell")).toBeVisible({ timeout: 20_000 });
        const button = page.getByTestId(check.testId);
        if (check.mode === "disabled") {
          // Button may render disabled rather than being removed from the DOM.
          const count = await button.count();
          if (count > 0) {
            await expect(button).toBeDisabled();
          }
        } else {
          await expect(button).toHaveCount(0);
        }
      });
    }
  }
});
