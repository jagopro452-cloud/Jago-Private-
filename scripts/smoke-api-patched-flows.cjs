const BASE_URL = (process.env.HEALTH_BASE_URL || process.env.APP_BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");

async function getJson(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

function assert(condition, message, extra) {
  if (!condition) {
    console.error(`[smoke-core] FAIL: ${message}`);
    if (extra) console.error(extra);
    process.exit(1);
  }
}

(async () => {
  const health = await getJson("/api/health");
  assert(health.ok, "/api/health should succeed", health);
  assert(health.body?.status === "ok", "health status should be ok", health.body);

  const env = await getJson("/api/health/env");
  assert(env.ok, "/api/health/env should succeed", env);
  assert(env.body?.status === "ok", "env status should be ok", env.body);
  assert(!!env.body?.env?.DATABASE_URL, "DATABASE_URL should be configured", env.body);

  const maps = await getJson("/api/health/maps");
  assert(maps.ok, "/api/health/maps should succeed", maps);

  console.log("[smoke-core] PASS");
  console.log(JSON.stringify({
    baseUrl: BASE_URL,
    health: health.body,
    maps: maps.body,
  }, null, 2));
})().catch((error) => {
  console.error("[smoke-core] FAIL:", error?.message || String(error));
  process.exit(1);
});
