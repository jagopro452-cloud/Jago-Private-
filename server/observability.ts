import crypto from "crypto";
import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";

function redactSecrets(input: string): string {
  return input
    .replace(/(password|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]");
}

export function makeErrorId(): string {
  return crypto.randomBytes(8).toString("hex");
}

const ALERT_DEDUP_WINDOW_MS = 60_000;
const recentAlertKeys = new Map<string, number>();

function isDuplicateAlert(key: string): boolean {
  const now = Date.now();
  recentAlertKeys.forEach((ts, k) => {
    if (now - ts > ALERT_DEDUP_WINDOW_MS) recentAlertKeys.delete(k);
  });
  const prev = recentAlertKeys.get(key);
  if (prev && now - prev < ALERT_DEDUP_WINDOW_MS) return true;
  recentAlertKeys.set(key, now);
  return false;
}

async function persistInternalAlert(event: {
  level: "error" | "critical";
  source: string;
  message: string;
  details?: string;
  priority?: 0 | 1 | 2 | 3;
  externalConfigured: boolean;
  externalDelivered: boolean;
  externalChannelCount: number;
  deliveryError?: string;
}) {
  const dedupKey = [
    event.level,
    event.source,
    event.message,
    event.priority ?? "na",
  ].join("|");

  if (isDuplicateAlert(dedupKey)) return;

  const tag = event.level === "critical" ? "ALERT_CRITICAL" : "ALERT_WARNING";
  const details = {
    source: event.source,
    priority: event.priority,
    externalConfigured: event.externalConfigured,
    externalDelivered: event.externalDelivered,
    externalChannelCount: event.externalChannelCount,
    deliveryError: event.deliveryError || null,
    details: event.details ? redactSecrets(event.details).slice(0, 1800) : null,
  };

  await rawDb.execute(rawSql`
    INSERT INTO system_logs (level, tag, message, data, details)
    VALUES (${event.level === "critical" ? "CRITICAL" : "ERROR"}, ${tag}, ${event.message}, ${JSON.stringify(details)}::jsonb, ${JSON.stringify(details)}::jsonb)
  `).catch(() => {});
}

async function postWebhook(url: string, payload: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

export async function sendAlert(event: {
  level: "error" | "critical";
  source: string;
  message: string;
  details?: string;
}) {
  const webhook = process.env.ALERT_WEBHOOK_URL;
  const payload = {
    text: `[${event.level.toUpperCase()}] ${event.source}: ${event.message}`,
    source: event.source,
    message: event.message,
    details: event.details ? redactSecrets(event.details).slice(0, 1800) : undefined,
    ts: new Date().toISOString(),
  };

  let externalDelivered = false;
  let deliveryError = "";

  if (webhook) {
    try {
      externalDelivered = await postWebhook(webhook, payload);
      if (!externalDelivered) deliveryError = "non_2xx_response";
    } catch (err: any) {
      deliveryError = String(err?.message || err || "webhook_post_failed");
    }
  } else {
    deliveryError = "ALERT_WEBHOOK_URL_not_configured";
  }

  await persistInternalAlert({
    level: event.level,
    source: event.source,
    message: event.message,
    details: event.details,
    externalConfigured: !!webhook,
    externalDelivered,
    externalChannelCount: webhook ? 1 : 0,
    deliveryError,
  });
}

/**
 * Multi-channel alert routing based on priority.
 *
 * P0 -> PAGER_WEBHOOK_URL + WHATSAPP_WEBHOOK_URL + ALERT_WEBHOOK_URL (all channels)
 * P1 -> WHATSAPP_WEBHOOK_URL + ALERT_WEBHOOK_URL
 * P2/P3/default -> ALERT_WEBHOOK_URL only
 *
 * Any channel URL not set is silently skipped.
 * Falls back to ALERT_WEBHOOK_URL for all calls without a priority field.
 */
export async function sendOpsAlert(event: {
  level: "error" | "critical";
  source: string;
  message: string;
  priority?: 0 | 1 | 2 | 3;
  details?: string;
  dedupKey?: string;
}): Promise<void> {
  const payload = {
    text: `[P${event.priority ?? "?"}/${event.level.toUpperCase()}] ${event.source}: ${event.message}`,
    source: event.source,
    priority: event.priority,
    level: event.level,
    message: event.message,
    dedupKey: event.dedupKey,
    details: event.details ? redactSecrets(event.details).slice(0, 1800) : undefined,
    ts: new Date().toISOString(),
  };

  const channels: string[] = [];
  const p = event.priority ?? 99;

  if (p === 0) {
    if (process.env.PAGER_WEBHOOK_URL) channels.push(process.env.PAGER_WEBHOOK_URL);
    if (process.env.WHATSAPP_WEBHOOK_URL) channels.push(process.env.WHATSAPP_WEBHOOK_URL);
  } else if (p === 1) {
    if (process.env.WHATSAPP_WEBHOOK_URL) channels.push(process.env.WHATSAPP_WEBHOOK_URL);
  }
  if (process.env.ALERT_WEBHOOK_URL) channels.push(process.env.ALERT_WEBHOOK_URL);

  let externalDelivered = false;
  let deliveryError = "";

  if (channels.length > 0) {
    try {
      const results = await Promise.allSettled(channels.map((url) => postWebhook(url, payload)));
      externalDelivered = results.some((r) => r.status === "fulfilled" && r.value === true);
      if (!externalDelivered) deliveryError = "all_channels_failed";
    } catch (err: any) {
      deliveryError = String(err?.message || err || "ops_webhook_post_failed");
    }
  } else {
    deliveryError = "no_ops_webhook_configured";
  }

  await persistInternalAlert({
    level: event.level,
    source: event.source,
    message: event.message,
    details: event.details,
    priority: event.priority,
    externalConfigured: channels.length > 0,
    externalDelivered,
    externalChannelCount: channels.length,
    deliveryError,
  });
}
