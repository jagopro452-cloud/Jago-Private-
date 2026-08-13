/**
 * JAGO Platform — k6 Load Test
 *
 * Install k6: https://k6.io/docs/getting-started/installation/
 *
 * Run:
 *   k6 run --vus 100 --duration 60s tests/load/k6_load_test.js
 *
 * Stages test:
 *   k6 run tests/load/k6_load_test.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// ── Configuration ────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || "https://jagopro.org";

// Custom metrics
const errorRate = new Rate("error_rate");
const loginDuration = new Trend("login_duration");
const bookRideDuration = new Trend("book_ride_duration");
const nearbyDriversDuration = new Trend("nearby_drivers_duration");

// ── Load stages ──────────────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: "20s", target: 20 },   // ramp to 20 users
    { duration: "30s", target: 50 },   // ramp to 50 users
    { duration: "30s", target: 100 },  // ramp to 100 users
    { duration: "60s", target: 100 },  // hold 100 users
    { duration: "20s", target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<3000"],  // 95% under 3s (Cloudflare adds ~100ms)
    // NOTE: http_req_failed counts 4xx as failed — disable this threshold
    // because Cloudflare returns 403 for bot challenge and auth returns 401 for test tokens
    // Use our custom error_rate instead (only counts 5xx)
    error_rate: ["rate<0.10"],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": "k6-load-test/1.0",
  Accept: "application/json",
};

function authHeaders(token) {
  return { ...HEADERS, Authorization: `Bearer ${token}` };
}

// ── Test Scenarios ───────────────────────────────────────────────────────────

/**
 * SCENARIO 1: Health check — must always be < 200ms
 */
export function healthCheck() {
  const res = http.get(`${BASE_URL}/api/health`);
  check(res, {
    "health: status 200": (r) => r.status === 200,
    "health: response < 200ms": (r) => r.timings.duration < 200,
  });
  errorRate.add(res.status !== 200);
}

/**
 * SCENARIO 2: Customer login via OTP (simulate verifyFirebaseToken)
 * Uses a test token — this will fail auth but tests endpoint availability
 */
export function customerLogin() {
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/app/verify-firebase-token`,
    JSON.stringify({
      firebaseIdToken: "test-token-load-test",
      phone: `9${Math.floor(100000000 + Math.random() * 900000000)}`,
      userType: "customer",
    }),
    { headers: HEADERS }
  );
  loginDuration.add(Date.now() - start);
  // Expect 401/400 (bad token) — NOT 500 (server crash)
  check(res, {
    "login: server responded": (r) => r.status !== 0,
    "login: no 500 error": (r) => r.status < 500,
    "login: response < 3s": (r) => r.timings.duration < 3000,
  });
  errorRate.add(res.status >= 500);
}

/**
 * SCENARIO 3: Nearby drivers query — high frequency in production
 */
export function nearbyDrivers() {
  const start = Date.now();
  // Hyderabad coordinates with small random offset
  const lat = 17.385 + (Math.random() - 0.5) * 0.1;
  const lng = 78.4867 + (Math.random() - 0.5) * 0.1;
  const res = http.get(
    `${BASE_URL}/api/app/nearby-drivers?lat=${lat}&lng=${lng}&radius=5`,
    { headers: HEADERS }
  );
  nearbyDriversDuration.add(Date.now() - start);
  check(res, {
    "nearby: status not 500": (r) => r.status < 500,
    "nearby: response < 2s": (r) => r.timings.duration < 2000,
  });
  errorRate.add(res.status >= 500);
}

/**
 * SCENARIO 4: Rate limit check — login endpoint should rate-limit after 5 attempts
 */
export function rateLimitCheck() {
  let blocked = false;
  for (let i = 0; i < 7; i++) {
    const res = http.post(
      `${BASE_URL}/api/app/login-password`,
      JSON.stringify({ phone: "9999999999", password: "wrongpassword", userType: "customer" }),
      { headers: HEADERS }
    );
    if (res.status === 429) {
      blocked = true;
      break;
    }
  }
  check({ blocked }, {
    "rate limit: triggered after excess attempts": (d) => d.blocked === true,
  });
}

// ── Default scenario (runs all) ───────────────────────────────────────────────
export default function () {
  const scenario = Math.random();

  if (scenario < 0.3) {
    healthCheck();
  } else if (scenario < 0.6) {
    nearbyDrivers();
  } else if (scenario < 0.9) {
    customerLogin();
  } else {
    rateLimitCheck();
  }

  sleep(1);
}
