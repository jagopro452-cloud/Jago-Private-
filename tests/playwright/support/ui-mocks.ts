import type { Page, Route } from "@playwright/test";
import { createAdminSession, runtime } from "./runtime";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

const dashboardStats = {
  totalCustomers: 12480,
  totalDrivers: 2860,
  totalRevenue: 4825000,
  totalTrips: 93840,
  completedTrips: 88210,
  ongoingTrips: 118,
  cancelledTrips: 5512,
  pendingWithdrawals: 14,
  totalReviews: 4210,
  totalZones: 12,
  recentTrips: [
    {
      trip: {
        id: "trip-001",
        refId: "TRPQA001",
        currentStatus: "completed",
        type: "ride",
        actualFare: 189,
        paymentStatus: "paid",
        createdAt: new Date().toISOString(),
      },
      customer: { fullName: "Anita Sharma" },
      vehicleCategory: { name: "Cab" },
    },
  ],
};

const adminDashboard = {
  services: {
    rides: { trips: 5100, revenue: 820000, model: "subscription" },
    parcels: { trips: 850, revenue: 132000, model: "commission" },
    carpool: { trips: 260, revenue: 51000, model: "commission" },
    outstationPool: { bookings: 72, revenue: 68000, mode: "on" },
  },
  drivers: { online: 1830, totalPendingCommission: 42000 },
};

const chart = [
  { day: "Mon", revenue: 120000, trips: 740 },
  { day: "Tue", revenue: 132000, trips: 775 },
  { day: "Wed", revenue: 128500, trips: 760 },
  { day: "Thu", revenue: 136200, trips: 805 },
  { day: "Fri", revenue: 145300, trips: 842 },
  { day: "Sat", revenue: 168900, trips: 930 },
  { day: "Sun", revenue: 159200, trips: 910 },
];

const notifications = [
  {
    id: "notif-1",
    type: "trip",
    title: "Trip assigned",
    message: "Driver Ravi Kumar accepted TRPQA001",
    isRead: false,
    createdAt: new Date().toISOString(),
  },
];

const liveKpis = {
  live: {
    searching: 18,
    dispatching: 6,
    inProgress: 118,
    completedLastHour: 94,
    cancelledLastHour: 7,
    avgPickupWaitMin: 4,
  },
  quality: {
    ghostDriverCount: 3,
  },
  surge: {
    activeSurgeZones: [{ name: "Hitech City", factor: 1.5 }],
  },
  cancellations: {
    driverCancelsToday: 8,
    customerCancelsToday: 12,
    totalToday: 20,
    penaltyCollectedToday: 450,
  },
};

const settings = [
  { keyName: "business_name", value: "JAGO Pro", settingsType: "business" },
  { keyName: "business_email", value: "ops@jago.test", settingsType: "business" },
  { keyName: "business_phone", value: "+91-9999999999", settingsType: "business" },
  { keyName: "business_address", value: "Hyderabad", settingsType: "business" },
];

const mockEmployees = [
  { id: "emp-001", name: "Priya Rao", email: "priya@jago.test", phone: "+919000000001", role: "support_agent", zoneId: null, zoneName: null, isActive: true },
];

const mockWithdrawals = [
  {
    withdrawal: { id: "wd-001", amount: 2500, method: "bank_transfer", accountDetails: "HDFC ****1234", status: "pending" },
    driver: { fullName: "Ravi Kumar" },
  },
];

const mockPendingDrivers = [
  {
    id: "driver-qa-001",
    fullName: "Test Driver",
    phone: "+919000000002",
    city: "Hyderabad",
    verification_status: "pending",
    created_at: new Date().toISOString(),
    documents: [
      { id: "doc-001", doc_type: "license", status: "pending", file_url: "/uploads/mock-license.jpg" },
    ],
  },
];

const mockReferrals = [
  {
    id: "ref-001",
    status: "pending",
    referrerName: "Anita Sharma",
    referrerPhone: "+919000000003",
    referrerType: "customer",
    referredName: "New User",
    referredPhone: "+919000000004",
    referralCode: "JAGO123",
    referralType: "customer",
    rewardAmount: 100,
  },
];

const otpSettings = {
  primaryProvider: "sms",
  smsEnabled: true,
  firebaseEnabled: true,
  fallbackEnabled: true,
  otpExpirySeconds: 120,
  maxAttempts: 3,
};

export async function seedAdminSession(page: Page, role?: string) {
  const session = createAdminSession();
  const withRole = role ? { ...session, role, admin: { ...session.admin, role } } : session;
  await page.addInitScript((value) => {
    localStorage.setItem("jago-admin", JSON.stringify(value));
  }, withRole);
  return withRole;
}

export async function installAdminUiMocks(page: Page, role?: string) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;

    if (pathname === "/api/health") return json(route, { status: "ok", ready: true });
    if (pathname === "/api/admin/login") {
      const payload = route.request().postDataJSON() as { email?: string; password?: string };
      if (payload.email === runtime.adminEmail && payload.password === runtime.adminPassword) {
        return json(route, createAdminSession());
      }
      return json(route, { message: "Invalid credentials. Please try again." }, 401);
    }
    if (pathname === "/api/admin/forgot-password") {
      return json(route, { message: "Reset OTP sent successfully.", otp: "654321" });
    }
    if (pathname === "/api/admin/reset-password") {
      return json(route, { message: "Password reset completed." });
    }
    if (pathname === "/api/admin/login/verify-2fa") {
      return json(route, createAdminSession());
    }
    if (pathname === "/api/dashboard/stats") return json(route, dashboardStats);
    if (pathname === "/api/admin/dashboard") return json(route, adminDashboard);
    if (pathname === "/api/dashboard/chart") return json(route, chart);
    if (pathname === "/api/notifications") return json(route, notifications);
    if (pathname === "/api/admin/live-kpis") return json(route, liveKpis);
    if (pathname === "/api/settings") {
      if (route.request().method() === "POST") return json(route, { success: true });
      return json(route, settings);
    }
    if (pathname === "/api/otp-settings") {
      if (route.request().method() === "PUT") return json(route, { success: true });
      return json(route, otpSettings);
    }
    if (pathname === "/api/employees") return json(route, mockEmployees);
    if (pathname === "/api/withdrawals") return json(route, mockWithdrawals);
    if (pathname === "/api/admin/drivers/pending-verification") return json(route, { drivers: mockPendingDrivers });
    if (pathname === "/api/referrals") return json(route, mockReferrals);
    if (pathname === "/api/referrals/stats") return json(route, {});
    if (pathname === "/api/zones") return json(route, []);
    if (pathname === "/api/admin/change-password") return json(route, { success: true });
    if (pathname === "/api/admin/logout") return json(route, { success: true });
    if (pathname === "/api/admin/me") {
      const session = createAdminSession();
      return json(route, {
        admin: { id: session.id, name: session.name, email: session.email, role: role || session.role, isActive: true },
        session: { expiresAt: session.expiresAt },
      });
    }

    return json(route, {});
  });
}
