import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { LiveClient, type AdminSession } from "./live-client";
import { requireLiveSuiteState } from "./live-suite-state";
import { runtime } from "./runtime";

export type AdminModule = {
  label: string;
  path: string;
  category: string;
};

export const adminModules: AdminModule[] = [
  { category: "Dashboard", label: "Dashboard", path: "/admin/dashboard" },
  { category: "Dashboard", label: "System Health", path: "/admin/system-health" },
  { category: "Dashboard", label: "Alert Engine", path: "/admin/alert-engine" },
  { category: "Dashboard", label: "Service Management", path: "/admin/service-management" },
  { category: "Dashboard", label: "Heat Map", path: "/admin/heat-map" },
  { category: "Dashboard", label: "Fleet View", path: "/admin/fleet-view" },
  { category: "Zone Management", label: "Zone Setup", path: "/admin/zones" },
  { category: "Zone Management", label: "Popular Locations", path: "/admin/popular-locations" },
  { category: "Trip Management", label: "All Trips", path: "/admin/trips" },
  { category: "Trip Management", label: "Intercity Carpool", path: "/admin/intercity-pool" },
  { category: "Trip Management", label: "Local Pool", path: "/admin/local-pool" },
  { category: "Trip Management", label: "Outstation Pool", path: "/admin/outstation-pool" },
  { category: "Trip Management", label: "Intercity Routes", path: "/admin/intercity-routes" },
  { category: "Trip Management", label: "Parcel Refunds", path: "/admin/parcel-refunds" },
  { category: "Trip Management", label: "Safety & Emergency", path: "/admin/safety-alerts" },
  { category: "Promotion Management", label: "Banner Setup", path: "/admin/banners" },
  { category: "Promotion Management", label: "Coupon Setup", path: "/admin/coupons" },
  { category: "Promotion Management", label: "Discount Setup", path: "/admin/discounts" },
  { category: "Promotion Management", label: "Referral Management", path: "/admin/referrals" },
  { category: "Promotion Management", label: "Spin Wheel", path: "/admin/spin-wheel" },
  { category: "Promotion Management", label: "Send Notification", path: "/admin/notifications" },
  { category: "User Management", label: "Driver Verification", path: "/admin/driver-verification" },
  { category: "User Management", label: "Driver Level Setup", path: "/admin/driver-levels" },
  { category: "User Management", label: "Driver Setup", path: "/admin/drivers" },
  { category: "User Management", label: "Insurance Plans", path: "/admin/insurance" },
  { category: "User Management", label: "Withdraw Requests", path: "/admin/withdrawals" },
  { category: "User Management", label: "Customer Level Setup", path: "/admin/customer-levels" },
  { category: "User Management", label: "Customer Setup", path: "/admin/customers" },
  { category: "User Management", label: "Customer Wallet", path: "/admin/customer-wallet" },
  { category: "User Management", label: "Wallet Bonus", path: "/admin/wallet-bonus" },
  { category: "User Management", label: "Employee Setup", path: "/admin/employees" },
  { category: "User Management", label: "Subscription Plans", path: "/admin/subscriptions" },
  { category: "Parcel Management", label: "Parcel Orders", path: "/admin/parcel-orders" },
  { category: "Parcel Management", label: "Parcel Attributes", path: "/admin/parcel-attributes" },
  { category: "B2B / Porter", label: "B2B Companies", path: "/admin/b2b-companies" },
  { category: "Vehicle Management", label: "Vehicle Attribute Setup", path: "/admin/vehicle-attributes" },
  { category: "Vehicle Management", label: "Vehicle Categories", path: "/admin/vehicles" },
  { category: "Vehicle Management", label: "Vehicle Requests", path: "/admin/vehicle-requests" },
  { category: "Fare Management", label: "Fare Overview", path: "/admin/fare-management" },
  { category: "Fare Management", label: "Trip Fare Setup", path: "/admin/fares" },
  { category: "Fare Management", label: "Parcel Delivery Fare", path: "/admin/parcel-fares" },
  { category: "Fare Management", label: "Local Pool Pricing", path: "/admin/local-pool?openSettings=1" },
  { category: "Fare Management", label: "Outstation Pool Pricing", path: "/admin/outstation-pool?tab=settings" },
  { category: "Fare Management", label: "Car Sharing Pricing", path: "/admin/car-sharing?tab=settings" },
  { category: "Fare Management", label: "Surge Pricing", path: "/admin/surge-pricing" },
  { category: "Fare Management", label: "Commission Rules", path: "/admin/revenue-model" },
  { category: "Fare Management", label: "Cancel Reasons", path: "/admin/cancellation-reasons" },
  { category: "Fare Management", label: "Fare Simulator", path: "/admin/fare-simulator" },
  { category: "Fare Management", label: "Pricing Audit Logs", path: "/admin/pricing-audit-logs" },
  { category: "Transactions & Reports", label: "Transactions", path: "/admin/transactions" },
  { category: "Transactions & Reports", label: "Reports", path: "/admin/reports" },
  { category: "Transactions & Reports", label: "Driver Earnings", path: "/admin/driver-earnings" },
  { category: "Transactions & Reports", label: "Driver Wallet", path: "/admin/driver-wallet" },
  { category: "Help & Support", label: "Chatting", path: "/admin/chatting" },
  { category: "Help & Support", label: "Call Logs", path: "/admin/call-logs" },
  { category: "Help & Support", label: "Ride Refund Requests", path: "/admin/refund-requests" },
  { category: "Developer", label: "API Reference", path: "/admin/api-docs" },
  { category: "Developer", label: "App UI Design", path: "/admin/app-design" },
  { category: "Reviews", label: "Reviews", path: "/admin/reviews" },
  { category: "Business Management", label: "Business Setup", path: "/admin/business-setup" },
  { category: "Business Management", label: "Pages & Media", path: "/admin/pages-media" },
  { category: "Business Management", label: "App Languages", path: "/admin/languages" },
  { category: "Business Management", label: "Configurations", path: "/admin/configurations" },
  { category: "Business Management", label: "System Settings", path: "/admin/settings" },
  { category: "Hidden Admin", label: "Blogs", path: "/admin/blogs" },
  { category: "Hidden Admin", label: "Newsletter", path: "/admin/newsletter" },
  { category: "Hidden Admin", label: "Voice Commands", path: "/admin/voice-commands" },
  { category: "Hidden Admin", label: "City Services", path: "/admin/city-services" },
  { category: "Hidden Admin", label: "Parcel Vehicle Types", path: "/admin/parcel-vehicle-types" },
  { category: "Hidden Admin", label: "AI Brain", path: "/admin/ai-brain" },
];

export type PageDiagnostic = {
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
  badResponses: string[];
};

function createBrowserAdminSession(session: AdminSession) {
  return {
    ...session.admin,
    admin: session.admin,
    token: session.token,
    expiresAt: session.expiresAt,
  };
}

export function createPageDiagnostics(page: Page): PageDiagnostic {
  const diagnostics: PageDiagnostic = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    badResponses: [],
  };

  page.on("console", (message) => {
    if (message.type() === "error") {
      diagnostics.consoleErrors.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    diagnostics.pageErrors.push(error.message);
  });

  page.on("requestfailed", (request) => {
    const failure = request.failure();
    diagnostics.requestFailures.push(`${request.method()} ${request.url()} :: ${failure?.errorText || "unknown failure"}`);
  });

  page.on("response", async (response) => {
    const status = response.status();
    if (status < 400) return;
    const url = response.url();
    if (!url.startsWith(runtime.baseURL) && !url.startsWith(runtime.apiBaseURL)) return;
    diagnostics.badResponses.push(`${status} ${response.request().method()} ${url}`);
  });

  return diagnostics;
}

export async function loginLiveAdmin() {
  const client = await LiveClient.create();
  try {
    const sharedState = await requireLiveSuiteState();
    if (sharedState.admin.session?.token) {
      const probe = await client.get("/api/dashboard/stats", {
        Authorization: `Bearer ${sharedState.admin.session.token}`,
      });
      if (probe.ok()) {
        return sharedState.admin.session;
      }
    }
  } catch {
    // Fall back to a fresh live login when the shared suite state is unavailable or stale.
  }

  try {
    return await client.loginAdmin();
  } finally {
    await client.dispose();
  }
}

export async function seedLiveAdminSession(page: Page, session: AdminSession) {
  const browserSession = createBrowserAdminSession(session);
  await page.addInitScript((value) => {
    window.localStorage.setItem("jago-admin", JSON.stringify(value));
  }, browserSession);
}

export async function assertAdminPageHealthy(page: Page, module: AdminModule, diagnostics: PageDiagnostic) {
  await page.goto(module.path, { waitUntil: "domcontentloaded" });
  await page.waitForURL(`**${module.path}`);
  await page.waitForLoadState("domcontentloaded");

  const currentUrl = page.url();
  expect(currentUrl, `${module.label} unexpectedly redirected to login`).not.toContain("/admin/login");

  await expect(page.locator(".admin-surface")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("h1.admin-page-title")).toContainText(module.label, { timeout: 20_000 });
  await expect(page.getByTestId("sidebar-user-email")).toBeVisible();

  await page.waitForFunction(() => {
    const bodyText = document.body.innerText || "";
    return !bodyText.includes("Loading JAGO Admin");
  });

  await page.waitForTimeout(1500);

  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toContain("Cannot GET");
  expect(bodyText).not.toMatch(/\b404\b/);
  expect(bodyText).not.toContain("500 Internal Server Error");
  expect(bodyText, `${module.label} loaded login UI instead of admin shell`).not.toContain("Login to Admin");

  expect.soft(diagnostics.consoleErrors, `${module.label} console errors`).toEqual([]);
  expect.soft(diagnostics.pageErrors, `${module.label} page errors`).toEqual([]);
  expect.soft(diagnostics.requestFailures, `${module.label} request failures`).toEqual([]);
  expect.soft(diagnostics.badResponses, `${module.label} bad responses`).toEqual([]);
}

export async function createAdminApiContext() {
  const client = await LiveClient.create();
  const session = await client.loginAdmin();
  return {
    client,
    session,
    headers: {
      Authorization: `Bearer ${session.token}`,
      "content-type": "application/json",
    },
  };
}

export async function listJson<T>(api: APIRequestContext, url: string, headers: Record<string, string>) {
  const response = await api.get(url, { headers });
  expect(response.ok(), `${url} should load successfully`).toBeTruthy();
  return response.json() as Promise<T>;
}
