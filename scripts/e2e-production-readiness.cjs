const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });
dotenv.config({ path: path.resolve(process.cwd(), ".env.playwright.local"), override: true });
dotenv.config({ path: path.resolve(process.cwd(), ".env.staging"), override: true });
dotenv.config({ path: path.resolve(process.cwd(), ".env.live"), override: true });

const BASE_URL = (process.env.HEALTH_BASE_URL || process.env.APP_BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const OPS_API_KEY = process.env.PW_OPS_API_KEY || process.env.OPS_API_KEY || process.env.ADMIN_RESET_KEY || "";

async function getJson(path, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

function fail(message, extra) {
  console.error(`[prod-smoke] FAIL: ${message}`);
  if (extra) console.error(extra);
  process.exit(1);
}

(async () => {
  const health = await getJson("/api/health");
  if (!health.ok) fail("/api/health failed", health);

  const env = await getJson("/api/health/env");
  if (!env.ok) fail("/api/health/env failed", env);

  if (!OPS_API_KEY) fail("OPS_API_KEY is required for /api/ops/ready");
  const ready = await getJson("/api/ops/ready", { "x-ops-key": OPS_API_KEY });
  if (!ready.ok) fail("/api/ops/ready failed", ready);

  const flags = env.body?.env || {};
  const critical = [
    "DATABASE_URL",
    "ADMIN_PASSWORD",
  ];
  const important = [
    "GOOGLE_MAPS_API_KEY_resolved",
    "FIREBASE_SERVICE_ACCOUNT_KEY",
    "FIREBASE_WEB_API_KEY",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "REDIS_URL",
    "OPS_API_KEY",
    "ALERT_WEBHOOK_URL",
    "APP_BASE_URL",
    "AI_ASSISTANT_SERVICE_URL",
    "ADMIN_RESET_KEY",
  ];

  const missingCritical = critical.filter((key) => !flags[key]);
  if (missingCritical.length) {
    fail(`Critical env flags missing: ${missingCritical.join(", ")}`, env.body);
  }

  const missingImportant = important.filter((key) => !flags[key]);

  console.log("[prod-smoke] PASS");
  console.log(JSON.stringify({
    baseUrl: BASE_URL,
    health: health.body,
    ready: ready.body,
    missingImportant,
  }, null, 2));

  if (missingImportant.length) {
    process.exitCode = 2;
  }
})().catch((error) => {
  fail(error?.message || String(error));
});
