import { expect, test } from "@playwright/test";
import { LiveClient } from "../support/live-client";
import { createAdminSession, getLiveCredentialBlockers, runtime } from "../support/runtime";
import { requireLiveSuiteState } from "../support/live-suite-state";

test.describe("Live Production Smoke", () => {
  test.describe.configure({ mode: "serial", retries: 0 });

  test("@live @live-smoke validates production health, QA account seeding, admin auth, and admin dashboard access", async ({ page }) => {
    const client = await LiveClient.create();
    const blockers: string[] = [...getLiveCredentialBlockers()];

    try {
      const sharedState = await requireLiveSuiteState();
      const healthResponse = await client.get("/api/health");
      expect(healthResponse.ok()).toBeTruthy();
      const health = await healthResponse.json();
      expect(health?.status).toBe("ok");

      const envResponse = await client.get("/api/health/env");
      expect(envResponse.ok()).toBeTruthy();
      const env = await envResponse.json();
      expect(env?.env?.DATABASE_URL).toBeTruthy();
      expect(env?.env?.GOOGLE_MAPS_API_KEY_resolved).toBeTruthy();
      expect(env?.env?.RAZORPAY_KEY_ID).toBeTruthy();
      expect(env?.env?.RAZORPAY_KEY_SECRET).toBeTruthy();

      const readyResponse = await client.get("/api/ops/ready", {
        "x-ops-key": runtime.opsApiKey || runtime.adminResetKey,
      });
      if (!readyResponse.ok()) {
        blockers.push(`/api/ops/ready rejected the provided ops key with status ${readyResponse.status()}`);
      }

      let admin: any = sharedState.admin.session;
      if (!sharedState.actors.customerPrimary.session?.token) {
        blockers.push("QA customer session missing from shared live state.");
      }
      if (!sharedState.actors.driverBikePrimary.session?.token) {
        blockers.push("QA driver session missing from shared live state.");
      }
      if (!admin?.token) {
        blockers.push("Admin session missing from shared live state.");
      }

      if (admin?.token) {
        admin = await client.loginAdmin();
        const dashboardStats = await client.adminGet("/api/dashboard/stats");
        if (!dashboardStats.ok()) {
          blockers.push(`/api/dashboard/stats rejected the shared admin token with status ${dashboardStats.status()}`);
        }

        await page.addInitScript((session) => {
          localStorage.setItem("jago-admin", JSON.stringify(session));
        }, createAdminSessionFromApi(admin));

        await page.goto(`${runtime.baseURL}/admin/dashboard`);
        await expect(page.getByTestId("dashboard-banner")).toBeVisible();
        await expect(page.getByTestId("sidebar-search")).toBeVisible();
      }

      expect(blockers, blockers.join("\n")).toEqual([]);
    } finally {
      await client.dispose();
    }
  });
});

function createAdminSessionFromApi(admin: {
  token: string;
  expiresAt: string;
  admin: { id: string; name: string; email: string; role: string };
}) {
  const seeded = createAdminSession();
  return {
    ...seeded,
    ...admin.admin,
    admin: admin.admin,
    token: admin.token,
    expiresAt: admin.expiresAt,
  };
}
