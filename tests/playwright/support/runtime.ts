const defaultBaseURL = process.env.APP_BASE_URL || "http://127.0.0.1:4173";
const defaultApiBaseURL = process.env.PW_API_BASE_URL || `http://127.0.0.1:${process.env.PW_API_PORT || "4010"}`;
const qaTagPrefix = process.env.PW_QA_TAG_PREFIX || "JAGO-QA-LIVE";

export const runtime = {
  envName: process.env.PW_ENV || "mock",
  baseURL: process.env.PW_BASE_URL || defaultBaseURL,
  apiBaseURL: defaultApiBaseURL,
  adminEmail: process.env.PW_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "qa-admin@jago.test",
  adminPassword: process.env.PW_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "",
  opsApiKey: process.env.PW_OPS_API_KEY || process.env.OPS_API_KEY || "",
  adminResetKey: process.env.PW_ADMIN_RESET_KEY || process.env.PW_OPS_API_KEY || process.env.ADMIN_RESET_KEY || process.env.OPS_API_KEY || "",
  testPhone: process.env.PW_TEST_PHONE || "9999999999",
  driverId: process.env.PW_DRIVER_ID || "driver-qa-001",
  customerId: process.env.PW_CUSTOMER_ID || "customer-qa-001",
  razorpaySecret: process.env.PW_RAZORPAY_SECRET || process.env.RAZORPAY_KEY_SECRET || "mock_razorpay_secret",
  qaTagPrefix,
  qaRunId: `${qaTagPrefix}-${Date.now()}`,
  useLiveBackend: process.env.PW_USE_LIVE_BACKEND === "true",
  useRealSocket: process.env.PW_USE_REAL_SOCKET === "true",
  useRealPayments: process.env.PW_USE_REAL_PAYMENTS === "true",
  useRealAuth: process.env.PW_USE_REAL_AUTH === "true",
  liveCustomerPhone: process.env.PW_LIVE_CUSTOMER_PHONE || "9000000001",
  liveCustomerPhone2: process.env.PW_LIVE_CUSTOMER_PHONE_2 || "9000000002",
  liveDriverBikePhone: process.env.PW_LIVE_DRIVER_BIKE_PHONE || "9100000001",
  liveDriverAutoPhone: process.env.PW_LIVE_DRIVER_AUTO_PHONE || "9100000005",
  liveDriverCabPhone: process.env.PW_LIVE_DRIVER_CAB_PHONE || "9100000008",
  liveMobilePassword: process.env.PW_LIVE_MOBILE_PASSWORD || "",
  ridePickupLat: Number(process.env.PW_RIDE_PICKUP_LAT || "17.385"),
  ridePickupLng: Number(process.env.PW_RIDE_PICKUP_LNG || "78.4867"),
  rideDestinationLat: Number(process.env.PW_RIDE_DESTINATION_LAT || "17.4474"),
  rideDestinationLng: Number(process.env.PW_RIDE_DESTINATION_LNG || "78.3762"),
};

export const bookingTypes = [
  { key: "bike", label: "bike" },
  { key: "auto", label: "auto" },
  { key: "cab", label: "cab" },
  { key: "parcel", label: "parcel" },
  { key: "local_pool", label: "local pool" },
  { key: "outstation_pool", label: "outstation pool" },
] as const;

export function createAdminSession() {
  const admin = {
    id: "admin-001",
    name: "JAGO QA Admin",
    email: runtime.adminEmail,
    role: "superadmin",
  };

  return {
    ...admin,
    admin,
    token: "admin-token-playwright",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

export function createQaTag(label: string) {
  return `[${runtime.qaRunId}] ${label}`;
}

function isPlaceholderSecret(value: string | undefined) {
  if (!value) return true;
  return /change-me|example\.com|your-app-domain|xxxxx/i.test(value);
}

export function getLiveCredentialBlockers() {
  const blockers: string[] = [];
  const hasSeedBootstrapKey =
    !isPlaceholderSecret(runtime.opsApiKey) || !isPlaceholderSecret(runtime.adminResetKey);

  if (isPlaceholderSecret(runtime.adminEmail)) {
    blockers.push("Admin email is missing or still using a placeholder value.");
  }

  if (!hasSeedBootstrapKey && isPlaceholderSecret(runtime.adminPassword)) {
    blockers.push("Admin password is missing or still using a placeholder value.");
  }

  if (!hasSeedBootstrapKey) {
    blockers.push("Neither ops API key nor admin reset key is configured for live QA seeding.");
  }

  return blockers;
}
