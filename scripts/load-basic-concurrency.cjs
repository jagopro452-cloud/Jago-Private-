#!/usr/bin/env node
const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });
dotenv.config({ path: path.resolve(process.cwd(), ".env.playwright.local"), override: true });
dotenv.config({ path: path.resolve(process.cwd(), ".env.staging"), override: true });
dotenv.config({ path: path.resolve(process.cwd(), ".env.live"), override: true });

const BASE_URL = (process.env.LOAD_BASE_URL || process.env.PW_API_BASE_URL || process.env.APP_BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const OPS_API_KEY = process.env.LOAD_OPS_API_KEY || process.env.PW_OPS_API_KEY || process.env.OPS_API_KEY || process.env.ADMIN_RESET_KEY || "";
const SEED_KEY = OPS_API_KEY;
const SEED_PASSWORD = process.env.PW_LIVE_MOBILE_PASSWORD || process.env.SEED_TEST_ACCOUNT_PASSWORD || "";
const LEVELS = String(process.env.LOAD_LEVELS || "100,500,1000")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);

async function getJson(pathname, options = {}) {
  const res = await fetch(`${BASE_URL}${pathname}`, options);
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[idx];
}

async function seedAndLoginCustomer() {
  if (!SEED_KEY || !SEED_PASSWORD) return null;
  const seeded = await getJson(`/api/ops/seed-test-accounts?key=${encodeURIComponent(SEED_KEY)}`, {
    headers: { "x-ops-key": SEED_KEY },
  });
  if (!seeded.ok) return null;

  const customer = seeded.body?.customers?.[0];
  if (!customer?.phone) return null;

  const login = await getJson("/api/app/login-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      phone: customer.phone,
      password: SEED_PASSWORD,
      userType: "customer",
    }),
  });

  if (!login.ok || !login.body?.token) return null;
  return login.body.token;
}

async function collectOpsMetrics() {
  if (!OPS_API_KEY) return null;
  const [metrics, dbValidation] = await Promise.all([
    getJson("/api/ops/metrics", { headers: { "x-ops-key": OPS_API_KEY } }),
    getJson("/api/ops/db-validation", { headers: { "x-ops-key": OPS_API_KEY } }),
  ]);
  return {
    metrics: metrics.ok ? metrics.body : null,
    dbValidation: dbValidation.ok ? dbValidation.body : null,
  };
}

async function runScenario(name, concurrency, requestFactory) {
  const durations = [];
  let errors = 0;

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      const started = Date.now();
      try {
        const result = await requestFactory();
        if (!result.ok) errors += 1;
      } catch {
        errors += 1;
      } finally {
        durations.push(Date.now() - started);
      }
    }),
  );

  durations.sort((a, b) => a - b);
  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    name,
    concurrency,
    totalRequests: durations.length,
    errorCount: errors,
    errorRate: durations.length ? Number(((errors / durations.length) * 100).toFixed(2)) : 0,
    avgMs: durations.length ? Number((total / durations.length).toFixed(2)) : 0,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    maxMs: durations[durations.length - 1] || 0,
  };
}

async function main() {
  const before = await collectOpsMetrics();
  const customerToken = await seedAndLoginCustomer();

  const results = [];
  for (const concurrency of LEVELS) {
    results.push(
      await runScenario("health", concurrency, () => getJson("/api/health")),
    );
    results.push(
      await runScenario("env", concurrency, () => getJson("/api/health/env")),
    );
    if (customerToken) {
      results.push(
        await runScenario("customer-wallet", concurrency, () =>
          getJson("/api/app/customer/wallet", {
            headers: { Authorization: `Bearer ${customerToken}` },
          }),
        ),
      );
    }
  }
  const after = await collectOpsMetrics();

  console.log(JSON.stringify({
    baseUrl: BASE_URL,
    usedSeedBootstrap: Boolean(customerToken),
    levels: LEVELS,
    before,
    results,
    after,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    error: error?.message || String(error),
    baseUrl: BASE_URL,
  }, null, 2));
  process.exit(1);
});
