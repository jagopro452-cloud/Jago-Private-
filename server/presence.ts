/**
 * Redis connectivity check used by health/readiness endpoints and alerting.
 *
 * This module previously also exposed a Redis-backed driver geo-cache
 * (setDriverPresence/getNearbyDriverIds/etc.) intended as a fast path for
 * nearby-driver lookups. It was never wired into dispatch — every dispatch
 * path queries PostgreSQL directly instead — so those functions had zero
 * callers and were removed. checkRedis() remains; it is used by
 * server/index.ts and server/alert-engine.ts.
 */

import IORedis from "ioredis";

let redis: IORedis | null = null;
let redisConnectPromise: Promise<IORedis | null> | null = null;
let lastReconnectAttempt = 0;
const RECONNECT_COOLDOWN_MS = 5000;

function getRedis(): IORedis | null {
  if (redis) return redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  // Cooldown: without this, every caller during a sustained outage would open
  // a fresh TCP connection attempt — a thundering herd against Redis.
  if (Date.now() - lastReconnectAttempt < RECONNECT_COOLDOWN_MS) return null;
  lastReconnectAttempt = Date.now();
  try {
    redis = new IORedis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    // retryStrategy disables ioredis's own auto-reconnect, so on any drop we drop
    // our reference too — the next getRedis() call creates a fresh client instead
    // of silently reusing a dead one forever.
    redis.on("error", () => { redis = null; });
    redis.on("end", () => { redis = null; });
    return redis;
  } catch {
    return null;
  }
}

async function connectRedis(): Promise<IORedis | null> {
  const r = getRedis();
  if (!r) return null;
  if (r.status === "ready") return r;
  if (redisConnectPromise) return redisConnectPromise;

  redisConnectPromise = (async () => {
    try {
      if (r.status === "wait") {
        await r.connect();
      }
      await r.ping();
      return r;
    } catch {
      return null;
    } finally {
      redisConnectPromise = null;
    }
  })();

  return redisConnectPromise;
}

export async function checkRedis(): Promise<{ status: "ok" | "down" | "not_configured"; error?: string | null }> {
  const r = await connectRedis();
  if (!r) {
    return {
      status: process.env.REDIS_URL ? "down" : "not_configured",
      error: process.env.REDIS_URL ? "ping_failed" : "REDIS_URL not configured",
    };
  }

  try {
    await r.ping();
    return { status: "ok" };
  } catch (error: any) {
    return { status: "down", error: error?.message || "ping_failed" };
  }
}
