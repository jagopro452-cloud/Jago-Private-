/**
 * Predictive Dispatch AI
 *
 * Learns driver acceptance patterns per zone+hour+day to:
 * - Re-rank driver candidates by predicted acceptance probability
 * - Adapt dispatch scoring weights when platform acceptance rate drops
 * - Nudge idle drivers toward high-demand zones after trip completion
 * - Forecast zone demand from historical offer events
 */

import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { type DriverMatchScore } from "./ai";

// ─── Schema ───────────────────────────────────────────────────────────────────

export async function initPredictiveDispatchSchema(): Promise<void> {
  // call_logs: unified schema for in-app call audit trail (used by socket.ts + admin routes)
  await rawDb.execute(rawSql`
    CREATE TABLE IF NOT EXISTS call_logs (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      trip_id          UUID,
      caller_id        UUID        NOT NULL,
      caller_name      TEXT,
      caller_phone     TEXT,
      caller_type      TEXT,
      receiver_id      UUID,
      callee_id        UUID,
      callee_name      TEXT,
      callee_phone     TEXT,
      callee_type      TEXT,
      call_type        TEXT        DEFAULT 'ride',
      status           TEXT        NOT NULL DEFAULT 'initiated',
      initiated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at         TIMESTAMPTZ,
      duration_sec     INT,
      duration_seconds INT
    )
  `);
  await rawDb.execute(rawSql`
    CREATE INDEX IF NOT EXISTS idx_call_logs_trip ON call_logs (trip_id)
  `);
  await rawDb.execute(rawSql`
    CREATE INDEX IF NOT EXISTS idx_call_logs_initiated ON call_logs (initiated_at)
  `);

  await rawDb.execute(rawSql`
    CREATE TABLE IF NOT EXISTS driver_offer_events (
      id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      driver_id         UUID        NOT NULL,
      trip_id           UUID        NOT NULL,
      zone_grid_key     TEXT        NOT NULL,
      hour_of_day       SMALLINT    NOT NULL,
      day_of_week       SMALLINT    NOT NULL,
      service_type      TEXT        NOT NULL,
      decision          TEXT,
      response_time_sec REAL,
      offered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at       TIMESTAMPTZ
    )
  `);
  await rawDb.execute(rawSql`
    CREATE INDEX IF NOT EXISTS idx_doe_driver_zone
      ON driver_offer_events (driver_id, zone_grid_key, hour_of_day, day_of_week)
  `);
  await rawDb.execute(rawSql`
    CREATE INDEX IF NOT EXISTS idx_doe_trip ON driver_offer_events (trip_id)
  `);
  await rawDb.execute(rawSql`
    CREATE INDEX IF NOT EXISTS idx_doe_zone_time
      ON driver_offer_events (zone_grid_key, hour_of_day, day_of_week)
  `);
  await rawDb.execute(rawSql`
    CREATE INDEX IF NOT EXISTS idx_doe_offered_at ON driver_offer_events (offered_at)
  `);
  // schema verified
}

// ─── Grid helpers ─────────────────────────────────────────────────────────────

// 0.1° grid ≈ 11 km cells
function toGridKey(lat: number, lng: number): string {
  const gLat = (Math.round(lat * 10) / 10).toFixed(1);
  const gLng = (Math.round(lng * 10) / 10).toFixed(1);
  return `${gLat}_${gLng}`;
}

// ─── Offer lifecycle ──────────────────────────────────────────────────────────

export async function logDriverOffer(
  driverId: string,
  tripId: string,
  pickupLat: number,
  pickupLng: number,
  serviceType: string,
): Promise<void> {
  try {
    const now = new Date();
    await rawDb.execute(rawSql`
      INSERT INTO driver_offer_events
        (driver_id, trip_id, zone_grid_key, hour_of_day, day_of_week, service_type)
      VALUES
        (${driverId}::uuid, ${tripId}::uuid,
         ${toGridKey(pickupLat, pickupLng)},
         ${now.getHours()}, ${now.getDay()},
         ${serviceType})
      ON CONFLICT DO NOTHING
    `);
  } catch (_) {}
}

export async function recordOfferOutcome(
  driverId: string,
  tripId: string,
  decision: 'accepted' | 'rejected' | 'timeout',
  responseTimeSec: number,
): Promise<void> {
  try {
    await rawDb.execute(rawSql`
      UPDATE driver_offer_events
      SET decision          = ${decision},
          response_time_sec = ${responseTimeSec},
          resolved_at       = NOW()
      WHERE driver_id = ${driverId}::uuid
        AND trip_id   = ${tripId}::uuid
        AND decision IS NULL
    `);
  } catch (_) {}
}

// ─── Platform-wide accept rate ────────────────────────────────────────────────

export async function getPlatformAcceptRate(): Promise<number> {
  try {
    const result = await rawDb.execute(rawSql`
      SELECT
        COUNT(*) FILTER (WHERE decision = 'accepted') AS accepted,
        COUNT(*) FILTER (WHERE decision IS NOT NULL)  AS total
      FROM driver_offer_events
      WHERE offered_at > NOW() - INTERVAL '30 minutes'
    `);
    const row = result.rows[0] as any;
    const total = Number(row?.total ?? 0);
    if (total < 3) return 70;
    return Math.round((Number(row.accepted) / total) * 100);
  } catch {
    return 70;
  }
}

// ─── Adaptive dispatch weights ────────────────────────────────────────────────

export interface DispatchWeights {
  distance: number;
  behavior: number;
  rating: number;
  responseSpeed: number;
  completionRate: number;
  acceptProbability: number;
}

export function getAdaptiveWeights(
  platformAcceptRatePct: number,
  surgeMultiplier = 1.0,
): DispatchWeights {
  // stressLevel: 0 = ideal (high accept, no surge) → 1 = critical
  const stressLevel = Math.min(1, Math.max(
    0,
    (100 - platformAcceptRatePct) / 100,
    (surgeMultiplier - 1) / 2,
  ));

  // Under stress: accept probability weight rises (0.10 → 0.25), distance drops
  const acceptProbW = 0.10 + stressLevel * 0.15;
  const distanceW   = Math.max(0.20, 0.35 - stressLevel * 0.10);
  const behaviorW   = Math.max(0.18, 0.25 - stressLevel * 0.03);
  const ratingW     = Math.max(0.15, 0.20 - stressLevel * 0.02);
  const respW       = 0.10;
  const complW      = Math.max(0.02, 1 - distanceW - behaviorW - ratingW - respW - acceptProbW);

  return { distance: distanceW, behavior: behaviorW, rating: ratingW, responseSpeed: respW, completionRate: complW, acceptProbability: acceptProbW };
}

// ─── Batched accept probability (replaces N×2 per-driver queries with 2) ──────

async function batchGetDriverZoneAcceptProbabilities(
  driverIds: string[],
  zoneGridKey: string,
  hourOfDay: number,
  dayOfWeek: number,
): Promise<Map<string, number>> {
  if (!driverIds.length) return new Map();

  const [zoneResult, globalResult] = await Promise.all([
    rawDb.execute(rawSql`
      SELECT driver_id,
             COUNT(*) FILTER (WHERE decision = 'accepted') AS accepted,
             COUNT(*) FILTER (WHERE decision IS NOT NULL)  AS total
      FROM driver_offer_events
      WHERE driver_id    = ANY(${driverIds}::uuid[])
        AND zone_grid_key = ${zoneGridKey}
        AND hour_of_day   = ${hourOfDay}
        AND day_of_week   = ${dayOfWeek}
        AND offered_at    > NOW() - INTERVAL '60 days'
      GROUP BY driver_id
    `).catch(() => ({ rows: [] as any[] })),
    rawDb.execute(rawSql`
      SELECT driver_id,
             COUNT(*) FILTER (WHERE decision = 'accepted') AS accepted,
             COUNT(*) FILTER (WHERE decision IS NOT NULL)  AS total
      FROM driver_offer_events
      WHERE driver_id = ANY(${driverIds}::uuid[])
        AND offered_at  > NOW() - INTERVAL '90 days'
      GROUP BY driver_id
    `).catch(() => ({ rows: [] as any[] })),
  ]);

  const zoneMap = new Map<string, { accepted: number; total: number }>();
  for (const row of zoneResult.rows as any[]) {
    zoneMap.set(String(row.driver_id), { accepted: Number(row.accepted), total: Number(row.total) });
  }
  const globalMap = new Map<string, { accepted: number; total: number }>();
  for (const row of globalResult.rows as any[]) {
    globalMap.set(String(row.driver_id), { accepted: Number(row.accepted), total: Number(row.total) });
  }

  const result = new Map<string, number>();
  for (const driverId of driverIds) {
    const zone = zoneMap.get(driverId);
    if (zone && zone.total >= 5) {
      result.set(driverId, zone.accepted / zone.total);
      continue;
    }
    const global = globalMap.get(driverId);
    if (!global || global.total < 3) {
      result.set(driverId, 0.6); // cold-start prior
      continue;
    }
    result.set(driverId, global.accepted / global.total);
  }
  return result;
}

// ─── Re-rank with predictive scoring ─────────────────────────────────────────

export async function rerankWithPredictiveScoring(
  drivers: DriverMatchScore[],
  pickupLat: number,
  pickupLng: number,
  serviceType: string,
  platformAcceptRatePct = 70,
  surgeMultiplier = 1.0,
): Promise<DriverMatchScore[]> {
  if (drivers.length <= 1) return drivers;

  const now = new Date();
  const zoneGridKey = toGridKey(pickupLat, pickupLng);
  const hourOfDay   = now.getHours();
  const dayOfWeek   = now.getDay();
  const weights     = getAdaptiveWeights(platformAcceptRatePct, surgeMultiplier);

  // One zone query + one global query for ALL drivers — replaces N×2 individual queries
  const acceptProbMap = await batchGetDriverZoneAcceptProbabilities(
    drivers.map(d => d.driverId),
    zoneGridKey, hourOfDay, dayOfWeek,
  );

  const enriched = drivers.map((d) => {
    const acceptProb = acceptProbMap.get(d.driverId) ?? 0.6;

    const distScore   = Math.max(0, 1 - d.distanceKm / 25);
    const ratingScore = Math.max(0, (d.rating - 1) / 4);
    const respScore   = Math.max(0, 1 - (d.avgResponseTimeSec || 60) / 300);
    const behaviorNorm = Math.max(0, Math.min(1,
      (d.score - distScore * 0.35 - ratingScore * 0.20 - respScore * 0.10 - 0.08) / 0.25,
    ));

    const score =
      distScore    * weights.distance +
      behaviorNorm * weights.behavior +
      ratingScore  * weights.rating +
      respScore    * weights.responseSpeed +
      0.8          * weights.completionRate +
      acceptProb   * weights.acceptProbability;

    return { driver: d, score: Math.round(score * 1000) / 1000 };
  });

  enriched.sort((a, b) => b.score - a.score);
  return enriched.map(e => ({ ...e.driver, score: e.score }));
}

// ─── Pre-positioning nudge ────────────────────────────────────────────────────

export async function runPrePositioningNudge(
  driverId: string,
  currentLat: number,
  currentLng: number,
): Promise<void> {
  try {
    // Demand in last 30 min, grouped by grid zone
    const zones = await rawDb.execute(rawSql`
      SELECT
        zone_grid_key,
        COUNT(*) AS offers
      FROM driver_offer_events
      WHERE offered_at > NOW() - INTERVAL '30 minutes'
        AND decision IS NOT NULL
      GROUP BY zone_grid_key
      HAVING COUNT(*) >= 2
      ORDER BY offers DESC
      LIMIT 15
    `);

    if (!zones.rows.length) return;

    // Find the nearest high-demand zone within 8km
    let bestZone: { lat: number; lng: number; zoneKey: string } | null = null;
    let bestScore = 0;

    for (const row of zones.rows as any[]) {
      const parts = String(row.zone_grid_key).split('_');
      if (parts.length < 2) continue;
      const zoneLat = parseFloat(parts[0]);
      const zoneLng = parseFloat(parts[1]);
      if (!isFinite(zoneLat) || !isFinite(zoneLng)) continue;

      const dLat = (zoneLat - currentLat) * 111.32;
      const dLng = (zoneLng - currentLng) * 111.32 * Math.cos(currentLat * Math.PI / 180);
      const distKm = Math.sqrt(dLat * dLat + dLng * dLng);
      if (distKm > 8 || distKm < 0.5) continue; // skip too near or too far

      const demandScore = Number(row.offers) / Math.max(1, distKm);
      if (demandScore > bestScore) {
        bestScore = demandScore;
        bestZone = { lat: zoneLat, lng: zoneLng, zoneKey: String(row.zone_grid_key) };
      }
    }

    if (!bestZone) return;

    const tokenResult = await rawDb.execute(rawSql`
      SELECT fcm_token FROM user_devices
      WHERE user_id = ${driverId}::uuid
        AND fcm_token IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    `);
    const fcmToken = (tokenResult.rows[0] as any)?.fcm_token as string | undefined;
    if (!fcmToken) return;

    const { sendFcmNotification } = await import("./fcm");
    await sendFcmNotification({
      fcmToken,
      title: "High demand nearby!",
      body: "Move to the highlighted zone to get more rides",
      data: {
        type: "driver:reposition_nudge",
        targetLat: String(bestZone.lat),
        targetLng: String(bestZone.lng),
        zoneKey: bestZone.zoneKey,
      },
    });
    console.log(`[PredictiveDispatch] Nudge sent → driver ${driverId} zone ${bestZone.zoneKey}`);
  } catch (e: any) {
    console.error(`[PredictiveDispatch] Nudge error driver=${driverId}:`, e.message);
  }
}

// ─── Zone demand forecast ─────────────────────────────────────────────────────

export async function forecastZoneDemand(
  lat: number,
  lng: number,
  minutesAhead = 30,
): Promise<{ predicted: number; trend: 'rising' | 'stable' | 'falling' }> {
  try {
    const zoneGridKey = toGridKey(lat, lng);
    const now = new Date();
    const hourOfDay = now.getHours();
    const dayOfWeek = now.getDay();

    const [historical, recent] = await Promise.all([
      // Same hour+dow over last 4 weeks (excluding last hour to avoid self-correlation)
      rawDb.execute(rawSql`
        SELECT COUNT(*) AS cnt
        FROM driver_offer_events
        WHERE zone_grid_key = ${zoneGridKey}
          AND hour_of_day   = ${hourOfDay}
          AND day_of_week   = ${dayOfWeek}
          AND offered_at    > NOW() - INTERVAL '28 days'
          AND offered_at    < NOW() - INTERVAL '1 hour'
      `).catch(() => ({ rows: [{ cnt: 0 }] })),

      // Last 10 minutes
      rawDb.execute(rawSql`
        SELECT COUNT(*) AS cnt
        FROM driver_offer_events
        WHERE zone_grid_key = ${zoneGridKey}
          AND offered_at    > NOW() - INTERVAL '10 minutes'
      `).catch(() => ({ rows: [{ cnt: 0 }] })),
    ]);

    // Historical average per week, scaled to minutesAhead/60 of an hour
    const histTotal = Number((historical.rows[0] as any)?.cnt ?? 0);
    const histAvg = histTotal / 4; // 4 weeks
    const recentCount = Number((recent.rows[0] as any)?.cnt ?? 0);

    // Scale recent 10-min count to minutesAhead window
    const recentScaled = recentCount * (minutesAhead / 10);

    // Blend: weight recent more (0.6) since it captures real-time demand
    const predicted = Math.round(histAvg * 0.4 + recentScaled * 0.6);

    const trend: 'rising' | 'stable' | 'falling' =
      recentScaled > histAvg * 1.25 ? 'rising' :
      recentScaled < histAvg * 0.75 ? 'falling' : 'stable';

    return { predicted, trend };
  } catch {
    return { predicted: 0, trend: 'stable' };
  }
}
