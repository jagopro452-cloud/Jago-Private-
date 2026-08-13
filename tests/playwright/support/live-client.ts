import { expect, request, type APIRequestContext } from "@playwright/test";
import { runtime } from "./runtime";
import type { SharedLiveSuiteState } from "./live-suite-state";
import { readLiveSuiteState, updateLiveActorSession } from "./live-suite-state";

export type AdminSession = {
  token: string;
  admin: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  expiresAt: string;
};

export type MobileSession = {
  token: string;
  refreshToken?: string;
  expiresAt?: string;
  user: {
    id: string;
    fullName: string;
    phone: string;
    userType: string;
    walletBalance?: number;
  };
};

type AccessTokenPayload = {
  sub?: string;
  userType?: string;
  deviceId?: string;
  typ?: string;
  iat?: number;
  exp?: number;
  jti?: string;
};

type SeedBootstrapPayload = {
  bootstrapMode?: "seed" | "fallback";
  adminSession?: AdminSession;
  sessions?: {
    customers?: Array<{ phone: string; session: MobileSession | null }>;
    drivers?: Array<{ phone: string; session: MobileSession | null }>;
  };
};

export type VehicleCategory = {
  id: string;
  name: string;
  type?: string;
  vehicleType?: string;
  serviceType?: string;
  isCarpool?: boolean;
};

export type DriverEligibleServicesResponse = {
  services: Array<{ key: string; name?: string; category?: string }>;
  parcelVehicles: Array<{ key: string; name?: string }>;
  dispatchProfile?: {
    vehicleCategoryKey?: string | null;
    serviceEligibility?: string[];
    parcelEligibility?: boolean;
    poolEligibility?: boolean;
    outstationEligibility?: boolean;
    seatCapacity?: number;
  };
  modules?: Array<{
    key: string;
    enabled: boolean;
    availableByCategory?: boolean;
    blockedReasons?: string[];
  }>;
};

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function readResponseBody(response: { json: () => Promise<unknown>; text: () => Promise<string> }) {
  try {
    return await response.json();
  } catch {
    try {
      return await response.text();
    } catch {
      return null;
    }
  }
}

export class LiveClient {
  constructor(private readonly api: APIRequestContext) {}
  private cachedAdminSession: AdminSession | null = null;
  private readonly mobileSessionCache = new Map<string, MobileSession>();

  static async create() {
    const api = await request.newContext({
      baseURL: runtime.apiBaseURL,
      extraHTTPHeaders: {
        "content-type": "application/json",
        "x-jago-playwright-suite": "true",
      },
      ignoreHTTPSErrors: true,
    });
    return new LiveClient(api);
  }

  async dispose() {
    await this.api.dispose();
  }

  async get(path: string, headers?: Record<string, string>) {
    return this.api.get(path, { headers });
  }

  async post(path: string, data?: unknown, headers?: Record<string, string>) {
    return this.api.post(path, { data, headers });
  }

  async patch(path: string, data?: unknown, headers?: Record<string, string>) {
    return this.api.patch(path, { data, headers });
  }

  async seedTestAccounts() {
    const seedKey = runtime.adminResetKey || runtime.opsApiKey;
    if (seedKey) {
      const response = await this.requestWithBackoff(
        () => this.api.get("/api/ops/seed-test-accounts", {
          params: {
            key: seedKey,
          },
          headers: {
            "x-ops-key": seedKey,
          },
        }),
        { retries: 2, backoffMs: 2_000, retryStatuses: [429] },
      );

      if (response.ok()) {
        const payload = await response.json() as SeedBootstrapPayload;
        if (payload.adminSession?.token) {
          this.cachedAdminSession = payload.adminSession;
        }
        for (const entry of payload.sessions?.customers || []) {
          if (entry?.session?.token && entry?.phone) {
            this.mobileSessionCache.set(this.getMobileCacheKey(entry.phone, "customer"), entry.session);
          }
        }
        for (const entry of payload.sessions?.drivers || []) {
          if (entry?.session?.token && entry?.phone) {
            this.mobileSessionCache.set(this.getMobileCacheKey(entry.phone, "driver"), entry.session);
          }
        }
        return {
          ...payload,
          bootstrapMode: "seed" as const,
        };
      }

      if (response.status() !== 403) {
        expect(response.ok()).toBeTruthy();
      }
    }

    return this.bootstrapQaAccounts();
  }

  async initializeSharedState(): Promise<SharedLiveSuiteState> {
    const bootstrap = await this.seedTestAccounts();
    const [admin, bike, auto, cab, pool] = await Promise.all([
      bootstrap.adminSession?.token ? Promise.resolve(bootstrap.adminSession) : this.loginAdmin(),
      this.getCategoryByLabel("bike"),
      this.getCategoryByLabel("auto"),
      this.getCategoryByLabel("cab"),
      this.tryGetCategoryByLabel("pool"),
    ]);

    const [
      customerPrimary,
      customerSecondary,
      driverBikePrimary,
      driverBikeSecondary,
      driverBikeTertiary,
      driverBikeQuaternary,
      driverAutoPrimary,
      driverCabPrimary,
    ] = await Promise.all([
      this.loginMobile(runtime.liveCustomerPhone, "customer"),
      this.loginMobile(runtime.liveCustomerPhone2, "customer"),
      this.loginMobile(runtime.liveDriverBikePhone, "driver"),
      this.loginMobile("9100000002", "driver"),
      this.loginMobile("9100000003", "driver"),
      this.loginMobile("9100000004", "driver"),
      this.loginMobile(runtime.liveDriverAutoPhone, "driver"),
      this.loginMobile(runtime.liveDriverCabPhone, "driver"),
    ]);

    return {
      version: 1,
      envName: runtime.envName,
      qaRunId: runtime.qaRunId,
      createdAt: new Date().toISOString(),
      bootstrapMode: bootstrap.bootstrapMode ?? "fallback",
      admin: {
        session: admin,
      },
      categories: {
        bike,
        auto,
        cab,
        pool,
      },
      actors: {
        customerPrimary: { label: "customer-primary", phone: runtime.liveCustomerPhone, session: customerPrimary },
        customerSecondary: { label: "customer-secondary", phone: runtime.liveCustomerPhone2, session: customerSecondary },
        driverBikePrimary: { label: "driver-bike-primary", phone: runtime.liveDriverBikePhone, session: driverBikePrimary },
        driverBikeSecondary: { label: "driver-bike-secondary", phone: "9100000002", session: driverBikeSecondary },
        driverBikeTertiary: { label: "driver-bike-tertiary", phone: "9100000003", session: driverBikeTertiary },
        driverBikeQuaternary: { label: "driver-bike-quaternary", phone: "9100000004", session: driverBikeQuaternary },
        driverAutoPrimary: { label: "driver-auto-primary", phone: runtime.liveDriverAutoPhone, session: driverAutoPrimary },
        driverCabPrimary: { label: "driver-cab-primary", phone: runtime.liveDriverCabPhone, session: driverCabPrimary },
      },
      artifacts: {
        tripIds: [],
        parcelOrderIds: [],
        outstationRideIds: [],
        notes: [],
      },
    };
  }

  async getOpsReady() {
    expect(runtime.opsApiKey || runtime.adminResetKey).toBeTruthy();
    const response = await this.api.get("/api/ops/ready", {
      headers: {
        "x-ops-key": runtime.opsApiKey || runtime.adminResetKey,
      },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async loginAdmin(forceRefresh = false): Promise<AdminSession> {
    if (!forceRefresh && this.cachedAdminSession?.token) {
      return this.cachedAdminSession;
    }

    if (!forceRefresh) {
      try {
        const state = await readLiveSuiteState();
        if (state.admin.session?.token) {
          this.cachedAdminSession = state.admin.session;
          return this.cachedAdminSession;
        }
      } catch {
        // Fall through to a direct login attempt.
      }
    }

    const response = await this.requestWithBackoff(
      () => this.api.post("/api/admin/login", {
        data: {
          email: runtime.adminEmail,
          password: runtime.adminPassword,
        },
      }),
      { retries: 2, backoffMs: 5_000, retryStatuses: [429] },
    );

    const body = await response.json();
    if (response.status() === 202 && body?.requiresTwoFactor) {
      throw new Error("Admin login requires live OTP verification. Playwright cannot continue admin-authenticated checks without OTP access.");
    }

    expect(response.ok()).toBeTruthy();
    expect(body?.token).toBeTruthy();
    this.cachedAdminSession = body as AdminSession;
    return this.cachedAdminSession;
  }

  async adminGet(path: string) {
    let admin = await this.loginAdmin();
    let response = await this.api.get(path, {
      headers: authHeaders(admin.token),
    });
    if (response.status() === 401) {
      try {
        const bootstrap = await this.seedTestAccounts();
        if (bootstrap?.adminSession?.token) {
          this.cachedAdminSession = bootstrap.adminSession;
          admin = bootstrap.adminSession;
        } else {
          admin = await this.loginAdmin(true);
        }
      } catch {
        admin = await this.loginAdmin(true);
      }
      response = await this.api.get(path, {
        headers: authHeaders(admin.token),
      });
    }
    return response;
  }

  async getRazorpayDiag(token: string) {
    let response = token
      ? await this.api.get("/api/diag/razorpay", { headers: authHeaders(token) })
      : await this.adminGet("/api/diag/razorpay");
    if (response.status() === 401) {
      response = await this.adminGet("/api/diag/razorpay");
    }
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async getSeededCustomerSessions() {
    const bootstrap = await this.seedTestAccounts();
    return (bootstrap.sessions?.customers || [])
      .map((entry) => entry.session)
      .filter((session): session is MobileSession => Boolean(session?.token && session?.user?.phone));
  }

  async loginMobile(phone: string, userType: "customer" | "driver", forceRefresh = false): Promise<MobileSession> {
    const cacheKey = this.getMobileCacheKey(phone, userType);
    const cached = this.mobileSessionCache.get(cacheKey);
    if (!forceRefresh && cached?.token) {
      return cached;
    }

    const response = await this.requestWithBackoff(
      () => this.api.post("/api/app/login-password", {
        data: {
          phone,
          password: runtime.liveMobilePassword,
          userType,
        },
      }),
      { retries: 2, backoffMs: 4_000, retryStatuses: [429] },
    );
    if (!response.ok()) {
      const body = await readResponseBody(response);
      throw new Error(`loginMobile failed for ${userType}:${phone || "<empty>"} status=${response.status()} body=${JSON.stringify(body)}`);
    }
    const body = await response.json() as any;
    const session = normalizeMobileSession(body, { phone, userType });
    this.mobileSessionCache.set(cacheKey, session);
    return session;
  }

  async refreshMobileSession(session: MobileSession) {
    const fallbackPhone = String(session.user?.phone || (session as any).phone || "").trim();
    const fallbackUserType = String(session.user?.userType || (session as any).userType || "").trim() as "customer" | "driver";
    if (!fallbackPhone) {
      throw new Error(`refreshMobileSession missing fallback phone for session token=${String(session.token || "").slice(0, 16)}`);
    }
    const refreshed = await this.refreshMobileAccessToken(session)
      ?? await this.loginMobile(fallbackPhone, fallbackUserType || "customer", true);
    session.token = refreshed.token;
    session.refreshToken = refreshed.refreshToken;
    session.expiresAt = refreshed.expiresAt;
    session.user = refreshed.user;
    this.mobileSessionCache.set(this.getMobileCacheKey(session.user.phone, session.user.userType as "customer" | "driver"), session);
    await updateLiveActorSession(session.user.phone, session.user.userType, session);
    return session;
  }

  async registerMobile(params: {
    phone: string;
    password: string;
    fullName: string;
    userType: "customer" | "driver";
    email?: string;
  }): Promise<MobileSession> {
    const response = await this.requestWithBackoff(
      () => this.api.post("/api/app/register", {
        data: params,
      }),
      { retries: 2, backoffMs: 4_000, retryStatuses: [429] },
    );
    expect([200, 201, 409]).toContain(response.status());
    if (response.status() === 409) {
      return this.loginMobile(params.phone, params.userType);
    }
    const body = await response.json() as any;
    const session = normalizeMobileSession(body, { phone: params.phone, userType: params.userType, fullName: params.fullName });
    this.mobileSessionCache.set(this.getMobileCacheKey(params.phone, params.userType), session);
    return session;
  }

  async updateDriverProfile(session: MobileSession, payload: {
    fullName?: string;
    email?: string;
    vehicleNumber?: string;
    vehicleModel?: string;
    vehicleCategoryId?: string;
  }) {
    const response = await this.mobilePatch(session, "/api/app/driver/profile", payload);
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async approveDriver(adminToken: string, driverId: string, note: string) {
    const response = await this.api.patch(`/api/admin/drivers/${driverId}/verify-driver`, {
      data: {
        status: "approved",
        vehicleStatus: "approved",
        note,
      },
      headers: authHeaders(adminToken),
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async getVehicleCategories() {
    let response = await this.api.get("/api/app/vehicle-categories");
    if (!response.ok()) {
      response = await this.api.get("/api/vehicle-categories");
    }
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    const list = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    return list as VehicleCategory[];
  }

  async getDriverEligibleServices(session: MobileSession) {
    const response = await this.mobileGet(session, "/api/app/driver/eligible-services");
    expect(response.ok()).toBeTruthy();
    return response.json() as Promise<DriverEligibleServicesResponse>;
  }

  async getCategoryByLabel(label: "bike" | "auto" | "cab" | "pool") {
    const categories = await this.getVehicleCategories();
    const normalized = label.toLowerCase();
    const category = categories.find((item) => {
      const haystack = `${item.name} ${item.type || ""} ${item.vehicleType || ""} ${item.serviceType || ""}`.toLowerCase();
      if (normalized === "bike") return haystack.includes("bike") && !haystack.includes("parcel");
      if (normalized === "auto") return haystack.includes("auto");
      if (normalized === "cab") return haystack.includes("cab") || haystack.includes("sedan") || haystack.includes("car");
      if (normalized === "pool") return item.isCarpool === true || haystack.includes("pool") || haystack.includes("carpool");
      return false;
    });
    expect(category, `Missing vehicle category for ${label}`).toBeTruthy();
    return category as VehicleCategory;
  }

  async tryGetCategoryByLabel(label: "bike" | "auto" | "cab" | "pool") {
    const categories = await this.getVehicleCategories();
    const normalized = label.toLowerCase();
    return categories.find((item) => {
      const haystack = `${item.name} ${item.type || ""} ${item.vehicleType || ""} ${item.serviceType || ""}`.toLowerCase();
      if (normalized === "bike") return haystack.includes("bike") && !haystack.includes("parcel");
      if (normalized === "auto") return haystack.includes("auto");
      if (normalized === "cab") return haystack.includes("cab") || haystack.includes("sedan") || haystack.includes("car");
      if (normalized === "pool") return item.isCarpool === true || haystack.includes("pool") || haystack.includes("carpool");
      return false;
    }) || null;
  }

  async getNearbyDrivers(vehicleCategoryId: string) {
    const response = await this.api.get("/api/app/nearby-drivers", {
      params: {
        lat: runtime.ridePickupLat,
        lng: runtime.ridePickupLng,
        radius: 5,
        vehicleCategoryId,
      },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async bookRide(session: MobileSession, payload: Record<string, unknown>) {
    const response = await this.mobilePost(session, "/api/app/customer/book-ride", payload);
    if (!response.ok()) {
      const body = await readResponseBody(response);
      throw new Error(`bookRide failed with status ${response.status()}: ${JSON.stringify(body)}`);
    }
    return response.json();
  }

  async getCustomerActiveTrip(session: MobileSession) {
    const response = await this.mobileGet(session, "/api/app/customer/active-trip");
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async bestEffortCancelActiveTrip(session: MobileSession, reason: string) {
    try {
      const body = await this.getCustomerActiveTrip(session);
      const trip = body?.trip || body?.activeTrip || body?.data || null;
      const tripId = trip?.id || body?.tripId || null;
      const status = trip?.currentStatus || trip?.status || body?.status || null;
      if (!tripId || !status) return;
      if (["completed", "cancelled", "on_the_way", "payment_pending"].includes(String(status))) return;
      await this.cancelCustomerTrip(session, tripId, reason);
    } catch {
      // Cleanup should never break the suite.
    }
  }

  async getDriverIncomingTrip(session: MobileSession) {
    const response = await this.mobileGet(session, "/api/app/driver/incoming-trip");
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async getDriverActiveTrip(session: MobileSession) {
    const response = await this.mobileGet(session, "/api/app/driver/active-trip");
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async setDriverOnlineStatus(
    session: MobileSession,
    payload: { isOnline: boolean; lat?: number; lng?: number },
  ) {
    const response = await this.mobilePatch(session, "/api/app/driver/online-status", payload);
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async acceptTrip(session: MobileSession, tripId: string) {
    const response = await this.mobilePost(session, "/api/app/driver/accept-trip", { tripId });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async markArrived(session: MobileSession, tripId: string) {
    const response = await this.mobilePost(session, "/api/app/driver/arrived", { tripId });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async startTrip(session: MobileSession, tripId: string, pickupOtp: string) {
    const response = await this.mobilePost(session, "/api/app/driver/start-trip", { tripId, pickupOtp });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async completeTrip(session: MobileSession, tripId: string, actualFare: number) {
    const response = await this.mobilePost(session, "/api/app/driver/complete-trip", {
      tripId,
      actualFare,
      actualDistance: 8.5,
      tips: 0,
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async cancelCustomerTrip(session: MobileSession, tripId: string, reason: string) {
    const response = await this.mobilePost(session, "/api/app/customer/cancel-trip", { tripId, reason });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async getCustomerTripReceipt(session: MobileSession, tripId: string) {
    const response = await this.mobileGet(session, `/api/app/customer/trip-receipt/${tripId}`);
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async getDriverTripReceipt(session: MobileSession, tripId: string) {
    const response = await this.mobileGet(session, `/api/app/driver/trip-receipt/${tripId}`);
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async getCustomerWallet(session: MobileSession) {
    const response = await this.mobileGet(session, "/api/app/customer/wallet");
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async createWalletOrder(session: MobileSession, amount: number) {
    const response = await this.mobilePost(session, "/api/app/customer/wallet/create-order", { amount });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async createRidePaymentOrder(session: MobileSession, amount: number, tripId: string) {
    const response = await this.mobilePost(session, "/api/app/customer/ride/create-order", { amount, tripId });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async verifyRidePaymentInvalid(session: MobileSession, orderId: string) {
    const response = await this.mobilePost(session, "/api/app/customer/ride/verify-payment", {
        razorpayOrderId: orderId,
        razorpayPaymentId: `pay_invalid_${Date.now()}`,
        razorpaySignature: "invalid_signature",
    });
    expect(response.status()).toBe(400);
    return response.json();
  }

  async quoteParcel(session: MobileSession, payload: Record<string, unknown>) {
    const response = await this.mobilePost(session, "/api/app/parcel/quote", payload);
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async bookParcel(session: MobileSession, payload: Record<string, unknown>) {
    const response = await this.mobilePost(session, "/api/app/parcel/book", payload);
    if (!response.ok()) {
      const body = await readResponseBody(response);
      throw new Error(`bookParcel failed with status ${response.status()}: ${JSON.stringify(body)}`);
    }
    return response.json();
  }

  async cancelParcel(session: MobileSession, orderId: string, reason: string) {
    const response = await this.mobilePost(session, `/api/app/parcel/${orderId}/cancel`, { reason });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async createOutstationRide(session: MobileSession, payload: Record<string, unknown>) {
    const response = await this.mobilePost(session, "/api/app/driver/outstation-pool/rides", payload);
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async createOutstationRideExpectFailure(session: MobileSession, payload: Record<string, unknown>) {
    const response = await this.mobilePost(session, "/api/app/driver/outstation-pool/rides", payload);
    expect(response.ok()).toBeFalsy();
    return {
      status: response.status(),
      body: await readResponseBody(response),
    };
  }

  async searchOutstationRides(session: MobileSession, fromCity: string, toCity: string, date?: string) {
    const response = await this.mobileGet(session, "/api/app/customer/outstation-pool/search", { fromCity, toCity, date });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async bookOutstationRide(session: MobileSession, payload: Record<string, unknown>) {
    const response = await this.mobilePost(session, "/api/app/customer/outstation-pool/book", payload);
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async deactivateOutstationRide(session: MobileSession, rideId: string, note: string) {
    const response = await this.mobilePatch(session, `/api/app/driver/outstation-pool/rides/${rideId}`, {
      isActive: false,
      status: "cancelled",
      note,
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async getAdminOutstationRides(token: string) {
    const response = token
      ? await this.api.get("/api/admin/outstation-pool/rides", { headers: authHeaders(token) })
      : await this.adminGet("/api/admin/outstation-pool/rides");
    if (response.status() === 401) {
      const retry = await this.adminGet("/api/admin/outstation-pool/rides");
      expect(retry.ok()).toBeTruthy();
      return retry.json();
    }
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async triggerSos(session: MobileSession, payload: Record<string, unknown>) {
    const response = await this.mobilePost(session, "/api/app/sos", payload);
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async triggerAiSos(session: MobileSession, payload: Record<string, unknown>) {
    const response = await this.mobilePost(session, "/api/app/ai/sos", payload);
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async getCustomerSupportChat(session: MobileSession) {
    const response = await this.mobileGet(session, "/api/app/customer/support-chat");
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async sendCustomerSupportChat(session: MobileSession, message: string) {
    const response = await this.mobilePost(session, "/api/app/customer/support-chat/send", { message });
    expect(response.ok()).toBeTruthy();
    return response.json();
  }

  async validateSharedState(state: SharedLiveSuiteState) {
    const checks = await Promise.all([
      this.api.get("/api/admin/system-health", {
        headers: authHeaders(state.admin.session.token),
      }),
      this.api.get("/api/app/customer/active-trip", {
        headers: authHeaders(state.actors.customerPrimary.session.token),
      }),
      this.api.get("/api/app/customer/active-trip", {
        headers: authHeaders(state.actors.customerSecondary?.session.token || state.actors.customerPrimary.session.token),
      }),
      this.api.get("/api/app/driver/active-trip", {
        headers: authHeaders(state.actors.driverBikePrimary.session.token),
      }),
      this.api.get("/api/app/driver/active-trip", {
        headers: authHeaders(state.actors.driverAutoPrimary?.session.token || state.actors.driverBikePrimary.session.token),
      }),
      this.api.get("/api/app/driver/active-trip", {
        headers: authHeaders(state.actors.driverCabPrimary.session.token),
      }),
    ]);
    return checks.every((response) => response.ok());
  }

  private async mobileGet(
    session: MobileSession,
    path: string,
    params?: Record<string, string | number | undefined>,
  ) {
    return this.requestWithMobileAuth(session, (token) => this.api.get(path, {
      params,
      headers: authHeaders(token),
    }));
  }

  private async mobilePost(session: MobileSession, path: string, data?: unknown) {
    return this.requestWithMobileAuth(session, (token) => this.api.post(path, {
      data,
      headers: authHeaders(token),
    }));
  }

  private async mobilePatch(session: MobileSession, path: string, data?: unknown) {
    return this.requestWithMobileAuth(session, (token) => this.api.patch(path, {
      data,
      headers: authHeaders(token),
    }));
  }

  private async requestWithMobileAuth(
    session: MobileSession,
    factory: (token: string) => Promise<any>,
  ) {
    let response = await factory(session.token);
    if (response.status() !== 401) {
      return response;
    }

    await this.refreshMobileSession(session);
    return factory(session.token);
  }

  private async refreshMobileAccessToken(session: MobileSession): Promise<MobileSession | null> {
    const refreshToken = String(session.refreshToken || "").trim();
    const payload = decodeAccessToken(session.token);
    const deviceId = String(payload?.deviceId || "").trim();
    if (!refreshToken || !deviceId) {
      return null;
    }

    const response = await this.api.post("/api/app/auth/refresh", {
      data: {
        refreshToken,
        deviceId,
      },
      headers: {
        "content-type": "application/json",
        "x-device-id": deviceId,
      },
    });

    if (!response.ok()) {
      return null;
    }

    const body = await response.json() as { token?: string; refreshToken?: string };
    if (!body?.token) {
      return null;
    }

    return {
      ...session,
      token: body.token,
      refreshToken: body.refreshToken || refreshToken,
    };
  }

  private async bootstrapQaAccounts() {
    const admin = await this.loginAdmin();
    const bikeCategory = await this.getCategoryByLabel("bike");
    const autoCategory = await this.getCategoryByLabel("auto");
    const cabCategory = await this.getCategoryByLabel("cab");

    const ensureCustomer = async (phone: string, fullName: string) => {
      const existing = await this.api.post("/api/app/login-password", {
        data: {
          phone,
          password: runtime.liveMobilePassword,
          userType: "customer",
        },
      });
      if (existing.ok()) {
        return existing.json() as Promise<MobileSession>;
      }
      if (existing.status() === 429) {
        throw new Error(`Customer bootstrap rate-limited for ${phone}. Wait for the production login window to reset before retrying.`);
      }
      if (existing.status() !== 404) {
        expect(existing.ok(), `Unexpected customer bootstrap status ${existing.status()} for ${phone}`).toBeTruthy();
      }
      return this.registerMobile({
        phone,
        password: runtime.liveMobilePassword,
        fullName,
        userType: "customer",
      });
    };

    const ensureDriver = async (params: {
      phone: string;
      fullName: string;
      vehicleCategoryId: string;
      vehicleNumber: string;
      vehicleModel: string;
    }) => {
      const existing = await this.api.post("/api/app/login-password", {
        data: {
          phone: params.phone,
          password: runtime.liveMobilePassword,
          userType: "driver",
        },
      });

      let session: MobileSession;
      if (existing.ok()) {
        session = await existing.json() as MobileSession;
      } else {
        if (existing.status() === 429) {
          throw new Error(`Driver bootstrap rate-limited for ${params.phone}. Wait for the production login window to reset before retrying.`);
        }
        if (existing.status() !== 404) {
          expect(existing.ok(), `Unexpected driver bootstrap status ${existing.status()} for ${params.phone}`).toBeTruthy();
        }
        session = await this.registerMobile({
          phone: params.phone,
          password: runtime.liveMobilePassword,
          fullName: params.fullName,
          userType: "driver",
        });
      }

      await this.updateDriverProfile(session, {
        fullName: params.fullName,
        vehicleNumber: params.vehicleNumber,
        vehicleModel: params.vehicleModel,
        vehicleCategoryId: params.vehicleCategoryId,
      });
      await this.approveDriver(admin.token, session.user.id, `Playwright QA bootstrap for ${params.phone}`);
      return session;
    };

    const customers = await Promise.all([
      ensureCustomer(runtime.liveCustomerPhone, "JAGO QA Customer 1"),
      ensureCustomer(runtime.liveCustomerPhone2, "JAGO QA Customer 2"),
    ]);

    const drivers = await Promise.all([
      ensureDriver({
        phone: runtime.liveDriverBikePhone,
        fullName: "JAGO QA Driver Bike 1",
        vehicleCategoryId: bikeCategory.id,
        vehicleNumber: "TS01QA1001",
        vehicleModel: "Hero Splendor QA",
      }),
      ensureDriver({
        phone: "9100000002",
        fullName: "JAGO QA Driver Bike 2",
        vehicleCategoryId: bikeCategory.id,
        vehicleNumber: "TS01QA1002",
        vehicleModel: "Honda Shine QA",
      }),
      ensureDriver({
        phone: "9100000003",
        fullName: "JAGO QA Driver Bike 3",
        vehicleCategoryId: bikeCategory.id,
        vehicleNumber: "TS01QA1003",
        vehicleModel: "Bajaj Pulsar QA",
      }),
      ensureDriver({
        phone: "9100000004",
        fullName: "JAGO QA Driver Bike 4",
        vehicleCategoryId: bikeCategory.id,
        vehicleNumber: "TS01QA1004",
        vehicleModel: "TVS Apache QA",
      }),
      ensureDriver({
        phone: runtime.liveDriverAutoPhone,
        fullName: "JAGO QA Driver Auto 1",
        vehicleCategoryId: autoCategory.id,
        vehicleNumber: "TS09QA5001",
        vehicleModel: "Bajaj RE QA",
      }),
      ensureDriver({
        phone: runtime.liveDriverCabPhone,
        fullName: "JAGO QA Driver Cab 1",
        vehicleCategoryId: cabCategory.id,
        vehicleNumber: "TS07QA8001",
        vehicleModel: "Swift Dzire QA",
      }),
    ]);

    return {
      success: true,
      bootstrapMode: "fallback" as const,
      fallback: true,
      admin: admin.admin.email,
      customers: customers.map((customer) => customer.user.phone),
      drivers: drivers.map((driver) => driver.user.phone),
    };
  }

  private getMobileCacheKey(phone: string, userType: "customer" | "driver") {
    return `${userType}:${phone}`;
  }

  private async requestWithBackoff<T>(
    factory: () => Promise<T>,
    options: { retries: number; backoffMs: number; retryStatuses: number[] },
  ): Promise<T> {
    let attempt = 0;
    for (;;) {
      const response = await factory();
      const status = this.readStatus(response);
      if (status === null || !options.retryStatuses.includes(status) || attempt >= options.retries) {
        return response;
      }
      const retryAfterMs = this.readRetryAfterMs(response);
      const delayMs = retryAfterMs ?? (options.backoffMs * (attempt + 1));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt += 1;
    }
  }

  private readStatus(response: unknown) {
    if (!response || typeof response !== "object") return null;
    const candidate = response as { status?: unknown };
    if (typeof candidate.status === "function") {
      return Number(candidate.status());
    }
    if (typeof candidate.status === "number") {
      return candidate.status;
    }
    return null;
  }

  private readRetryAfterMs(response: unknown) {
    if (!response || typeof response !== "object") return null;
    const candidate = response as { headers?: unknown };
    if (typeof candidate.headers !== "function") return null;
    const headers = candidate.headers() as Record<string, string>;
    const retryAfter = headers["retry-after"] || headers["Retry-After"];
    if (!retryAfter) return null;

    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1_000;
    }

    const dateMs = Date.parse(retryAfter);
    if (Number.isNaN(dateMs)) return null;
    return Math.max(1_000, dateMs - Date.now());
  }
}

function decodeAccessToken(token: string | undefined): AccessTokenPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as AccessTokenPayload;
  } catch {
    return null;
  }
}

function normalizeMobileSession(
  body: any,
  fallback: { phone: string; userType: "customer" | "driver"; fullName?: string },
): MobileSession {
  const candidateUser = body?.user || body?.customer || body?.driver || body?.data?.user || null;
  return {
    token: String(body?.token || body?.accessToken || body?.data?.token || ""),
    refreshToken: String(body?.refreshToken || body?.data?.refreshToken || ""),
    expiresAt: body?.expiresAt || body?.data?.expiresAt,
    user: {
      id: String(candidateUser?.id || body?.userId || body?.id || ""),
      fullName: String(candidateUser?.fullName || candidateUser?.name || fallback.fullName || fallback.phone),
      phone: String(candidateUser?.phone || candidateUser?.mobile || body?.phone || fallback.phone),
      userType: String(candidateUser?.userType || body?.userType || fallback.userType),
      walletBalance: candidateUser?.walletBalance ?? body?.walletBalance,
    },
  };
}
