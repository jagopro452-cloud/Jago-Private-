import { useState } from "react";

type ApiMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface ApiEndpoint {
  method: ApiMethod;
  path: string;
  desc: string;
  auth?: boolean;
  body?: string;
  response?: string;
  notes?: string;
}

interface ApiSection {
  title: string;
  icon: string;
  color: string;
  bg: string;
  app: "both" | "driver" | "customer" | "shared";
  endpoints: ApiEndpoint[];
}

const METHOD_COLOR: Record<ApiMethod, string> = {
  GET:    "#16a34a",
  POST:   "#1a73e8",
  PATCH:  "#d97706",
  PUT:    "#7c3aed",
  DELETE: "#dc2626",
};

const BASE_URL = "https://jagopro.org";

const API_SECTIONS: ApiSection[] = [
  {
    title: "Authentication",
    icon: "bi-shield-lock-fill",
    color: "#1a73e8",
    bg: "#e8f0fe",
    app: "both",
    endpoints: [
      {
        method: "POST",
        path: "/api/app/login",
        desc: "Password login for driver or customer",
        body: `{ "phone": "9876543210", "password": "secret", "userType": "customer" | "driver", "deviceId": "stable-device-id" }`,
        response: `{ "success": true, "token": "jwt-access-token", "refreshToken": "opaque-refresh-token", "expiresAt": "2026-05-22T00:00:00.000Z" }`,
        notes: "OTP auth is disabled in production. Store the access token for API calls and rotate it with the refresh endpoint.",
      },
      {
        method: "POST",
        path: "/api/app/auth/refresh",
        desc: "Rotate refresh token and issue a new JWT access token",
        body: `{ "refreshToken": "opaque-refresh-token", "deviceId": "stable-device-id" }`,
        response: `{ "success": true, "token": "jwt-access-token", "refreshToken": "new-refresh-token", "expiresAt": "2026-05-22T00:00:00.000Z" }`,
        notes: "Refresh reuse and mismatched device IDs are rejected. Logout revokes the active session.",
      },
    ],
  },
  {
    title: "Driver App",
    icon: "bi-car-front-fill",
    color: "#16a34a",
    bg: "#f0fdf4",
    app: "driver",
    endpoints: [
      {
        method: "GET",
        path: "/api/app/driver/profile",
        desc: "Get driver profile, stats, wallet balance, online status",
        auth: true,
        response: `{ "id": "uuid", "fullName": "Ramesh", "phone": "...", "rating": 4.8, "walletBalance": -85.50, "isLocked": true, "isOnline": false, "stats": { "completedTrips": 48, "totalEarned": 32000 } }`,
      },
      {
        method: "POST",
        path: "/api/app/driver/location",
        desc: "Update driver GPS location (call every 5-10 seconds when online)",
        auth: true,
        body: `{ "lat": 17.385, "lng": 78.486, "heading": 90, "speed": 30, "isOnline": true }`,
        response: `{ "success": true }`,
      },
      {
        method: "PATCH",
        path: "/api/app/driver/online-status",
        desc: "Go Online or Offline. Checks wallet lock before allowing online.",
        auth: true,
        body: `{ "isOnline": true }`,
        response: `{ "success": true, "isOnline": true }`,
        notes: "If driver is locked (negative wallet), returns 403 with isLocked: true. Show payment screen.",
      },
      {
        method: "GET",
        path: "/api/app/driver/incoming-trip",
        desc: "Poll for incoming trip assignment (every 3-5 seconds when online)",
        auth: true,
        response: `{ "trip": { "id": "uuid", "customerName": "Arjun", "customerPhone": "...", "pickupAddress": "...", "destinationAddress": "...", "estimatedFare": 180 }, "stage": "assigned" | "accepted" }`,
        notes: "Returns null trip if no incoming trip. Driver must accept within 30 seconds.",
      },
      {
        method: "POST",
        path: "/api/app/driver/accept-trip",
        desc: "Accept incoming trip → Generates 4-digit pickup OTP",
        auth: true,
        body: `{ "tripId": "uuid" }`,
        response: `{ "success": true, "trip": {...}, "pickupOtp": "4823" }`,
        notes: "Store pickupOtp locally. Driver shows this on screen, customer reads and confirms.",
      },
      {
        method: "POST",
        path: "/api/app/driver/reject-trip",
        desc: "Reject / skip an assigned trip",
        auth: true,
        body: `{ "tripId": "uuid" }`,
        response: `{ "success": true }`,
      },
      {
        method: "POST",
        path: "/api/app/driver/arrived",
        desc: "Mark driver as arrived at pickup location",
        auth: true,
        body: `{ "tripId": "uuid" }`,
        response: `{ "success": true, "pickupOtp": "4823" }`,
      },
      {
        method: "POST",
        path: "/api/app/driver/verify-pickup-otp",
        desc: "Customer tells OTP → Driver enters → Ride starts",
        auth: true,
        body: `{ "tripId": "uuid", "otp": "4823" }`,
        response: `{ "success": true, "trip": { "currentStatus": "on_the_way", ... } }`,
        notes: "Status changes to 'on_the_way'. Start navigation to destination.",
      },
      {
        method: "POST",
        path: "/api/app/driver/complete-trip",
        desc: "Mark trip as completed. Auto-deducts platform commission from wallet.",
        auth: true,
        body: `{ "tripId": "uuid", "actualFare": 195, "actualDistance": 8.5, "tips": 20 }`,
        response: `{ "success": true, "trip": {...}, "platformDeduction": 34.5 }`,
        notes: "Platform fee (commission% + GST + insurance) auto-deducted. If balance < -₹100, account auto-locked.",
      },
      {
        method: "POST",
        path: "/api/app/driver/cancel-trip",
        desc: "Cancel an accepted trip (before ride starts)",
        auth: true,
        body: `{ "tripId": "uuid", "reason": "Vehicle breakdown" }`,
        response: `{ "success": true }`,
      },
      {
        method: "POST",
        path: "/api/app/driver/rate-customer",
        desc: "Rate customer after trip",
        auth: true,
        body: `{ "tripId": "uuid", "rating": 5, "note": "Great passenger" }`,
        response: `{ "success": true }`,
      },
      {
        method: "GET",
        path: "/api/app/driver/trips",
        desc: "Driver trip history",
        auth: true,
        response: `{ "data": [...trips], "total": 48 }`,
        notes: "Query params: ?status=completed|cancelled&limit=20&offset=0",
      },
      {
        method: "GET",
        path: "/api/app/driver/wallet",
        desc: "Wallet balance + payment history",
        auth: true,
        response: `{ "walletBalance": -85.50, "isLocked": true, "lockReason": "...", "pendingPaymentAmount": 85.50, "history": [...payments] }`,
      },
    ],
  },
  {
    title: "Customer App",
    icon: "bi-person-fill",
    color: "#7c3aed",
    bg: "#f5f3ff",
    app: "customer",
    endpoints: [
      {
        method: "GET",
        path: "/api/app/customer/profile",
        desc: "Get customer profile + trip stats",
        auth: true,
        response: `{ "id": "uuid", "fullName": "Arjun", "phone": "...", "rating": 4.9, "walletBalance": 250, "stats": { "completedTrips": 12, "totalSpent": 3400 } }`,
      },
      {
        method: "POST",
        path: "/api/app/customer/estimate-fare",
        desc: "Get fare estimate for a trip (no auth needed)",
        body: `{ "pickupLat": 17.385, "pickupLng": 78.486, "destLat": 17.445, "destLng": 78.350, "distanceKm": 8 }`,
        response: `{ "fares": [{ "vehicleName": "Car", "baseFare": 30, "farePerKm": 12, "estimatedFare": 126 }], "distanceKm": 8 }`,
      },
      {
        method: "POST",
        path: "/api/app/customer/book-ride",
        desc: "Book a ride → Auto-assigns nearest online driver",
        auth: true,
        body: `{ "pickupAddress": "MGBS Hyderabad", "pickupLat": 17.385, "pickupLng": 78.486, "destinationAddress": "Banjara Hills", "destinationLat": 17.415, "destinationLng": 78.448, "vehicleCategoryId": "uuid", "estimatedFare": 180, "estimatedDistance": 8.2, "paymentMethod": "cash" | "wallet" | "online" }`,
        response: `{ "success": true, "trip": { "id": "uuid", "refId": "TRP12345", "currentStatus": "driver_assigned" | "searching" }, "driver": { "id": "uuid", "fullName": "Anil", "lat": 17.38, "lng": 78.48 } }`,
        notes: "If no driver nearby, status = 'searching'. Keep polling active-trip API.",
      },
      {
        method: "GET",
        path: "/api/app/customer/active-trip",
        desc: "Get current active trip + driver live location (poll every 5 sec)",
        auth: true,
        response: `{ "trip": { "id": "uuid", "currentStatus": "accepted" | "arrived" | "on_the_way", "driverName": "Anil", "driverLat": 17.382, "driverLng": 78.483, "pickupOtpVisible": "4823" } }`,
        notes: "pickupOtpVisible only present when driver is 'arrived'. Show OTP to customer to read to driver.",
      },
      {
        method: "GET",
        path: "/api/app/customer/track-trip/:tripId",
        desc: "Track specific trip + driver location",
        auth: true,
        response: `{ "currentStatus": "on_the_way", "driverLat": 17.39, "driverLng": 78.47, ... }`,
      },
      {
        method: "POST",
        path: "/api/app/customer/cancel-trip",
        desc: "Cancel trip (only allowed before ride starts)",
        auth: true,
        body: `{ "tripId": "uuid", "reason": "Changed plans" }`,
        response: `{ "success": true }`,
        notes: "Cannot cancel if status is 'on_the_way' or 'completed'.",
      },
      {
        method: "POST",
        path: "/api/app/customer/rate-driver",
        desc: "Rate driver after trip completion",
        auth: true,
        body: `{ "tripId": "uuid", "rating": 5, "review": "Very polite driver" }`,
        response: `{ "success": true }`,
      },
      {
        method: "GET",
        path: "/api/app/customer/trips",
        desc: "Customer trip history",
        auth: true,
        response: `{ "data": [...trips with driver info], "total": 12 }`,
        notes: "Query: ?limit=20&offset=0",
      },
    ],
  },
  {
    title: "Shared / Utility",
    icon: "bi-tools",
    color: "#d97706",
    bg: "#fefce8",
    app: "shared",
    endpoints: [
      {
        method: "GET",
        path: "/api/app/nearby-drivers",
        desc: "Get nearby online available drivers (for customer map)",
        response: `{ "drivers": [{ "id": "uuid", "fullName": "Anil", "lat": 17.385, "lng": 78.486, "heading": 90, "rating": 4.8 }] }`,
        notes: "Query: ?lat=17.385&lng=78.486&radius=5 (radius in km)",
      },
      {
        method: "GET",
        path: "/api/app/configs",
        desc: "App startup configs (vehicle categories, cancel reasons, settings)",
        response: `{ "vehicleCategories": [...], "cancellationReasons": [...], "configs": { "currency_symbol": "₹", "sos_number": "..." } }`,
        notes: "Call once on app launch. Cache locally.",
      },
      {
        method: "POST",
        path: "/api/app/fcm-token",
        desc: "Register FCM push notification token",
        auth: true,
        body: `{ "fcmToken": "...", "deviceType": "android" | "ios", "appVersion": "1.0.0" }`,
        response: `{ "success": true }`,
      },
      {
        method: "POST",
        path: "/api/app/sos",
        desc: "Emergency SOS from driver or customer",
        auth: true,
        body: `{ "lat": 17.385, "lng": 78.486, "tripId": "uuid", "message": "Need help" }`,
        response: `{ "success": true, "message": "SOS alert sent." }`,
      },
    ],
  },
];

const FLOW_STEPS = [
  {
    title: "Driver App Flow",
    icon: "bi-car-front-fill",
    color: "#16a34a",
    steps: [
      { n: 1, label: "Password Login", api: "POST /api/app/login", detail: "Get JWT access token + refresh token" },
      { n: 2, label: "Load Profile", api: "GET /api/app/driver/profile", detail: "Wallet balance, stats, rating" },
      { n: 3, label: "Go Online", api: "PATCH /api/app/driver/online-status { isOnline: true }", detail: "Checks wallet lock first" },
      { n: 4, label: "Send Location", api: "POST /api/app/driver/location (every 5s)", detail: "GPS coordinates + heading" },
      { n: 5, label: "Poll for Trip", api: "GET /api/app/driver/incoming-trip (every 3s)", detail: "Returns assigned trip" },
      { n: 6, label: "Accept Trip", api: "POST /api/app/driver/accept-trip", detail: "Gets pickup OTP (4 digits)" },
      { n: 7, label: "Navigate to Pickup", api: "POST /api/app/driver/arrived", detail: "On arrival, show OTP on screen" },
      { n: 8, label: "Verify OTP", api: "POST /api/app/driver/verify-pickup-otp", detail: "Customer shares OTP → ride starts" },
      { n: 9, label: "Complete Trip", api: "POST /api/app/driver/complete-trip", detail: "Enter actual fare → auto commission deduct" },
      { n: 10, label: "Rate Customer", api: "POST /api/app/driver/rate-customer", detail: "1-5 stars" },
    ],
  },
  {
    title: "Customer App Flow",
    icon: "bi-person-fill",
    color: "#7c3aed",
    steps: [
      { n: 1, label: "Password Login", api: "POST /api/app/login", detail: "Get JWT access token + refresh token" },
      { n: 2, label: "Get Fare Estimate", api: "POST /api/app/customer/estimate-fare", detail: "Show price options by vehicle" },
      { n: 3, label: "View Nearby Drivers", api: "GET /api/app/nearby-drivers?lat=...&lng=...", detail: "Show cars on map" },
      { n: 4, label: "Ride Booked", api: "POST /api/app/customer/book-ride", detail: "Booking created and nearest driver assignment starts" },
      { n: 5, label: "Waiting for Driver", api: "GET /api/app/customer/active-trip (every 5s)", detail: "Track assignment, driver location, and live status" },
      { n: 6, label: "Show OTP", api: "active-trip returns pickupOtpVisible when driver arrived", detail: "Customer reads OTP to driver" },
      { n: 7, label: "Ride in Progress", api: "Keep polling active-trip", detail: "status = on_the_way" },
      { n: 8, label: "Trip Done", api: "status = completed", detail: "Show fare summary" },
      { n: 9, label: "Rate Driver", api: "POST /api/app/customer/rate-driver", detail: "1-5 stars + review" },
    ],
  },
];

function EndpointCard({ ep }: { ep: ApiEndpoint }) {
  const [open, setOpen] = useState(false);
  const mc = METHOD_COLOR[ep.method];
  return (
    <div className="mb-2" style={{ border: "1px solid #f1f5f9", borderRadius: 10, overflow: "hidden" }}>
      <div className="d-flex align-items-center gap-3 p-3 cursor-pointer"
        style={{ background: open ? "#f8fafc" : "white", cursor: "pointer" }}
        onClick={() => setOpen(!open)}>
        <span className="badge fw-bold" style={{ background: mc, fontSize: 10, minWidth: 46, textAlign: "center" }}>{ep.method}</span>
        <code style={{ fontSize: 12.5, color: "#1e293b", flex: 1 }}>{ep.path}</code>
        {ep.auth && <span className="badge bg-warning text-dark" style={{ fontSize: 9 }}><i className="bi bi-lock-fill me-1"></i>Auth</span>}
        <span style={{ fontSize: 12, color: "#64748b", flex: 2 }}>{ep.desc}</span>
        <i className={`bi ${open ? "bi-chevron-up" : "bi-chevron-down"} text-muted`} style={{ fontSize: 11 }}></i>
      </div>
      {open && (
        <div className="p-3 pt-0" style={{ background: "#f8fafc", borderTop: "1px solid #f1f5f9" }}>
          {ep.auth && (
            <div className="mb-2 small" style={{ color: "#92400e" }}>
              <strong>Header:</strong> <code style={{ fontSize: 11 }}>Authorization: Bearer {"<token>"}</code>
            </div>
          )}
          {ep.body && (
            <div className="mb-2">
              <div className="fw-semibold mb-1" style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase" }}>Request Body</div>
              <pre style={{ background: "#1e293b", color: "#e2e8f0", borderRadius: 8, padding: "10px 14px", fontSize: 11, margin: 0, overflowX: "auto" }}>{ep.body}</pre>
            </div>
          )}
          {ep.response && (
            <div className="mb-2">
              <div className="fw-semibold mb-1" style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase" }}>Response</div>
              <pre style={{ background: "#0f172a", color: "#86efac", borderRadius: 8, padding: "10px 14px", fontSize: 11, margin: 0, overflowX: "auto" }}>{ep.response}</pre>
            </div>
          )}
          {ep.notes && (
            <div className="p-2 rounded-2" style={{ background: "#fefce8", border: "1px solid #fde68a", fontSize: 11.5, color: "#92400e" }}>
              <i className="bi bi-info-circle me-1"></i>{ep.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const DRIVER_API_SUMMARY = [
  { when: "App launch",             api: "GET /api/app/configs",                    note: "Cache vehicle categories locally" },  { when: "Login screen",           api: "POST /api/app/login",                     note: "Save JWT access token + refresh token" },
  { when: "Home screen load",       api: "GET /api/app/driver/profile",             note: "Show wallet, rating, online status" },
  { when: "Go Online / Offline",    api: "PATCH /api/app/driver/online-status",     note: "403 if wallet locked" },
  { when: "Every 5 seconds online", api: "POST /api/app/driver/location",           note: "Send lat/lng + heading" },
  { when: "Every 3 seconds online", api: "GET /api/app/driver/incoming-trip",       note: "Poll for new trip assignment" },
  { when: "Trip alert arrives",     api: "POST /api/app/driver/accept-trip",        note: "Get pickup OTP (4 digits)" },
  { when: "Reached pickup point",   api: "POST /api/app/driver/arrived",            note: "Show OTP on driver screen" },
  { when: "Customer reads OTP",     api: "POST /api/app/driver/verify-pickup-otp",  note: "Ride starts — navigate to dest" },
  { when: "Ride over",              api: "POST /api/app/driver/complete-trip",      note: "Enter final fare → commission deducted" },
  { when: "After completion",       api: "POST /api/app/driver/rate-customer",      note: "1–5 stars" },
  { when: "History screen",         api: "GET /api/app/driver/trips",               note: "?status=completed&limit=20" },
  { when: "Wallet screen",          api: "GET /api/app/driver/wallet",              note: "Balance + history + lock status" },
  { when: "FCM token refresh",      api: "POST /api/app/fcm-token",                 note: "Register push notification token" },
  { when: "Emergency",              api: "POST /api/app/sos",                       note: "Send SOS alert" },
];

const CUSTOMER_API_SUMMARY = [
  { when: "App launch",             api: "GET /api/app/configs",                    note: "Cache vehicle categories" },  { when: "Login screen",           api: "POST /api/app/login",                     note: "Save JWT access token + refresh token" },
  { when: "Home screen load",       api: "GET /api/app/customer/profile",           note: "Show wallet balance, stats" },
  { when: "Home map screen",        api: "GET /api/app/nearby-drivers",             note: "?lat=&lng=&radius=5" },
  { when: "Pickup selected",        api: "POST /api/app/customer/estimate-fare",    note: "Show price options for each vehicle" },
  { when: "Book Now tapped",        api: "POST /api/app/customer/book-ride",        note: "Auto-assigns nearest driver" },
  { when: "Waiting / In-ride",      api: "GET /api/app/customer/active-trip",       note: "Poll every 5s — driver location + status" },
  { when: "Driver arrived",         api: "active-trip returns pickupOtpVisible",    note: "Show OTP to customer — tell driver" },
  { when: "Ride completed",         api: "active-trip status = 'completed'",        note: "Show fare summary + rating screen" },
  { when: "Rate driver",            api: "POST /api/app/customer/rate-driver",      note: "1–5 stars + review" },
  { when: "Need to cancel",         api: "POST /api/app/customer/cancel-trip",      note: "Only before on_the_way" },
  { when: "History screen",         api: "GET /api/app/customer/trips",             note: "Paginated trip history" },
  { when: "FCM token refresh",      api: "POST /api/app/fcm-token",                 note: "Register push notification token" },
  { when: "Emergency",              api: "POST /api/app/sos",                       note: "Send SOS alert" },
];

const FLUTTER_FILES = [
  {
    app: "Driver App",
    icon: "bi-car-front-fill",
    color: "#16a34a",
    bg: "#f0fdf4",
    files: [
      { name: "api_service.dart",          path: "/flutter/driver_app/api_service.dart",          desc: "All API calls (OTP, location, trip management, wallet)" },
      { name: "models.dart",               path: "/flutter/driver_app/models.dart",               desc: "DriverProfile, IncomingTrip, TripDetail, WalletInfo models" },
      { name: "notification_service.dart", path: "/flutter/driver_app/notification_service.dart", desc: "🔔 FCM push notifications + sound alerts setup" },
    ],
  },
  {
    app: "Customer App",
    icon: "bi-person-fill",
    color: "#7c3aed",
    bg: "#f5f3ff",
    files: [
      { name: "api_service.dart", path: "/flutter/customer_app/api_service.dart", desc: "All API calls (OTP, booking, tracking, rating)" },
      { name: "models.dart",      path: "/flutter/customer_app/models.dart",       desc: "CustomerProfile, FareOption, ActiveTrip, AppConfigs models" },
    ],
  },
];

export default function ApiDocsPage() {
  const [activeApp, setActiveApp] = useState<"all" | "driver" | "customer" | "shared">("all");
  const [showFlow, setShowFlow] = useState(true);
  const [showDriverTable, setShowDriverTable] = useState(true);
  const [showCustomerTable, setShowCustomerTable] = useState(true);

  const filtered = API_SECTIONS.filter(s => activeApp === "all" || s.app === "both" || s.app === activeApp || s.app === "shared");

  return (
    <div className="container-fluid">
      <div className="d-flex align-items-start justify-content-between mb-4">
        <div>
          <h4 className="fw-bold mb-0" data-testid="page-title">
            <i className="bi bi-code-square me-2 text-primary"></i>Flutter App API Reference
          </h4>
          <div className="text-muted small">Driver App + Customer App — అన్ని APIs, Flutter Dart files</div>
        </div>
        <div className="d-flex gap-2">
          <code className="badge rounded-pill bg-dark px-3 py-2" style={{ fontSize: 11 }}>{BASE_URL}</code>
        </div>
      </div>

      {/* Flutter Download Files */}
      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 14, border: "1.5px solid #e0f2fe" }}>
        <div className="card-header py-3 px-4 d-flex align-items-center gap-2"
          style={{ background: "linear-gradient(135deg, #1a73e8 0%, #0d47a1 100%)", borderRadius: "14px 14px 0 0", border: "none" }}>
          <i className="bi bi-download text-white"></i>
          <span className="fw-semibold text-white" style={{ fontSize: 14 }}>Flutter Dart Files — Download చేసి Flutter project లో వాడండి</span>
        </div>
        <div className="card-body p-4">
          <div className="row g-3">
            {FLUTTER_FILES.map((app, ai) => (
              <div key={ai} className="col-md-6">
                <div className="p-3 rounded-3 h-100" style={{ background: app.bg, border: `1.5px solid ${app.color}22` }}>
                  <div className="fw-bold mb-3 d-flex align-items-center gap-2" style={{ color: app.color, fontSize: 13 }}>
                    <i className={`bi ${app.icon}`}></i>{app.app}
                  </div>
                  <div className="d-flex flex-column gap-2">
                    {app.files.map((f, fi) => (
                      <div key={fi} className="d-flex align-items-center gap-2 p-2 bg-white rounded-2"
                        style={{ border: "1px solid #f1f5f9" }}>
                        <div className="flex-1">
                          <div className="fw-semibold" style={{ fontSize: 12, color: "#1e293b" }}>
                            <i className="bi bi-file-earmark-code me-1" style={{ color: app.color }}></i>
                            {f.name}
                          </div>
                          <div style={{ fontSize: 11, color: "#64748b" }}>{f.desc}</div>
                        </div>
                        <a href={f.path} download className="btn btn-sm"
                          style={{ background: app.color, color: "white", fontSize: 11, borderRadius: 8, padding: "4px 10px", textDecoration: "none" }}
                          data-testid={`download-${f.name}`}>
                          <i className="bi bi-download me-1"></i>Download
                        </a>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 p-2 rounded-2" style={{ background: "white", border: "1px dashed #cbd5e1", fontSize: 11, color: "#64748b" }}>
                    <strong>pubspec.yaml లో add చేయండి:</strong>
                    <pre style={{ margin: 0, fontSize: 10, color: "#334155" }}>{`dependencies:\n  http: ^1.2.0\n  shared_preferences: ^2.2.3`}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Firebase / FCM Setup Banner */}
      <div className="card border-0 mb-4" style={{ borderRadius: 14, background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)" }}>
        <div className="card-body p-4">
          <div className="row align-items-center g-4">
            <div className="col-md-7">
              <div className="fw-bold text-white mb-1" style={{ fontSize: 15 }}>
                <i className="bi bi-bell-fill me-2" style={{ color: "#f59e0b" }}></i>
                🔔 Driver Sound Alert — Firebase Setup అవసరం
              </div>
              <div style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.7 }}>
                Customer ride book చేసినప్పుడు Driver phone లో <strong style={{ color: "#fbbf24" }}>loud sound alert</strong> వస్తుంది.<br />
                దానికి <strong style={{ color: "#86efac" }}>Firebase Console</strong> లో project create చేసి Service Account key ఇవ్వాలి.
              </div>
              <div className="mt-3 d-flex flex-column gap-1">
                {[
                  "1. console.firebase.google.com → New Project",
                  "2. Project Settings → Service Accounts → Generate Private Key",
                  "3. Download చేసిన JSON ని Admin Panel → Settings లో paste చేయండి",
                  "4. Flutter app లో google-services.json add చేయండి",
                ].map((step, i) => (
                  <div key={i} style={{ fontSize: 11.5, color: "#e2e8f0" }}>
                    <i className="bi bi-check-circle-fill me-2" style={{ color: "#86efac" }}></i>{step}
                  </div>
                ))}
              </div>
            </div>
            <div className="col-md-5">
              <div className="p-3 rounded-3" style={{ background: "#0f172a" }}>
                <div className="fw-semibold mb-2" style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase" }}>
                  Server Environment Variable
                </div>
                <code style={{ fontSize: 11, color: "#86efac" }}>FIREBASE_SERVICE_ACCOUNT_KEY={"{"}"type": "service_account", "project_id": "...", ...{"}"}</code>
                <hr style={{ borderColor: "#1e293b", margin: "12px 0" }} />
                <div className="fw-semibold mb-2" style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase" }}>
                  Notifications Triggered
                </div>
                {[
                  { icon: "bi-car-front-fill", color: "#f59e0b", text: "Customer books → Driver ki sound alert" },
                  { icon: "bi-check-circle", color: "#86efac", text: "Driver accepts → Customer ki notification" },
                  { icon: "bi-geo-alt-fill", color: "#60a5fa", text: "Driver arrived → Customer ki OTP + alert" },
                  { icon: "bi-flag-fill", color: "#a78bfa", text: "Trip complete → Customer ki fare summary" },
                  { icon: "bi-x-circle", color: "#f87171", text: "Trip cancel → Opposite party ki alert" },
                ].map((n, i) => (
                  <div key={i} className="d-flex align-items-center gap-2 mb-1">
                    <i className={`bi ${n.icon}`} style={{ color: n.color, fontSize: 11 }}></i>
                    <span style={{ fontSize: 11, color: "#e2e8f0" }}>{n.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Driver App API Decision Table */}
      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4 d-flex align-items-center justify-content-between"
          style={{ borderBottom: "1px solid #f1f5f9" }}>
          <span className="fw-semibold d-flex align-items-center gap-2" style={{ fontSize: 14, color: "#16a34a" }}>
            <i className="bi bi-car-front-fill"></i>Driver App — ఏ screen లో ఏ API call చేయాలి
          </span>
          <button className="btn btn-sm btn-outline-secondary" style={{ fontSize: 11 }}
            onClick={() => setShowDriverTable(!showDriverTable)}>
            {showDriverTable ? "Hide" : "Show"}
          </button>
        </div>
        {showDriverTable && (
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead style={{ background: "#f8fafc" }}>
                  <tr>
                    <th style={{ fontSize: 11, padding: "10px 16px", width: "25%", color: "#64748b", fontWeight: 600 }}>SCREEN / EVENT</th>
                    <th style={{ fontSize: 11, padding: "10px 16px", width: "40%", color: "#64748b", fontWeight: 600 }}>API CALL</th>
                    <th style={{ fontSize: 11, padding: "10px 16px", color: "#64748b", fontWeight: 600 }}>NOTE</th>
                  </tr>
                </thead>
                <tbody>
                  {DRIVER_API_SUMMARY.map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f8fafc" }}>
                      <td style={{ fontSize: 11.5, padding: "8px 16px", color: "#1e293b", fontWeight: 500 }}>{row.when}</td>
                      <td style={{ padding: "8px 16px" }}>
                        <code style={{ fontSize: 10.5, color: "#1a73e8", background: "#f1f5f9", padding: "2px 6px", borderRadius: 4 }}>{row.api}</code>
                      </td>
                      <td style={{ fontSize: 11, padding: "8px 16px", color: "#64748b" }}>{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Customer App API Decision Table */}
      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4 d-flex align-items-center justify-content-between"
          style={{ borderBottom: "1px solid #f1f5f9" }}>
          <span className="fw-semibold d-flex align-items-center gap-2" style={{ fontSize: 14, color: "#7c3aed" }}>
            <i className="bi bi-person-fill"></i>Customer App — ఏ screen లో ఏ API call చేయాలి
          </span>
          <button className="btn btn-sm btn-outline-secondary" style={{ fontSize: 11 }}
            onClick={() => setShowCustomerTable(!showCustomerTable)}>
            {showCustomerTable ? "Hide" : "Show"}
          </button>
        </div>
        {showCustomerTable && (
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-sm mb-0">
                <thead style={{ background: "#f8fafc" }}>
                  <tr>
                    <th style={{ fontSize: 11, padding: "10px 16px", width: "25%", color: "#64748b", fontWeight: 600 }}>SCREEN / EVENT</th>
                    <th style={{ fontSize: 11, padding: "10px 16px", width: "40%", color: "#64748b", fontWeight: 600 }}>API CALL</th>
                    <th style={{ fontSize: 11, padding: "10px 16px", color: "#64748b", fontWeight: 600 }}>NOTE</th>
                  </tr>
                </thead>
                <tbody>
                  {CUSTOMER_API_SUMMARY.map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f8fafc" }}>
                      <td style={{ fontSize: 11.5, padding: "8px 16px", color: "#1e293b", fontWeight: 500 }}>{row.when}</td>
                      <td style={{ padding: "8px 16px" }}>
                        <code style={{ fontSize: 10.5, color: "#7c3aed", background: "#f5f3ff", padding: "2px 6px", borderRadius: 4 }}>{row.api}</code>
                      </td>
                      <td style={{ fontSize: 11, padding: "8px 16px", color: "#64748b" }}>{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Quick info */}
      <div className="row g-3 mb-4">
        {[
          { label: "Base URL", val: BASE_URL, icon: "bi-globe", color: "#1a73e8", bg: "#e8f0fe" },
          { label: "Auth Method", val: "JWT access + refresh rotation", icon: "bi-shield-lock-fill", color: "#16a34a", bg: "#f0fdf4" },
          { label: "Token Format", val: "Signed JWT + opaque refresh", icon: "bi-key-fill", color: "#d97706", bg: "#fefce8" },
          { label: "Content-Type", val: "application/json", icon: "bi-braces", color: "#7c3aed", bg: "#f5f3ff" },
        ].map((s, i) => (
          <div key={i} className="col-6 col-md-3">
            <div className="card border-0 shadow-sm" style={{ borderRadius: 12 }}>
              <div className="card-body py-3">
                <div className="d-flex align-items-center gap-2 mb-1">
                  <div className="rounded-2 d-flex align-items-center justify-content-center"
                    style={{ width: 28, height: 28, background: s.bg, color: s.color, fontSize: 13 }}>
                    <i className={`bi ${s.icon}`}></i>
                  </div>
                  <span className="fw-semibold" style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase" }}>{s.label}</span>
                </div>
                <code style={{ fontSize: 11.5, color: s.color }}>{s.val}</code>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* App flow diagrams */}
      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4 d-flex align-items-center justify-content-between"
          style={{ borderBottom: "1px solid #f1f5f9" }}>
          <span className="fw-semibold" style={{ fontSize: 14 }}><i className="bi bi-diagram-3-fill me-2 text-primary"></i>App Flow Diagrams</span>
          <button className="btn btn-sm btn-outline-secondary" onClick={() => setShowFlow(!showFlow)} style={{ fontSize: 11 }}>
            {showFlow ? "Hide" : "Show"} Flows
          </button>
        </div>
        {showFlow && (
          <div className="card-body p-4">
            <div className="row g-4">
              {FLOW_STEPS.map((flow, fi) => (
                <div key={fi} className="col-md-6">
                  <div className="p-3 rounded-3 h-100" style={{ border: `1.5px solid ${flow.color}22`, background: `${flow.color}05` }}>
                    <div className="fw-bold mb-3 d-flex align-items-center gap-2" style={{ color: flow.color, fontSize: 14 }}>
                      <i className={`bi ${flow.icon}`}></i>{flow.title}
                    </div>
                    <div className="d-flex flex-column gap-1">
                      {flow.steps.map((step, si) => (
                        <div key={si} className="d-flex align-items-start gap-2">
                          <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                            style={{ width: 20, height: 20, background: flow.color, color: "white", fontSize: 9, fontWeight: 700, marginTop: 1 }}>
                            {step.n}
                          </div>
                          <div>
                            <div className="fw-semibold" style={{ fontSize: 12 }}>{step.label}</div>
                            <code style={{ fontSize: 10, color: "#1a73e8" }}>{step.api}</code>
                            <div style={{ fontSize: 10.5, color: "#64748b" }}>{step.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Filter */}
      <div className="d-flex gap-2 mb-3 flex-wrap">
        {[
          { key: "all", label: "All APIs", color: "#1e293b" },
          { key: "driver", label: "Driver App Only", color: "#16a34a" },
          { key: "customer", label: "Customer App Only", color: "#7c3aed" },
          { key: "shared", label: "Shared APIs", color: "#d97706" },
        ].map(f => (
          <button key={f.key}
            className={`btn btn-sm rounded-pill ${activeApp === f.key ? "text-white" : "btn-outline-secondary"}`}
            style={{ fontSize: 11, background: activeApp === f.key ? f.color : undefined, border: `1px solid ${activeApp === f.key ? f.color : "#e2e8f0"}` }}
            onClick={() => setActiveApp(f.key as any)}
            data-testid={`filter-api-${f.key}`}>
            {f.label}
          </button>
        ))}
        <div className="ms-auto d-flex align-items-center gap-2">
          {[
            { m: "GET", c: "#16a34a" },
            { m: "POST", c: "#1a73e8" },
            { m: "PATCH", c: "#d97706" },
          ].map(m => (
            <span key={m.m} className="badge" style={{ background: m.c, fontSize: 10 }}>{m.m}</span>
          ))}
          <span style={{ fontSize: 11, color: "#64748b" }}>= HTTP methods</span>
        </div>
      </div>

      {/* API Sections */}
      {filtered.map((section, si) => (
        <div key={si} className="card border-0 shadow-sm mb-4" style={{ borderRadius: 14 }}>
          <div className="card-header bg-white py-3 px-4 d-flex align-items-center gap-3"
            style={{ borderBottom: "1px solid #f1f5f9" }}>
            <div className="rounded-3 d-flex align-items-center justify-content-center"
              style={{ width: 36, height: 36, background: section.bg, color: section.color, fontSize: 15 }}>
              <i className={`bi ${section.icon}`}></i>
            </div>
            <span className="fw-semibold" style={{ fontSize: 14, color: section.color }}>{section.title}</span>
            <span className="badge rounded-pill bg-light text-dark ms-auto" style={{ fontSize: 10 }}>
              {section.endpoints.length} endpoints
            </span>
          </div>
          <div className="card-body p-4">
            {section.endpoints.map((ep, ei) => (
              <EndpointCard key={ei} ep={ep} />
            ))}
          </div>
        </div>
      ))}

      {/* Trip Status Reference */}
      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 14 }}>
        <div className="card-header bg-white py-3 px-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <span className="fw-semibold" style={{ fontSize: 14 }}><i className="bi bi-diagram-2-fill me-2" style={{ color: "#1a73e8" }}></i>Trip Status Reference</span>
        </div>
        <div className="card-body p-4">
          <div className="row g-2">
            {[
              { status: "searching", color: "#f59e0b", appLabel: "Waiting for Driver", label: "No driver found yet - keep polling", next: "driver_assigned" },
              { status: "driver_assigned", color: "#1a73e8", appLabel: "Ride Booked", label: "Booking created - driver assignment in progress", next: "accepted" },
              { status: "accepted", color: "#7c3aed", appLabel: "Ride Resumed", label: "Driver accepted - navigating to pickup", next: "arrived" },
              { status: "arrived", color: "#d97706", appLabel: "Driver at Pickup", label: "OTP visible to customer before trip starts", next: "on_the_way" },
              { status: "on_the_way", color: "#0891b2", appLabel: "Ride in Progress", label: "Ride started - navigate to destination", next: "completed" },
              { status: "completed", color: "#16a34a", appLabel: "Ride Completed", label: "Trip done - show fare summary + rating screen", next: null },
              { status: "cancelled", color: "#dc2626", appLabel: "Ride Cancelled", label: "Trip cancelled by driver or customer", next: null },
            ].map((s, i) => (
              <div key={i} className="col-md-6">
                <div className="d-flex align-items-center gap-3 p-2 rounded-3" style={{ background: "#f8fafc" }}>
                  <span className="badge" style={{ background: s.color, fontSize: 10, minWidth: 100, textAlign: "center" }}>{s.status}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>{s.appLabel}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{s.label}</div>
                  </div>
                  {s.next && <span style={{ fontSize: 10, color: "#94a3b8" }}>&rarr; {s.next}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
