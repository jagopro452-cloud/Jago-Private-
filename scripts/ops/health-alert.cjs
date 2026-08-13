const BASE_URL = process.env.HEALTH_BASE_URL || "http://127.0.0.1:5000";
const OPS_API_KEY = process.env.OPS_API_KEY || "";
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL || "";

async function sendAlert(text) {
  if (!ALERT_WEBHOOK_URL) {
    console.error("[alert] ALERT_WEBHOOK_URL not configured");
    return;
  }
  await fetch(ALERT_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ts: new Date().toISOString() }),
  });
}

async function check(path, headers = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { headers });
  const body = await res.text();
  let json = {};
  try { json = body ? JSON.parse(body) : {}; } catch { json = { raw: body }; }
  return { status: res.status, body: json };
}

(async () => {
  try {
    const health = await check("/api/health");
    const ready = await check("/api/ops/ready", { "x-ops-key": OPS_API_KEY });

    if (health.status !== 200 || ready.status !== 200) {
      const msg = `[JAGO][ALERT] health=${health.status} ready=${ready.status}`;
      console.error(msg, { health: health.body, ready: ready.body });
      await sendAlert(msg);
      process.exit(1);
    }

    console.log("[monitor] healthy", { health: health.body, ready: ready.body });
  } catch (e) {
    const msg = `[JAGO][ALERT] monitoring script failure: ${e?.message || e}`;
    console.error(msg);
    try { await sendAlert(msg); } catch {}
    process.exit(1);
  }
})();
