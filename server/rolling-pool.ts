/**
 * Rolling Pool Engine
 *
 * How it works:
 *   1. Driver starts a pool session (goes "pool mode ON")
 *   2. Customer books → matcher finds nearest compatible active session
 *   3. Driver gets notified → picks up passenger at their location
 *   4. Driver drops passenger at destination → revenue settled immediately
 *   5. Seat freed → next passenger can join
 *   6. Process repeats until driver ends session
 *
 * Key rules:
 *   - Multiple passengers can be in the car simultaneously (up to max_seats)
 *   - New passenger added only if direction compatible + detour ≤ MAX_DETOUR_KM
 *   - Revenue settled per-drop (not at session end)
 *   - If no match within 5 min → customer is informed, can try regular ride
 */

import { randomInt } from "node:crypto";
import type { Express } from "express";
import { rawDb, rawSql, pool as dbPool } from "./db";
import { io } from "./socket";
import { sendFcmNotification } from "./fcm";
import { calculateRevenueBreakdown } from "./revenue-engine";
import { enqueuePoolSettlement, processPoolSettlement } from "./pool-settlement";
import { rerankWithPredictiveScoring, getPlatformAcceptRate, logDriverOffer, recordOfferOutcome } from "./predictive-dispatch";
import { enforceDriverRevenuePolicy } from "./revenue-policy";
import { assertSchemaObjectsOrThrow } from "./schema-health";
import { getMatchingDriverCategoryIds, getVehicleCategoryMeta } from "./vehicle-matching";
import { recomputeUserRating } from "./ratings";

// ── Constants ────────────────────────────────────────────────────────────────

// Hard business rule: one Car Share booking can request at most 2 seats,
// regardless of the matched vehicle's total capacity or any admin setting.
// Not admin-configurable on purpose — validated on both client and server.
const MAX_SEATS_PER_CAR_SHARE_BOOKING = 2;
const MAX_DETOUR_KM = 2.5;        // max extra km to pick up a new passenger
const MAX_MATCH_RADIUS_KM = 4;    // search for sessions within this radius
const DIRECTION_TOLERANCE_DEG = 50; // bearing must match within ±50°
const SEARCH_TIMEOUT_MIN = 5;     // cancel search if no match in 5 min
const BOARDING_OTP_TTL_SECONDS = 45;
const MATCHER_INTERVAL_MS = 20_000; // re-run matcher every 20s
let matcherStarted = false;
const DRIVER_ACCEPT_TIMEOUT_SEC = 45;
const DEFAULT_PRE_DEPARTURE_REFUND_PCT = 100;
const DEFAULT_POST_DEPARTURE_REFUND_PCT = 0;

async function getLatestFcmToken(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const r = await rawDb.execute(rawSql`
    SELECT fcm_token
    FROM user_devices
    WHERE user_id = ${userId}::uuid
      AND fcm_token IS NOT NULL
      AND fcm_token != ''
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  return ((r.rows[0] as any)?.fcm_token || null) as string | null;
}

async function sendPoolPush(
  userId: string | null | undefined,
  title: string,
  body: string,
  data: Record<string, string>,
) {
  const token = await getLatestFcmToken(userId);
  if (!token) return false;
  return sendFcmNotification({
    fcmToken: token,
    title,
    body,
    channelId: "trip_alerts_v2",
    sound: "trip_alert",
    data,
  }).catch(() => false);
}

function normalizePoolKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolvePoolVehicleType(vc: any, seatsN: number): string {
  // Check vehicle_type AND name together, not vehicle_type-with-name-as-
  // fallback — the admin's Vehicle Type dropdown has no "Premium" option
  // (only Bike/Auto/Mini Car/Sedan/SUV/Carpool/etc.), so a category named
  // "Premium" would otherwise never actually get read from its name once
  // vehicle_type is set to anything else.
  const key = normalizePoolKey(`${vc?.vehicle_type || vc?.slug || ""} ${vc?.name || ""}`);
  if (key.includes("suv") || key.includes("xl")) return "pool_suv";
  if (key.includes("premium")) return "pool_premium";
  if (key.includes("sedan")) return "pool_sedan";
  if (key.includes("mini")) return "pool_mini";
  return seatsN >= 6 ? "car_pool_6" : "car_pool_4";
}

async function buildPoolCategoryClause(vehicleCategoryId?: string | null) {
  if (!vehicleCategoryId) return rawSql``;
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const matchingIds = (await getMatchingDriverCategoryIds(vehicleCategoryId) || [vehicleCategoryId])
    .filter((id) => uuidRe.test(id));
  if (!matchingIds.length) return rawSql``;
  if (matchingIds.length === 1) {
    return rawSql`AND dps.vehicle_category_id = ${matchingIds[0]}::uuid`;
  }
  return rawSql`AND dps.vehicle_category_id IN (${rawSql.join(
    matchingIds.map((id) => rawSql`${id}::uuid`),
    rawSql`, `,
  )})`;
}

function isPoolVehicleCategory(row: any): boolean {
  const key = normalizePoolKey(row?.vehicle_type || row?.slug || row?.name);
  const serviceType = normalizePoolKey(row?.service_type || row?.type);
  return Boolean(row) && (
    row.is_carpool === true ||
    row.is_carpool === "true" ||
    serviceType === "pool" ||
    serviceType === "carpool" ||
    key === "car_pool_4" ||
    key === "car_pool_6" ||
    key === "carpool" ||
    key.includes("pool")
  );
}

async function getPoolSettingNumber(key: string, fallback: number): Promise<number> {
  const r = await rawDb.execute(rawSql`
    SELECT value FROM business_settings WHERE key_name = ${key} LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const value = Number((r.rows[0] as any)?.value);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function poolResponse(
  success: boolean,
  code: string,
  message: string,
  data: Record<string, any> = {},
  retryable = false,
) {
  return {
    success,
    code,
    message,
    retryable,
    data,
    timestamp: new Date().toISOString(),
  };
}

function generateBoardingOtp(): string {
  return randomInt(1000, 10000).toString();
}

async function getPoolRefundPolicy() {
  const r = await rawDb.execute(rawSql`
    SELECT key_name, value
    FROM business_settings
    WHERE key_name IN (
      'pool_cancel_refund_before_departure_pct',
      'pool_cancel_refund_after_departure_pct'
    )
  `).catch(() => ({ rows: [] as any[] }));
  const settings = new Map<string, number>();
  for (const row of r.rows as any[]) {
    const parsed = Number(row.value);
    if (Number.isFinite(parsed)) settings.set(String(row.key_name), parsed);
  }
  return {
    beforeDeparturePct: settings.get("pool_cancel_refund_before_departure_pct") ?? DEFAULT_PRE_DEPARTURE_REFUND_PCT,
    afterDeparturePct: settings.get("pool_cancel_refund_after_departure_pct") ?? DEFAULT_POST_DEPARTURE_REFUND_PCT,
  };
}

async function hasActivePoolBlock(userA: string, userB: string): Promise<boolean> {
  if (!userA || !userB) return false;
  const blockedR = await rawDb.execute(rawSql`
    SELECT 1
    FROM pool_user_blocks
    WHERE active = true
      AND (
        (blocker_user_id = ${userA}::uuid AND blocked_user_id = ${userB}::uuid)
        OR
        (blocker_user_id = ${userB}::uuid AND blocked_user_id = ${userA}::uuid)
      )
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  return blockedR.rows.length > 0;
}

function buildRefundTimeline(amount: number, refundStatus: string) {
  const eligible = amount > 0;
  return [
    {
      title: "Cancellation requested",
      state: "done",
      detail: eligible ? "Seat released and refund request created." : "Seat released. No refund is applicable.",
    },
    {
      title: "Admin refund review",
      state: eligible ? (refundStatus === "approved" || refundStatus === "completed" ? "done" : "active") : "skipped",
      detail: eligible ? "Operations verifies whether the trip had started." : "Skipped because refund is not applicable.",
    },
    {
      title: "Refund settlement",
      state: refundStatus === "completed" ? "done" : eligible ? "pending" : "skipped",
      detail: eligible ? "Amount is credited to wallet or original payment channel." : "No settlement required.",
    },
  ];
}

function toBool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function buildUserSafetySnapshot(row: any, prefix = "") {
  const openIssueCount = Number(row?.[`${prefix}open_issue_count`] ?? row?.open_issue_count ?? 0);
  const totalReportCount = Number(row?.[`${prefix}report_count`] ?? row?.report_count ?? 0);
  const hasActiveBlock = toBool(row?.[`${prefix}has_active_block`] ?? row?.has_active_block);
  const isVerified = toBool(row?.[`${prefix}is_verified`] ?? row?.is_verified);
  const isHighRisk = hasActiveBlock || openIssueCount >= 2 || totalReportCount >= 3;
  let badgeLabel: string | null = null;
  if (hasActiveBlock) badgeLabel = "Blocked User";
  else if (isHighRisk) badgeLabel = "High Risk User";
  else if (openIssueCount > 0 || totalReportCount > 0) badgeLabel = "Reported User";
  return {
    isVerified,
    openIssueCount,
    totalReportCount,
    hasActiveBlock,
    isHighRisk,
    badgeLabel,
  };
}

// ── Schema ───────────────────────────────────────────────────────────────────

export async function ensureRollingPoolSchema(): Promise<void> {
  await assertSchemaObjectsOrThrow({
    tables: ["driver_pool_sessions", "pool_ride_requests"],
  });
}

function haversineKmPool(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function bearingDegPool(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function bearingDiff(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// Detour added by picking up new passenger at (pLat,pLng) dropping at (dLat,dLng)
// from driver's current position (cLat,cLng)
function detourKm(
  cLat: number, cLng: number,  // driver current position
  pLat: number, pLng: number,  // new passenger pickup
  dLat: number, dLng: number,  // new passenger drop
): number {
  // Extra distance = drive to pickup + drive pickup→drop − drive direct to drop
  const driverToPickup = haversineKmPool(cLat, cLng, pLat, pLng);
  const pickupToDrop   = haversineKmPool(pLat, pLng, dLat, dLng);
  const driverToDrop   = haversineKmPool(cLat, cLng, dLat, dLng);
  return Math.max(0, driverToPickup + pickupToDrop - driverToDrop);
}

// ── Fare calc ─────────────────────────────────────────────────────────────────

// Per-vehicle-type multiplier on top of the base per-seat rate, admin-editable
// alongside the other pool settings (same business_settings key/value store,
// same /admin/local-pool/settings endpoint) — not a separate pricing system.
// car_pool_4 (the generic/default pool bucket) intentionally has no entry
// here and multiplies by 1 (getPoolSettingNumber's fallback), matching the
// existing behavior for anything that isn't Mini/Sedan/SUV.
const POOL_TYPE_MULTIPLIER_KEYS: Record<string, string> = {
  pool_mini: "pool_multiplier_mini",
  pool_sedan: "pool_multiplier_sedan",
  pool_suv: "pool_multiplier_suv",
  pool_premium: "pool_multiplier_premium",
};

async function calcPoolFare(
  distKm: number,
  seats: number,
  vehicleTypeKey?: string | null,
): Promise<{ farePerSeat: number; subtotalFare: number; totalFare: number }> {
  const baseFare = await getPoolSettingNumber("base_fare_per_seat", 20);
  const perKmFare = await getPoolSettingNumber("fare_per_km_per_seat", 5);
  const minFare = await getPoolSettingNumber("min_fare_per_seat", 30);
  const maxFare = await getPoolSettingNumber("max_fare_per_seat", 500);
  const multiplierKey = vehicleTypeKey ? POOL_TYPE_MULTIPLIER_KEYS[vehicleTypeKey] : null;
  const multiplier = multiplierKey ? await getPoolSettingNumber(multiplierKey, 1) : 1;
  const rawFarePerSeat = (baseFare + (perKmFare * distKm)) * multiplier;
  const clampedFarePerSeat = Math.min(Math.max(rawFarePerSeat, minFare), maxFare);
  const farePerSeat = Math.round(clampedFarePerSeat * 100) / 100;
  const subtotalFare = Math.round(farePerSeat * seats * 100) / 100;
  return {
    farePerSeat,
    subtotalFare,
    totalFare: subtotalFare,
  };
}

async function getSessionRoutePlan(sessionId: string): Promise<any[]> {
  const r = await rawDb.execute(rawSql`
    SELECT route_plan FROM driver_pool_sessions WHERE id = ${sessionId}::uuid LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const plan = (r.rows[0] as any)?.route_plan;
  return Array.isArray(plan) ? plan : [];
}

async function rebuildSessionRoutePlan(sessionId: string): Promise<any[]> {
  const r = await rawDb.execute(rawSql`
    SELECT id, status, pickup_lat, pickup_lng, drop_lat, drop_lng,
           pickup_address, drop_address, pickup_order, drop_order
    FROM pool_ride_requests
    WHERE session_id = ${sessionId}::uuid
      AND status IN ('matched', 'picked_up')
    ORDER BY COALESCE(pickup_order, 9999), created_at ASC
  `).catch(() => ({ rows: [] as any[] }));

  const stops: any[] = [];
  for (const row of r.rows as any[]) {
    if (row.status === "matched") {
      stops.push({
        type: "pickup",
        requestId: String(row.id),
        lat: Number(row.pickup_lat),
        lng: Number(row.pickup_lng),
        address: row.pickup_address,
        order: Number(row.pickup_order || 9999),
      });
    }
    stops.push({
      type: "drop",
      requestId: String(row.id),
      lat: Number(row.drop_lat),
      lng: Number(row.drop_lng),
      address: row.drop_address,
      order: Number(row.drop_order || row.pickup_order || 9999) + 0.5,
    });
  }
  stops.sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  await rawDb.execute(rawSql`
    UPDATE driver_pool_sessions
    SET route_plan = ${JSON.stringify(stops)}::jsonb,
        state_version = state_version + 1,
        updated_at = NOW()
    WHERE id = ${sessionId}::uuid
  `).catch(() => undefined);
  return stops;
}

async function emitSeatUpdate(sessionId: string): Promise<void> {
  const sessionR = await rawDb.execute(rawSql`
    SELECT dps.id, dps.driver_id, dps.max_seats, dps.available_seats, dps.status,
           dps.accepting_new_requests, dps.state_version, dps.pool_vehicle_type, dps.route_plan,
           COUNT(prr.id) FILTER (WHERE prr.status IN ('pending_driver_accept', 'matched', 'picked_up'))::int as active_passengers,
           COUNT(prr.id) FILTER (WHERE prr.status = 'picked_up')::int as onboard_passengers,
           COUNT(prr.id) FILTER (WHERE prr.status IN ('pending_driver_accept', 'matched'))::int as pending_pickups
    FROM driver_pool_sessions dps
    LEFT JOIN pool_ride_requests prr ON COALESCE(prr.session_id, prr.proposed_session_id) = dps.id
    WHERE dps.id = ${sessionId}::uuid
    GROUP BY dps.id
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const session = sessionR.rows[0] as any;
  if (!session) return;

  const maxSeats = parseInt(session.max_seats || 0);
  const availableSeats = parseInt(session.available_seats || 0);
  const payload = {
    sessionId,
    maxSeats,
    availableSeats,
    occupiedSeats: Math.max(0, maxSeats - availableSeats),
    activePassengers: parseInt(session.active_passengers || 0),
    onboardPassengers: parseInt(session.onboard_passengers || 0),
    pendingPickups: parseInt(session.pending_pickups || 0),
    occupancyPercent: maxSeats > 0 ? Math.round(((maxSeats - availableSeats) / maxSeats) * 100) : 0,
    status: session.status,
    acceptingNewRequests: session.accepting_new_requests !== false,
    stateVersion: parseInt(session.state_version || 1),
    poolVehicleType: session.pool_vehicle_type || "car_pool_4",
    routePlan: Array.isArray(session.route_plan) ? session.route_plan : [],
  };

  io.to(`user:${session.driver_id}`).emit("pool:seat_update", payload);
  const customerR = await rawDb.execute(rawSql`
    SELECT customer_id
    FROM pool_ride_requests
    WHERE COALESCE(session_id, proposed_session_id) = ${sessionId}::uuid
      AND status IN ('pending_driver_accept', 'matched', 'picked_up')
  `).catch(() => ({ rows: [] as any[] }));
  for (const row of customerR.rows as any[]) {
    io.to(`user:${row.customer_id}`).emit("pool:seat_update", payload);
  }
}

// ── Core matching logic ───────────────────────────────────────────────────────

async function findBestSession(
  pickupLat: number, pickupLng: number,
  dropLat: number, dropLng: number,
  seatsNeeded: number,
  vehicleCategoryId?: string | null,
): Promise<{ sessionId: string; driverId: string } | null> {
  const customerBearing = bearingDegPool(pickupLat, pickupLng, dropLat, dropLng);
  const maxMatchRadiusKm = await getPoolSettingNumber("local_pool_match_radius_km", MAX_MATCH_RADIUS_KM);
  const maxDetourKm = await getPoolSettingNumber("local_pool_max_detour_km", MAX_DETOUR_KM);
  const directionToleranceDeg = await getPoolSettingNumber("local_pool_direction_tolerance_deg", DIRECTION_TOLERANCE_DEG);
  const categoryClause = await buildPoolCategoryClause(vehicleCategoryId);

  // TEMP DEBUG — CAR_SHARE_ELIGIBLE_DRIVERS: unfiltered active-session count,
  // so a zero here (vs. zero after radius/category filtering below) tells us
  // whether the problem is "no driver has started a pool session at all" vs.
  // "sessions exist but none are close enough / right category."
  const allActiveR = await rawDb.execute(rawSql`
    SELECT dps.id, dps.driver_id, dps.status, dps.accepting_new_requests, dps.available_seats,
           dps.current_lat, dps.current_lng, dps.vehicle_category_id, dps.created_at
    FROM driver_pool_sessions dps
    WHERE dps.status = 'active'
  `).catch(() => ({ rows: [] as any[] }));
  console.log("[CAR_SHARE_ELIGIBLE_DRIVERS]", JSON.stringify({
    totalActiveSessions: allActiveR.rows.length,
    seatsNeeded,
    requestedVehicleCategoryId: vehicleCategoryId || null,
    sessions: (allActiveR.rows as any[]).map((s) => ({
      sessionId: s.id,
      driverId: s.driver_id,
      acceptingNewRequests: s.accepting_new_requests,
      availableSeats: s.available_seats,
      hasLocation: s.current_lat != null && s.current_lng != null,
      vehicleCategoryId: s.vehicle_category_id,
      sessionAgeSec: Math.round((Date.now() - new Date(s.created_at).getTime()) / 1000),
    })),
  }));

  const r = await rawDb.execute(rawSql`
    SELECT dps.id, dps.driver_id, dps.available_seats,
           dps.current_lat, dps.current_lng, dps.current_bearing_deg,
           dps.vehicle_category_id
    FROM driver_pool_sessions dps
    WHERE dps.status = 'active'
      AND dps.accepting_new_requests = true
      AND dps.available_seats >= ${seatsNeeded}
      AND dps.current_lat IS NOT NULL
      AND dps.current_lng IS NOT NULL
      AND (
        6371 * 2 * ASIN(SQRT(
          POWER(SIN((${pickupLat} - dps.current_lat::float) * PI()/360), 2) +
          COS(${pickupLat} * PI()/180) * COS(dps.current_lat::float * PI()/180) *
          POWER(SIN((${pickupLng} - dps.current_lng::float) * PI()/360), 2)
        ))
      ) <= ${maxMatchRadiusKm}
      ${categoryClause}
    ORDER BY (
      6371 * 2 * ASIN(SQRT(
        POWER(SIN((${pickupLat} - dps.current_lat::float) * PI()/360), 2) +
        COS(${pickupLat} * PI()/180) * COS(dps.current_lat::float * PI()/180) *
        POWER(SIN((${pickupLng} - dps.current_lng::float) * PI()/360), 2)
      ))
    ) ASC
    LIMIT 10
  `).catch(() => ({ rows: [] as any[] }));
  console.log("[CAR_SHARE_MATCHING_STARTED]", JSON.stringify({
    radiusFilteredSessionCount: r.rows.length,
    maxMatchRadiusKm, maxDetourKm, directionToleranceDeg,
  }));

  const candidates: { sessionId: string; driverId: string; distKm: number }[] = [];
  for (const row of r.rows as any[]) {
    // Only apply direction filter when the driver has a real GPS bearing.
    // current_bearing_deg is NULL until the driver sends their first location update.
    // Using (bearing || 0) would convert NULL→0 and silently skip due-north drivers too.
    if (row.current_bearing_deg != null) {
      const driverBearing = parseFloat(row.current_bearing_deg);
      if (!isNaN(driverBearing)) {
        const bdiff = bearingDiff(driverBearing, customerBearing);
        if (bdiff > directionToleranceDeg) {
          console.log("[CAR_SHARE_DRIVER_REJECTED]", JSON.stringify({
            driverId: row.driver_id, sessionId: row.id,
            rejectionReason: "direction_mismatch", bearingDiffDeg: Math.round(bdiff), directionToleranceDeg,
          }));
          continue;
        }
      }
    }

    const cLat = parseFloat(row.current_lat);
    const cLng = parseFloat(row.current_lng);
    const extra = detourKm(cLat, cLng, pickupLat, pickupLng, dropLat, dropLng);
    if (extra > maxDetourKm) {
      console.log("[CAR_SHARE_DRIVER_REJECTED]", JSON.stringify({
        driverId: row.driver_id, sessionId: row.id,
        rejectionReason: "detour_too_large", extraDetourKm: Math.round(extra * 10) / 10, maxDetourKm,
      }));
      continue;
    }

    candidates.push({
      sessionId: String(row.id),
      driverId: String(row.driver_id),
      distKm: haversineKmPool(cLat, cLng, pickupLat, pickupLng),
    });
  }

  console.log("[CAR_SHARE_MATCHING_STARTED] final candidate count:", candidates.length);
  if (!candidates.length) return null;
  if (candidates.length === 1) return { sessionId: candidates[0].sessionId, driverId: candidates[0].driverId };

  try {
    const platformRate = await getPlatformAcceptRate();
    // Build minimal DriverMatchScore-compatible objects for pool session candidates
    const driverScores = candidates.map((c) => ({
      driverId: c.driverId,
      distanceKm: c.distKm,
      rating: 4.5,
      avgResponseTimeSec: 30,
      score: Math.max(0, 1 - c.distKm / 25),
      sessionId: c.sessionId,
    }));
    const reranked = await rerankWithPredictiveScoring(
      driverScores as any,
      pickupLat, pickupLng,
      "local_pool",
      platformRate,
    );
    const best = reranked[0] as any;
    return { sessionId: best.sessionId, driverId: best.driverId };
  } catch {
    return { sessionId: candidates[0].sessionId, driverId: candidates[0].driverId };
  }
}

async function matchRequest(requestId: string): Promise<boolean> {
  console.log("[CAR_SHARE_MATCHING_STARTED] requestId:", requestId);
  const reqR = await rawDb.execute(rawSql`
    SELECT * FROM pool_ride_requests WHERE id = ${requestId}::uuid AND status = 'searching' LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const req = reqR.rows[0] as any;
  if (!req) {
    console.log("[CAR_SHARE_MATCHING_STARTED] request not found or not in 'searching' status — requestId:", requestId);
    return false;
  }

  const match = await findBestSession(
    parseFloat(req.pickup_lat), parseFloat(req.pickup_lng),
    parseFloat(req.drop_lat), parseFloat(req.drop_lng),
    parseInt(req.seats_requested),
    req.vehicle_category_id || null,
  );
  if (!match) {
    console.log("[CAR_SHARE_DRIVER_REJECTED] no candidate session survived matching — requestId:", requestId);
    return false;
  }
  if (await hasActivePoolBlock(String(req.customer_id), String(match.driverId))) {
    console.log("[CAR_SHARE_DRIVER_REJECTED]", JSON.stringify({ driverId: match.driverId, requestId, rejectionReason: "active_block_between_customer_and_driver" }));
    return false;
  }

  // Atomically assign request to session and decrement available_seats
  let assignedPickupOrder = 1;
  let matchedFarePerSeat: number | null = null;
  let matchedTotalFare: number | null = null;
  let matchedVehicleType: string | null = null;
  let matchedVehicleName: string | null = null;
  const txClient = await dbPool.connect();
  try {
    await txClient.query("BEGIN");

    // Re-check session still has seats (FOR UPDATE prevents race)
    const lockR = await txClient.query(
      `SELECT dps.available_seats, dps.vehicle_category_id, vc.name, vc.vehicle_type, vc.total_seats
       FROM driver_pool_sessions dps
       LEFT JOIN vehicle_categories vc ON vc.id = dps.vehicle_category_id
       WHERE dps.id = $1 AND dps.status = 'active' AND dps.accepting_new_requests = true AND dps.available_seats >= $2
       FOR UPDATE OF dps`,
      [match.sessionId, parseInt(req.seats_requested)],
    );
    if (!lockR.rows.length) {
      await txClient.query("ROLLBACK");
      return false;
    }
    const matchedVehicleRow = lockR.rows[0] as any;
    matchedVehicleType = matchedVehicleRow.vehicle_type ?? null;
    matchedVehicleName = matchedVehicleRow.name ?? null;

    // The customer didn't choose a vehicle type — now that a specific
    // vehicle is actually matched, recalculate the real fare using its
    // pricing (base rate + that vehicle's admin-configured multiplier)
    // instead of the generic estimate stored at booking time. This is the
    // fare the customer and driver both see from here on.
    const matchedTypeKey = resolvePoolVehicleType(
      { vehicle_type: matchedVehicleRow.vehicle_type, name: matchedVehicleRow.name },
      parseInt(matchedVehicleRow.total_seats, 10) || 4,
    );
    const recalculated = await calcPoolFare(parseFloat(req.distance_km) || 0, parseInt(req.seats_requested), matchedTypeKey);
    matchedFarePerSeat = recalculated.farePerSeat;
    matchedTotalFare = recalculated.totalFare;

    // Assign
    const pickupOrderR = await txClient.query(
      `SELECT COALESCE(MAX(pickup_order), 0) + 1 AS next
       FROM pool_ride_requests WHERE session_id = $1`,
      [match.sessionId],
    );
    assignedPickupOrder = pickupOrderR.rows[0].next;
    const pickupOrder = assignedPickupOrder;
    const dropOrder = assignedPickupOrder;
    // The status guard here is the fix for the cancel race condition: if the
    // customer cancelled (status flipped to 'cancelled') between our initial
    // SELECT above and this UPDATE, rowCount is 0 and we roll back instead
    // of silently overwriting their cancellation back to pending_driver_accept.
    const assignR = await txClient.query(
      `UPDATE pool_ride_requests
       SET proposed_session_id = $1, status = 'pending_driver_accept',
           pickup_order = $2, drop_order = $3,
           vehicle_category_id = COALESCE(vehicle_category_id, $5),
           fare_per_seat = $6, total_fare = $7,
           seat_lock_expires_at = NOW() + INTERVAL '45 seconds',
           updated_at = NOW()
       WHERE id = $4 AND status = 'searching'`,
      [match.sessionId, pickupOrder, dropOrder, requestId, matchedVehicleRow.vehicle_category_id, matchedFarePerSeat, matchedTotalFare],
    );
    if (assignR.rowCount === 0) {
      await txClient.query("ROLLBACK");
      return false;
    }
    await txClient.query(
      `UPDATE driver_pool_sessions
       SET available_seats = available_seats - $1,
           state_version = state_version + 1,
           updated_at = NOW()
       WHERE id = $2`,
      [parseInt(req.seats_requested), match.sessionId],
    );

    await txClient.query("COMMIT");
  } catch (e) {
    await txClient.query("ROLLBACK");
    return false;
  } finally {
    txClient.release();
  }

  // Fetch updated request for payload
  const updR = await rawDb.execute(rawSql`
    SELECT prr.*, u.full_name as customer_name, u.phone as customer_phone
    FROM pool_ride_requests prr
    JOIN users u ON u.id = prr.customer_id
    WHERE prr.id = ${requestId}::uuid LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const updReq = (updR.rows[0] as any) || req;

  // Log offer for predictive dispatch training
  logDriverOffer(match.driverId, requestId, parseFloat(req.pickup_lat), parseFloat(req.pickup_lng), "local_pool").catch(() => undefined);

  // Notify driver of new passenger
  console.log("[CAR_SHARE_ALERT_SENT]", JSON.stringify({ driverId: match.driverId, sessionId: match.sessionId, requestId }));
  io.to(`user:${match.driverId}`).emit("pool:new_passenger", {
    requestId,
    sessionId: match.sessionId,
    customerName: updReq.customer_name || "Passenger",
    customerPhone: updReq.customer_phone,
    pickupLat: parseFloat(req.pickup_lat),
    pickupLng: parseFloat(req.pickup_lng),
    dropLat: parseFloat(req.drop_lat),
    dropLng: parseFloat(req.drop_lng),
    pickupAddress: req.pickup_address,
    dropAddress: req.drop_address,
    seatsRequested: parseInt(req.seats_requested),
    totalFare: parseFloat(updReq.total_fare),
    pickupOrder: assignedPickupOrder,
    expiresInSeconds: DRIVER_ACCEPT_TIMEOUT_SEC,
    requiresDriverAccept: true,
  });
  console.log("[CAR_SHARE_SOCKET_SENT]", JSON.stringify({ driverId: match.driverId, requestId, room: `user:${match.driverId}` }));

  // BUG FIX: this was socket-only — a driver whose app is backgrounded or
  // has a dropped socket connection (the normal state while idly waiting
  // for a match) never received anything at all, unlike every other
  // driver-facing alert in this codebase (normal ride dispatch, Outstation
  // Pool) which always pairs the socket event with an FCM push as a
  // wake-the-app fallback. The driver app's fcm_service.dart already knows
  // how to handle this (_isPoolAlert matches any type starting with
  // "pool_" and persists it for the incoming-alert UI) — it was simply
  // never sent for this specific event.
  const fcmSent = await sendPoolPush(
    match.driverId,
    "New Car Share passenger",
    `${updReq.customer_name || "A passenger"} wants to share your ride — ${parseInt(req.seats_requested)} seat(s).`,
    {
      type: "pool_new_passenger",
      module: "local_pool",
      referenceId: requestId,
      requestId,
      sessionId: match.sessionId,
      expiresInSeconds: String(DRIVER_ACCEPT_TIMEOUT_SEC),
    },
  );
  console.log("[CAR_SHARE_FCM_SENT]", JSON.stringify({ driverId: match.driverId, requestId, fcmSent }));

  // Notify customer that a compatible active pool vehicle is being confirmed.
  const driverInfoR = await rawDb.execute(rawSql`
    SELECT u.full_name, u.phone, u.vehicle_number, u.vehicle_model, dd.avg_rating,
           dps.current_lat, dps.current_lng
    FROM driver_pool_sessions dps
    JOIN users u ON u.id = dps.driver_id
    LEFT JOIN driver_details dd ON dd.user_id = dps.driver_id
    WHERE dps.id = ${match.sessionId}::uuid LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const di = (driverInfoR.rows[0] as any) || {};

  io.to(`user:${req.customer_id}`).emit("pool:matched", {
    requestId,
    sessionId: match.sessionId,
    driver: {
      name: di.full_name,
      phone: di.phone,
      vehicleNumber: di.vehicle_number,
      vehicleModel: di.vehicle_model,
      vehicleCategoryType: matchedVehicleType,
      vehicleCategoryName: matchedVehicleName,
      rating: di.avg_rating,
      lat: parseFloat(di.current_lat || 0),
      lng: parseFloat(di.current_lng || 0),
    },
    seatLockExpiresAt: new Date(Date.now() + DRIVER_ACCEPT_TIMEOUT_SEC * 1000).toISOString(),
    pendingDriverAccept: true,
    // The real, vehicle-specific fare — may differ from the estimate shown
    // while searching, now that a specific vehicle has actually been matched.
    farePerSeat: parseFloat(updReq.fare_per_seat),
    totalFare: parseFloat(updReq.total_fare),
    seatsRequested: parseInt(updReq.seats_requested),
    message: "Compatible pool vehicle found. Waiting for driver confirmation.",
  });

  await emitSeatUpdate(match.sessionId);

  return true;
}

// ── Background matcher ────────────────────────────────────────────────────────

export function startRollingPoolMatcher(): void {
  if (matcherStarted) return;
  matcherStarted = true;
  setInterval(runMatcher, MATCHER_INTERVAL_MS);
  console.log("[ROLLING-POOL] matcher started");
}

async function runMatcher(): Promise<void> {
  try {
    // 1. Try to match all pending "searching" requests
    const searchingR = await rawDb.execute(rawSql`
      SELECT id FROM pool_ride_requests
      WHERE status = 'searching'
        AND searched_at > NOW() - INTERVAL '${rawSql.raw(String(SEARCH_TIMEOUT_MIN))} minutes'
    `).catch(() => ({ rows: [] as any[] }));

    for (const row of searchingR.rows as any[]) {
      matchRequest(String(row.id)).catch(() => undefined);
    }

    // 2. Release driver proposals that were not accepted in time.
    const expiredProposalR = await rawDb.execute(rawSql`
      WITH expired AS (
        SELECT prr.id, prr.customer_id, prr.proposed_session_id, prr.seats_requested,
               dps.driver_id AS proposed_driver_id
        FROM pool_ride_requests prr
        LEFT JOIN driver_pool_sessions dps ON dps.id = prr.proposed_session_id
        WHERE prr.status = 'pending_driver_accept'
          AND prr.seat_lock_expires_at <= NOW()
      ),
      released AS (
        UPDATE pool_ride_requests prr
        SET status = 'searching',
            proposed_session_id = NULL,
            seat_lock_expires_at = NULL,
            updated_at = NOW()
        FROM expired
        WHERE prr.id = expired.id
        RETURNING expired.id, expired.customer_id, expired.proposed_session_id, expired.seats_requested, expired.proposed_driver_id
      )
      SELECT * FROM released
    `).catch(() => ({ rows: [] as any[] }));

    for (const row of expiredProposalR.rows as any[]) {
      if (row.proposed_driver_id) {
        recordOfferOutcome(String(row.proposed_driver_id), String(row.id), 'timeout', DRIVER_ACCEPT_TIMEOUT_SEC).catch(() => undefined);
      }
      if (row.proposed_session_id) {
        await rawDb.execute(rawSql`
          UPDATE driver_pool_sessions
          SET available_seats = LEAST(max_seats, available_seats + ${parseInt(row.seats_requested || 1)}),
              state_version = state_version + 1,
              updated_at = NOW()
          WHERE id = ${row.proposed_session_id}::uuid AND status = 'active'
        `).catch(() => undefined);
        await emitSeatUpdate(String(row.proposed_session_id));
      }
      io.to(`user:${row.customer_id}`).emit("pool:driver_confirm_timeout", {
        requestId: row.id,
        message: "Driver did not confirm in time. Searching for another compatible pool vehicle.",
      });
    }

    // 3. Cancel requests that have been searching too long
    const timedOutR = await rawDb.execute(rawSql`
      UPDATE pool_ride_requests
      SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
      WHERE status = 'searching'
        AND searched_at <= NOW() - INTERVAL '${rawSql.raw(String(SEARCH_TIMEOUT_MIN))} minutes'
      RETURNING id, customer_id
    `).catch(() => ({ rows: [] as any[] }));

    for (const row of timedOutR.rows as any[]) {
      io.to(`user:${(row as any).customer_id}`).emit("pool:search_timeout", {
        requestId: (row as any).id,
        message: "No pool driver available nearby. Try booking a regular ride.",
      });
    }
  } catch (e: any) {
    console.error("[ROLLING-POOL] matcher error", e?.message);
  }
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerRollingPoolRoutes(app: Express, authApp: any, requireAdminAuth?: any): void {
  // Safe admin auth guard — if requireAdminAuth is not wired up, reject all requests rather than letting them through
  const adminAuth = requireAdminAuth ?? ((_req: any, res: any) => res.status(401).json({ message: "Admin authentication not configured" }));

  ensureRollingPoolSchema()
    .then(() => startRollingPoolMatcher())
    .catch((e) => console.error("[ROLLING-POOL] schema init failed", e?.message));

  // ─── DRIVER: Start pool session ───────────────────────────────────────────

  app.post("/api/app/driver/pool/session/start", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const { vehicleCategoryId, maxSeats = 4 } = req.body;
      const driverCategoryR = await rawDb.execute(rawSql`
        SELECT vehicle_category_id, car_share_enabled
        FROM driver_details
        WHERE user_id = ${driver.id}::uuid
        LIMIT 1
      `).catch(() => ({ rows: [] as any[] }));
      const driverVehicleCategoryId = (driverCategoryR.rows[0] as any)?.vehicle_category_id
        ? String((driverCategoryR.rows[0] as any).vehicle_category_id)
        : null;
      const requestedVehicleCategoryId = vehicleCategoryId ? String(vehicleCategoryId) : null;
      const resolvedVehicleCategoryId = requestedVehicleCategoryId || driverVehicleCategoryId;

      if (!resolvedVehicleCategoryId) {
        return res.status(403).json(poolResponse(false, "POOL_DRIVER_NOT_ELIGIBLE", "Driver has no pool-enabled vehicle category assigned"));
      }
      // Persistent, driver-set opt-in — separate from (and required before)
      // starting a live pool session. A driver whose vehicle isn't marked
      // Car Share-available can't start pool mode even if their assigned
      // vehicle_category itself is pool-eligible.
      const driverCarShareEnabled = (driverCategoryR.rows[0] as any)?.car_share_enabled === true;
      if (!driverCarShareEnabled) {
        return res.status(403).json(poolResponse(
          false,
          "POOL_NOT_ENABLED_FOR_VEHICLE",
          "Enable \"Available for Car Share\" for your vehicle before starting pool mode",
        ));
      }
      if (requestedVehicleCategoryId && driverVehicleCategoryId && requestedVehicleCategoryId !== driverVehicleCategoryId) {
        return res.status(403).json(poolResponse(false, "POOL_DRIVER_CATEGORY_MISMATCH", "Requested pool vehicle category does not match driver's approved vehicle"));
      }

      const vcR = await rawDb.execute(rawSql`
        SELECT id, name, type, service_type, vehicle_type, is_carpool, total_seats
        FROM vehicle_categories
        WHERE id = ${resolvedVehicleCategoryId}::uuid
        LIMIT 1
      `).catch(() => ({ rows: [] as any[] }));
      const vc = vcR.rows[0] as any;
      if (!isPoolVehicleCategory(vc)) {
        return res.status(403).json(poolResponse(false, "POOL_DRIVER_NOT_ELIGIBLE", "Only approved pool-enabled drivers can start rolling pool"));
      }
      // P0 FIX: Local Pool had no is_locked check anywhere in this file, unlike
      // Outstation Pool and Car Sharing (both check it at ride/session creation) -
      // a financially-locked driver could still start a session and pick up
      // passengers, bypassing the wallet-recharge lock every other module enforces.
      const lockR = await rawDb.execute(rawSql`SELECT is_locked, lock_reason FROM users WHERE id=${driver.id}::uuid LIMIT 1`).catch(() => ({ rows: [] as any[] }));
      if ((lockR.rows[0] as any)?.is_locked) {
        return res.status(403).json(poolResponse(
          false,
          "ACCOUNT_LOCKED",
          (lockR.rows[0] as any).lock_reason || "Account locked. Please recharge wallet to continue.",
        ));
      }
      try {
        await enforceDriverRevenuePolicy(driver.id, "carpool");
      } catch (policyErr: any) {
        return res.status(policyErr.statusCode || 403).json(poolResponse(
          false,
          policyErr.code || "SUBSCRIPTION_REQUIRED",
          policyErr.message || "Subscription required for pool service",
        ));
      }

      // End any existing active session first
      await rawDb.execute(rawSql`
        UPDATE driver_pool_sessions
        SET status = 'ended', ended_at = NOW(), updated_at = NOW()
        WHERE driver_id = ${driver.id}::uuid AND status = 'active'
      `);

      const requestedSeats = parseInt(String(maxSeats)) || 4;
      const categorySeats = parseInt(String(vc?.total_seats || 0));
      const cappedSeats = categorySeats > 0 ? Math.min(requestedSeats, categorySeats) : requestedSeats;
      const seatsN = cappedSeats >= 6 ? 6 : 4;
      const poolVehicleType = resolvePoolVehicleType(vc, seatsN);

      // Get driver's current location
      const locR = await rawDb.execute(rawSql`
        SELECT current_lat, current_lng FROM users WHERE id = ${driver.id}::uuid LIMIT 1
      `).catch(() => ({ rows: [] as any[] }));
      const loc = locR.rows[0] as any;

      const r = await rawDb.execute(rawSql`
        INSERT INTO driver_pool_sessions
          (driver_id, vehicle_category_id, status, accepting_new_requests, pool_vehicle_type, max_seats, available_seats, current_lat, current_lng)
        VALUES
          (${driver.id}::uuid,
           ${resolvedVehicleCategoryId}::uuid,
           'active', true, ${poolVehicleType}, ${seatsN}, ${seatsN},
           ${loc?.current_lat || null}, ${loc?.current_lng || null})
        RETURNING *
      `);
      const session = r.rows[0] as any;

      console.log(`[ROLLING-POOL] driver ${driver.id} started session ${session.id}`);
      await emitSeatUpdate(String(session.id));
      res.json(poolResponse(true, "POOL_SESSION_STARTED", "Pool session started", { session }));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_SESSION_START_FAILED", e.message || "Could not start pool session", {}, true));
    }
  });

  // ─── DRIVER: Update location (called from driver's GPS stream) ────────────

  app.patch("/api/app/driver/pool/location", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const { lat, lng, bearingDeg } = req.body;
      const latN = parseFloat(lat);
      const lngN = parseFloat(lng);
      if (!lat || !lng || !isFinite(latN) || !isFinite(lngN) ||
          latN < -90 || latN > 90 || lngN < -180 || lngN > 180) {
        return res.status(400).json(poolResponse(false, "POOL_LOCATION_REQUIRED", "Valid lat/lng required"));
      }
      const bearingN = bearingDeg != null ? parseFloat(bearingDeg) : null;

      await rawDb.execute(rawSql`
        UPDATE driver_pool_sessions
        SET current_lat = ${latN},
            current_lng = ${lngN},
            current_bearing_deg = ${bearingN !== null && isFinite(bearingN) ? bearingN : null},
            last_location_at = NOW(),
            updated_at = NOW()
        WHERE driver_id = ${driver.id}::uuid AND status = 'active'
      `);

      // Broadcast driver location to matched/picked-up passengers only.
      // Do NOT call emitSeatUpdate here — seat counts don't change on GPS pings,
      // and firing 2 extra SQL queries + N socket writes every 2s per active driver
      // creates significant load at scale (100 drivers = 100 queries/s).
      await rawDb.execute(rawSql`
        SELECT prr.customer_id
        FROM pool_ride_requests prr
        JOIN driver_pool_sessions dps ON dps.id = prr.session_id
        WHERE dps.driver_id = ${driver.id}::uuid
          AND dps.status = 'active'
          AND prr.status IN ('matched', 'picked_up')
      `).then(r2 => {
        for (const p of r2.rows as any[]) {
          io.to(`user:${p.customer_id}`).emit("pool:driver_location", {
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            bearingDeg: bearingDeg != null ? parseFloat(bearingDeg) : null,
          });
        }
      }).catch(() => undefined);

      res.json(poolResponse(true, "POOL_LOCATION_UPDATED", "Pool location updated"));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_LOCATION_UPDATE_FAILED", e.message || "Could not update pool location", {}, true));
    }
  });

  // ─── DRIVER: Get active session + current passenger queue ─────────────────

  app.post("/api/app/driver/pool/session/accepting", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const accepting = req.body?.acceptingNewRequests !== false;
      const r = await rawDb.execute(rawSql`
        UPDATE driver_pool_sessions
        SET accepting_new_requests = ${accepting}, updated_at = NOW()
        WHERE driver_id = ${driver.id}::uuid AND status = 'active'
        RETURNING id, accepting_new_requests
      `);
      if (!r.rows.length) {
        return res.status(404).json(poolResponse(false, "POOL_SESSION_NOT_FOUND", "No active pool session found"));
      }
      const session = r.rows[0] as any;
      await emitSeatUpdate(String(session.id));
      io.to(`user:${driver.id}`).emit("pool:accepting_update", {
        sessionId: String(session.id),
        acceptingNewRequests: session.accepting_new_requests !== false,
      });
      res.json(poolResponse(true, "POOL_ACCEPTING_UPDATED", accepting ? "New passenger requests enabled" : "New passenger requests paused", {
        acceptingNewRequests: session.accepting_new_requests !== false,
      }));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_ACCEPTING_UPDATE_FAILED", e.message || "Could not update pool accepting mode", {}, true));
    }
  });

  app.get("/api/app/driver/pool/session/active", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const sessionR = await rawDb.execute(rawSql`
        SELECT * FROM driver_pool_sessions
        WHERE driver_id = ${driver.id}::uuid AND status = 'active'
        LIMIT 1
      `);
      if (!sessionR.rows.length) return res.json(poolResponse(true, "POOL_SESSION_EMPTY", "No active pool session", { session: null, passengers: [] }));

      const session = sessionR.rows[0] as any;
      const passR = await rawDb.execute(rawSql`
        SELECT prr.*, u.full_name as customer_name, u.phone as customer_phone,
               CASE WHEN COALESCE(u.verification_status, '') IN ('verified', 'approved') THEN true ELSE false END AS is_verified,
               (
                 SELECT COUNT(*)::int
                 FROM pool_issue_cases pic
                 WHERE pic.reported_user_id = u.id
               ) AS report_count,
               (
                 SELECT COUNT(*)::int
                 FROM pool_issue_cases pic
                 WHERE pic.reported_user_id = u.id
                   AND pic.status IN ('open', 'under_review')
               ) AS open_issue_count,
               EXISTS(
                 SELECT 1
                 FROM pool_user_blocks pub
                 WHERE pub.active = true
                   AND pub.blocked_user_id = u.id
               ) AS has_active_block
        FROM pool_ride_requests prr
        JOIN users u ON u.id = prr.customer_id
        WHERE COALESCE(prr.session_id, prr.proposed_session_id) = ${session.id}::uuid
          AND prr.status IN ('pending_driver_accept', 'matched', 'picked_up', 'dropped')
        ORDER BY prr.pickup_order ASC
      `);
      res.json(poolResponse(true, "POOL_SESSION_ACTIVE", "Active pool session loaded", {
        session,
        passengers: (passR.rows as any[]).map((row) => ({
          ...row,
          safety: buildUserSafetySnapshot(row),
        })),
      }));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_SESSION_FETCH_FAILED", e.message || "Could not load pool session", {}, true));
    }
  });

  app.post("/api/app/driver/pool/passengers/:requestId/accept", authApp, async (req: any, res: any) => {
    const driver = req.currentUser;
    const requestId = String(req.params.requestId);
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const lockR = await client.query(
        `SELECT prr.*, dps.driver_id, dps.id AS locked_session_id
         FROM pool_ride_requests prr
         JOIN driver_pool_sessions dps ON dps.id = prr.proposed_session_id
         WHERE prr.id = $1::uuid
           AND dps.driver_id = $2::uuid
           AND dps.status = 'active'
           AND prr.status = 'pending_driver_accept'
           AND prr.seat_lock_expires_at > NOW()
         FOR UPDATE OF prr, dps`,
        [requestId, driver.id],
      );
      if (!lockR.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json(poolResponse(false, "POOL_ACCEPT_NOT_FOUND", "Pool request expired or already handled"));
      }
      const row = lockR.rows[0] as any;
      await client.query(
        `UPDATE pool_ride_requests
         SET session_id = proposed_session_id,
             proposed_session_id = NULL,
             status = 'matched',
             matched_at = NOW(),
             assignment_version = assignment_version + 1,
             updated_at = NOW()
         WHERE id = $1::uuid`,
        [requestId],
      );
      await client.query(
        `UPDATE driver_pool_sessions
         SET state_version = state_version + 1, updated_at = NOW()
         WHERE id = $1::uuid`,
        [row.locked_session_id],
      );
      await client.query("COMMIT");

      // Record acceptance for predictive dispatch learning
      const remainingSecs = row.seat_lock_expires_at
        ? Math.max(0, (new Date(row.seat_lock_expires_at).getTime() - Date.now()) / 1000)
        : 0;
      recordOfferOutcome(String(driver.id), requestId, 'accepted', DRIVER_ACCEPT_TIMEOUT_SEC - remainingSecs).catch(() => undefined);

      const routePlan = await rebuildSessionRoutePlan(String(row.locked_session_id));
      io.to(`user:${row.customer_id}`).emit("pool:driver_confirmed", {
        requestId,
        sessionId: String(row.locked_session_id),
        routePlan,
        message: "Driver confirmed your pool seat. Please be ready at pickup.",
      });
      void sendPoolPush(
        String(row.customer_id),
        "Pool booking confirmed",
        "Your local pool seat is confirmed.",
        {
          type: "pool_booking_confirmed",
          module: "local_pool",
          referenceId: requestId,
          requestId,
          sessionId: String(row.locked_session_id),
        },
      );
      io.to(`user:${driver.id}`).emit("pool:route_updated", {
        sessionId: String(row.locked_session_id),
        routePlan,
      });
      await emitSeatUpdate(String(row.locked_session_id));
      res.json(poolResponse(true, "POOL_PASSENGER_ACCEPTED", "Passenger added to active pool route", { routePlan }));
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => undefined);
      res.status(500).json(poolResponse(false, "POOL_ACCEPT_FAILED", e.message || "Could not accept pool passenger", {}, true));
    } finally {
      client.release();
    }
  });

  app.post("/api/app/driver/pool/passengers/:requestId/skip", authApp, async (req: any, res: any) => {
    const driver = req.currentUser;
    const requestId = String(req.params.requestId);
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const lockR = await client.query(
        `SELECT prr.customer_id, prr.seats_requested, prr.proposed_session_id
         FROM pool_ride_requests prr
         JOIN driver_pool_sessions dps ON dps.id = prr.proposed_session_id
         WHERE prr.id = $1::uuid
           AND dps.driver_id = $2::uuid
           AND prr.status = 'pending_driver_accept'
         FOR UPDATE OF prr, dps`,
        [requestId, driver.id],
      );
      if (!lockR.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json(poolResponse(false, "POOL_SKIP_NOT_FOUND", "Pool request already handled"));
      }
      const row = lockR.rows[0] as any;
      await client.query(
        `UPDATE pool_ride_requests
         SET status = 'searching',
             proposed_session_id = NULL,
             seat_lock_expires_at = NULL,
             updated_at = NOW()
         WHERE id = $1::uuid`,
        [requestId],
      );
      await client.query(
        `UPDATE driver_pool_sessions
         SET available_seats = LEAST(max_seats, available_seats + $1),
             state_version = state_version + 1,
             updated_at = NOW()
         WHERE id = $2::uuid`,
        [parseInt(row.seats_requested || 1), row.proposed_session_id],
      );
      await client.query("COMMIT");

      recordOfferOutcome(String(driver.id), requestId, 'rejected', DRIVER_ACCEPT_TIMEOUT_SEC).catch(() => undefined);
      io.to(`user:${row.customer_id}`).emit("pool:driver_skipped", {
        requestId,
        message: "Searching for another compatible pool vehicle.",
      });
      await emitSeatUpdate(String(row.proposed_session_id));
      matchRequest(requestId).catch(() => undefined);
      res.json(poolResponse(true, "POOL_PASSENGER_SKIPPED", "Passenger skipped and returned to matching"));
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => undefined);
      res.status(500).json(poolResponse(false, "POOL_SKIP_FAILED", e.message || "Could not skip passenger", {}, true));
    } finally {
      client.release();
    }
  });

  // ─── DRIVER: Mark passenger as picked up ─────────────────────────────────

  app.post("/api/app/driver/pool/passengers/:requestId/pickup", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const requestId = String(req.params.requestId);
      const otp = String(req.body?.otp ?? '').trim();
      if (otp.length === 0) {
        return res.status(400).json(poolResponse(false, "POOL_PICKUP_OTP_REQUIRED", "Boarding OTP required"));
      }

      // Verify driver owns the session for this request
      const r = await rawDb.execute(rawSql`
        UPDATE pool_ride_requests prr
        SET status = 'picked_up',
            picked_up_at = NOW(),
            boarding_otp_used_at = NOW(),
            updated_at = NOW()
        FROM driver_pool_sessions dps
        WHERE prr.id = ${requestId}::uuid
          AND prr.session_id = dps.id
          AND dps.driver_id = ${driver.id}::uuid
          AND dps.status = 'active'
          AND prr.status = 'matched'
          AND prr.boarding_otp = ${otp}
          AND prr.boarding_otp_used_at IS NULL
          AND COALESCE(prr.boarding_otp_expires_at, NOW() + INTERVAL '1 second') > NOW()
        RETURNING prr.customer_id, prr.pickup_address, prr.drop_address, prr.session_id
      `);
      if (!r.rows.length) {
        const diag = await rawDb.execute(rawSql`
          SELECT prr.status, prr.boarding_otp, prr.boarding_otp_expires_at, prr.boarding_otp_used_at
          FROM pool_ride_requests prr
          JOIN driver_pool_sessions dps ON dps.id = prr.session_id
          WHERE prr.id = ${requestId}::uuid
            AND dps.driver_id = ${driver.id}::uuid
            AND dps.status = 'active'
          LIMIT 1
        `);
        if (!diag.rows.length) {
          return res.status(404).json(poolResponse(false, "POOL_PICKUP_FAILED", "Passenger not found"));
        }

        const row = diag.rows[0] as any;
        if (row.boarding_otp_used_at || String(row.status || "") === "picked_up") {
          return res.status(409).json(poolResponse(false, "OTP_ALREADY_USED", "Boarding OTP already used"));
        }

        if (row.boarding_otp_expires_at && new Date(String(row.boarding_otp_expires_at)).getTime() <= Date.now()) {
          return res.status(410).json(poolResponse(false, "OTP_EXPIRED", "Boarding OTP expired"));
        }

        if (String(row.boarding_otp || "") !== otp) {
          return res.status(400).json(poolResponse(false, "INVALID_OTP", "Invalid boarding OTP"));
        }

        return res.status(404).json(poolResponse(false, "POOL_PICKUP_FAILED", "Passenger not found, already picked up, or OTP invalid"));
      }

      const p = r.rows[0] as any;
      io.to(`user:${p.customer_id}`).emit("pool:picked_up", {
        requestId,
        message: "You've been picked up! Enjoy your ride.",
        dropAddress: p.drop_address,
      });

      const routePlan = await rebuildSessionRoutePlan(String(p.session_id));
      io.to(`user:${driver.id}`).emit("pool:route_updated", { sessionId: String(p.session_id), routePlan });
      await emitSeatUpdate(String(p.session_id));
      res.json(poolResponse(true, "POOL_PASSENGER_PICKED_UP", "Passenger picked up"));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_PICKUP_ERROR", e.message || "Could not pick up passenger", {}, true));
    }
  });

  // ─── DRIVER: Drop passenger + settle fare ────────────────────────────────

  app.post("/api/app/driver/pool/passengers/:requestId/no-show", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const requestId = String(req.params.requestId);

      const r = await rawDb.execute(rawSql`
        SELECT prr.session_id, prr.customer_id, prr.seats_requested
        FROM pool_ride_requests prr
        JOIN driver_pool_sessions dps ON dps.id = prr.session_id
        WHERE prr.id = ${requestId}::uuid
          AND dps.driver_id = ${driver.id}::uuid
          AND dps.status = 'active'
          AND prr.status = 'matched'
        LIMIT 1
      `);
      if (!r.rows.length) {
        return res.status(404).json(poolResponse(false, "POOL_NO_SHOW_NOT_FOUND", "Passenger not found or cannot be marked no-show"));
      }

      const row = r.rows[0] as any;
      const noShowClient = await dbPool.connect();
      try {
        await noShowClient.query("BEGIN");
        await noShowClient.query(
          `UPDATE pool_ride_requests
           SET status = 'cancelled', cancelled_at = NOW(),
               cancel_reason = 'Passenger no-show', updated_at = NOW()
           WHERE id = $1`,
          [requestId],
        );
        await noShowClient.query(
          `UPDATE driver_pool_sessions
           SET available_seats = LEAST(max_seats, available_seats + $1),
               state_version = state_version + 1,
               updated_at = NOW()
           WHERE id = $2`,
          [parseInt(row.seats_requested || 1), row.session_id],
        );
        await noShowClient.query("COMMIT");
      } catch (txErr) {
        await noShowClient.query("ROLLBACK");
        throw txErr;
      } finally {
        noShowClient.release();
      }

      io.to(`user:${row.customer_id}`).emit("pool:cancelled", {
        requestId,
        reason: "Driver marked you as a no-show for this pooled ride.",
      });
      const routePlan = await rebuildSessionRoutePlan(String(row.session_id));
      io.to(`user:${driver.id}`).emit("pool:route_updated", { sessionId: String(row.session_id), routePlan });
      await emitSeatUpdate(String(row.session_id));
      res.json(poolResponse(true, "POOL_PASSENGER_NO_SHOW", "Passenger marked as no-show"));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_NO_SHOW_FAILED", e.message || "Could not mark no-show", {}, true));
    }
  });

  app.post("/api/app/driver/pool/passengers/:requestId/drop", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const requestId = String(req.params.requestId);

      // Fetch request + session together (verify ownership)
      const rr = await rawDb.execute(rawSql`
        SELECT prr.*, dps.id as session_id
        FROM pool_ride_requests prr
        JOIN driver_pool_sessions dps ON dps.id = prr.session_id
        WHERE prr.id = ${requestId}::uuid
          AND dps.driver_id = ${driver.id}::uuid
          AND dps.status = 'active'
          AND prr.status = 'picked_up'
        LIMIT 1
      `);
      if (!rr.rows.length) return res.status(404).json({ message: "Passenger not found or not picked up yet" });
      const req_ = rr.rows[0] as any;

      // Mark dropped + free seats in a single atomic transaction
      const dropClient = await dbPool.connect();
      let settlementOutboxId: string | undefined;
      try {
        await dropClient.query("BEGIN");
        const dropR = await dropClient.query(
          `UPDATE pool_ride_requests
           SET status = 'dropped', dropped_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND status = 'picked_up'`,
          [requestId],
        );
        if ((dropR.rowCount ?? 0) === 0) {
          await dropClient.query("ROLLBACK");
          dropClient.release();
          return res.status(409).json(poolResponse(false, "POOL_DROP_CONFLICT", "Passenger already dropped or not in picked_up state"));
        }
        await dropClient.query(
          `UPDATE driver_pool_sessions
           SET available_seats = LEAST(max_seats, available_seats + $1),
               total_passengers_served = total_passengers_served + 1,
               state_version = state_version + 1,
               updated_at = NOW()
           WHERE id = $2`,
          [parseInt(req_.seats_requested), req_.session_id],
        );

        // Crash-safe settlement: enqueue in the same transaction as the status update,
        // so a crash between COMMIT and settlement leaves a recoverable outbox entry
        // instead of an orphaned drop (driver never paid).
        settlementOutboxId = await enqueuePoolSettlement(dropClient, {
          bookingId: requestId,
          module: "city_pool",
          driverId: driver.id,
          fare: parseFloat(req_.total_fare),
          paymentMethod: req_.payment_method || "cash",
          serviceLabel: "rolling_pool",
        });

        await dropClient.query("COMMIT");
      } catch (txErr) {
        await dropClient.query("ROLLBACK");
        throw txErr;
      } finally {
        dropClient.release();
      }

      // Process settlement immediately for a fast response; if this fails or the
      // process crashes here, the pool-settlement worker's recovery loop will
      // pick up the pending outbox entry and complete it (see pool-settlement.ts).
      const fare = parseFloat(req_.total_fare);
      let driverEarnings = fare;
      let newWalletBalance = 0;
      try {
        const breakdown = await calculateRevenueBreakdown(fare, "city_pool", driver.id);
        driverEarnings = breakdown.driverEarnings;
        await processPoolSettlement(settlementOutboxId!);

        // insurance_amount isn't tracked by the shared settlement outbox; set it here
        await rawDb.execute(rawSql`
          UPDATE pool_ride_requests
          SET insurance_amount = ${breakdown.insurance}, updated_at = NOW()
          WHERE id = ${requestId}::uuid
        `).catch(() => {});

        // Update total_earnings on session
        await rawDb.execute(rawSql`
          UPDATE driver_pool_sessions
          SET total_earnings = total_earnings + ${driverEarnings}, updated_at = NOW()
          WHERE id = ${req_.session_id}::uuid
        `);

        const walletR = await rawDb.execute(rawSql`
          SELECT wallet_balance FROM users WHERE id = ${driver.id}::uuid LIMIT 1
        `);
        newWalletBalance = walletR.rows.length ? parseFloat((walletR.rows[0] as any).wallet_balance) : 0;
      } catch (settleErr: any) {
        console.error("[ROLLING-POOL] settlement error", settleErr?.message);
      }

      // Notify customer they've been dropped
      io.to(`user:${req_.customer_id}`).emit("pool:dropped", {
        requestId,
        fare,
        driverEarnings,
        message: "Thanks for riding! Have a great day.",
      });

      const routePlan = await rebuildSessionRoutePlan(String(req_.session_id));
      io.to(`user:${driver.id}`).emit("pool:route_updated", { sessionId: String(req_.session_id), routePlan });
      await emitSeatUpdate(String(req_.session_id));
      res.json(poolResponse(true, "POOL_PASSENGER_DROPPED", "Passenger dropped successfully", {
        fare,
        driverEarnings,
        newWalletBalance,
      }));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_DROP_FAILED", e.message || "Could not complete pooled drop", {}, true));
    }
  });

  // ─── DRIVER: End pool session ─────────────────────────────────────────────

  app.post("/api/app/driver/pool/session/end", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;

      // Cancel all pending matched requests in this session (no-shows)
      const sessionR = await rawDb.execute(rawSql`
        SELECT id FROM driver_pool_sessions
        WHERE driver_id = ${driver.id}::uuid AND status = 'active' LIMIT 1
      `);
      if (!sessionR.rows.length) return res.json(poolResponse(true, "POOL_SESSION_ALREADY_ENDED", "No active session"));

      const sessionId = (sessionR.rows[0] as any).id;

      // Cancel all active passengers: matched, picked_up, and pending_driver_accept
      // picked_up passengers who didn't complete their drop get a full refund
      // pending_driver_accept passengers get seats released before session row is closed
      const pendingR = await rawDb.execute(rawSql`
        UPDATE pool_ride_requests
        SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW(),
            refund_amount = CASE WHEN status = 'picked_up' THEN COALESCE(total_fare, 0) ELSE 0 END,
            cancel_reason = CASE
              WHEN status = 'picked_up' THEN 'Driver ended session mid-ride'
              WHEN status = 'pending_driver_accept' THEN 'Driver ended session before confirming seat'
              ELSE 'Driver ended pool session'
            END
        WHERE COALESCE(session_id, proposed_session_id) = ${sessionId}::uuid
          AND status IN ('matched', 'picked_up', 'pending_driver_accept')
        RETURNING customer_id, status, refund_amount
      `);
      for (const p of pendingR.rows as any[]) {
        const wasPickedUp = p.status === 'picked_up';
        const wasPending = p.status === 'pending_driver_accept';
        const refundAmt = parseFloat(p.refund_amount || 0);
        io.to(`user:${p.customer_id}`).emit("pool:cancelled", {
          reason: wasPickedUp
            ? "Driver ended session during your ride. A refund has been initiated."
            : wasPending
            ? "The driver ended their session before confirming your seat. Please rebook."
            : "Driver ended pool session. Please rebook.",
          refundAmount: wasPickedUp ? refundAmt : 0,
        });
      }

      // End session
      const endR = await rawDb.execute(rawSql`
        UPDATE driver_pool_sessions
        SET status = 'ended', ended_at = NOW(), updated_at = NOW()
        WHERE id = ${sessionId}::uuid
        RETURNING total_passengers_served, total_earnings
      `);
      const stats = endR.rows[0] as any;

      console.log(`[ROLLING-POOL] driver ${driver.id} ended session ${sessionId}`);
      await emitSeatUpdate(String(sessionId));
      res.json(poolResponse(true, "POOL_SESSION_ENDED", "Pool session ended", {
        totalPassengersServed: parseInt(stats?.total_passengers_served || 0),
        totalEarnings: parseFloat(stats?.total_earnings || 0),
      }));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_SESSION_END_FAILED", e.message || "Could not end pool session", {}, true));
    }
  });

  // ─── CUSTOMER: Book a rolling pool ride ──────────────────────────────────

  app.post("/api/app/customer/pool/book", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const {
        pickupLat, pickupLng, dropLat, dropLng,
        pickupAddress = "", dropAddress = "",
        seatsRequested = 1,
        vehicleCategoryId,
        paymentMethod = "cash",
      } = req.body;
      console.log("[CAR_SHARE_BOOK_REQUEST_RECEIVED]", JSON.stringify({
        customerId: customer?.id, seatsRequested, vehicleCategoryId: vehicleCategoryId || null,
        hasCoords: !!(pickupLat && pickupLng && dropLat && dropLng),
      }));

      if (!pickupLat || !pickupLng || !dropLat || !dropLng) {
        return res.status(400).json(poolResponse(false, "POOL_COORDS_REQUIRED", "Pickup and drop coordinates required"));
      }
      // The customer does not choose a vehicle type for Car Share — JAGO
      // auto-matches across every eligible pool vehicle. vehicleCategoryId
      // stays accepted (not required) for any caller that still sends one;
      // when present it's validated, but omitting it is the normal path now.
      if (vehicleCategoryId) {
        const poolCategoryMeta = await getVehicleCategoryMeta(String(vehicleCategoryId));
        if (!poolCategoryMeta || !isPoolVehicleCategory({
          vehicle_type: poolCategoryMeta.vehicleType,
          service_type: poolCategoryMeta.serviceType,
          is_carpool: poolCategoryMeta.isCarpool,
          name: poolCategoryMeta.name,
        })) {
          return res.status(400).json(poolResponse(false, "POOL_VEHICLE_INVALID", "Selected vehicle is not a valid pool category"));
        }
      }

      const modeR = await rawDb.execute(rawSql`
        SELECT value FROM business_settings WHERE key_name = 'local_pool_mode' LIMIT 1
      `).catch(() => ({ rows: [] as any[] }));
      const poolMode = String((modeR.rows[0] as any)?.value || "on").toLowerCase();
      if (poolMode === "off") {
        return res.status(503).json(poolResponse(false, "POOL_DISABLED", "Local pool is temporarily unavailable"));
      }

      const requestedSeats = parseInt(String(seatsRequested), 10) || 1;
      if (requestedSeats < 1 || requestedSeats > MAX_SEATS_PER_CAR_SHARE_BOOKING) {
        return res.status(400).json(poolResponse(
          false,
          "POOL_SEAT_LIMIT",
          `You can request only 1 to ${MAX_SEATS_PER_CAR_SHARE_BOOKING} seats per Car Share booking`,
        ));
      }
      const seats = requestedSeats;
      const pLat = parseFloat(pickupLat);
      const pLng = parseFloat(pickupLng);
      const dLat = parseFloat(dropLat);
      const dLng = parseFloat(dropLng);
      const distKm = haversineKmPool(pLat, pLng, dLat, dLng);
      // The actual vehicle isn't known yet — matching happens after this
      // request is created. This is an initial estimate at the base (no
      // per-type multiplier) rate; matchRequest() recalculates the real
      // fare once a specific vehicle is matched and updates this row before
      // notifying the customer, so what they're ultimately charged reflects
      // the matched vehicle's actual pricing, not this placeholder.
      const { farePerSeat, subtotalFare, totalFare } = await calcPoolFare(distKm, seats, null);
      let revenuePreview: any = null;
      try {
        revenuePreview = await calculateRevenueBreakdown(totalFare, "city_pool");
      } catch {
        revenuePreview = null;
      }
      const commissionAmount = Math.round(Number(revenuePreview?.commission ?? totalFare * 0.10) * 100) / 100;
      const gstAmount = Math.round(Number(revenuePreview?.gst ?? 0) * 100) / 100;
      const insuranceAmount = Math.round(Number(revenuePreview?.insurance ?? 0) * 100) / 100;
      const platformDeduction = Math.round(Number(revenuePreview?.total ?? (commissionAmount + gstAmount + insuranceAmount)) * 100) / 100;
      const driverEarnings = Math.round(Number(revenuePreview?.driverEarnings ?? (totalFare - platformDeduction)) * 100) / 100;
      const revenueModel = String(revenuePreview?.model ?? "commission");
      const boardingOtp = generateBoardingOtp();
      const clusterKey = [
        Math.round(pLat * 100) / 100,
        Math.round(pLng * 100) / 100,
        Math.round(dLat * 100) / 100,
        Math.round(dLng * 100) / 100,
      ].join(':');

      // Duplicate booking guard — one active pool booking per customer at a time
      const existingActive = await rawDb.execute(rawSql`
        SELECT id FROM pool_ride_requests
        WHERE customer_id = ${customer.id}::uuid
          AND status IN ('searching', 'pending_driver_accept', 'matched', 'picked_up')
        LIMIT 1
      `);
      if ((existingActive.rows as any[]).length > 0) {
        return res.status(409).json(poolResponse(false, "POOL_DUPLICATE_BOOKING", "You already have an active pool booking. Complete or cancel it before booking again."));
      }

      // Create request in 'searching' state
      const r = await rawDb.execute(rawSql`
        INSERT INTO pool_ride_requests
          (customer_id, vehicle_category_id, pickup_lat, pickup_lng, drop_lat, drop_lng,
           pickup_address, drop_address, seats_requested,
           fare_per_seat, total_fare, distance_km, commission_amount, gst_amount,
           insurance_amount, platform_deduction, revenue_model, revenue_breakdown, driver_earnings,
           payment_method, status, searched_at, boarding_otp, boarding_otp_issued_at, boarding_otp_expires_at, cluster_key)
        VALUES
          (${customer.id}::uuid,
           ${vehicleCategoryId || null}${vehicleCategoryId ? rawSql`::uuid` : rawSql``},
           ${pLat}, ${pLng}, ${dLat}, ${dLng},
           ${pickupAddress || null}, ${dropAddress || null}, ${seats},
           ${farePerSeat}, ${totalFare}, ${distKm}, ${commissionAmount}, ${gstAmount},
           ${insuranceAmount}, ${platformDeduction}, ${revenueModel}, ${JSON.stringify(revenuePreview || {})}::jsonb, ${driverEarnings},
           ${paymentMethod}, 'searching', NOW(), ${boardingOtp}, NOW(), NOW() + INTERVAL '${rawSql.raw(String(BOARDING_OTP_TTL_SECONDS))} seconds', ${clusterKey})
        RETURNING id
      `);
      const requestId = String((r.rows[0] as any).id);
      console.log("[CAR_SHARE_BOOKING_CREATED]", JSON.stringify({ requestId, customerId: customer.id, seats, status: "searching" }));

      // Try immediate match
      const matched = await matchRequest(requestId);

      // matched = driver was proposed but must still accept (pending_driver_accept), not yet matched
      res.json(poolResponse(true, matched ? "POOL_PENDING_ACCEPT" : "POOL_SEARCHING", matched ? "Compatible driver found — waiting for confirmation." : `Searching for a pool driver nearby... (up to ${SEARCH_TIMEOUT_MIN} min)`, {
        requestId,
        status: matched ? "pending_driver_accept" : "searching",
        boardingOtp,
        farePerSeat,
        totalFare,
        seatsRequested: seats,
        distanceKm: distKm,
        fareBreakdown: {
          perSeatFare: farePerSeat,
          seatsBooked: seats,
          subtotalFare,
          totalFare,
          commissionAmount,
          commissionPerSeat: Math.round((commissionAmount / seats) * 100) / 100,
          gstAmount,
          gstPerSeat: Math.round((gstAmount / seats) * 100) / 100,
          insuranceAmount,
          platformDeduction,
          revenueModel,
          driverEarnings,
          note: `Pool fare — Rs ${farePerSeat.toFixed(0)}/seat x ${seats} = Rs ${totalFare.toFixed(0)}`,
        },
      }));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_BOOKING_FAILED", e.message || "Could not create pooled booking", {}, true));
    }
  });

  // ─── CUSTOMER: Preview an estimated Car Share fare (no booking created) ───
  // The customer never picks a vehicle type, so this returns one estimate —
  // the base per-seat rate, not tied to any specific vehicle_category — for
  // display before booking. Reuses calcPoolFare(), the same function
  // /pool/book and matchRequest() use, so it's not a duplicate pricing path.
  // The real, vehicle-specific fare is only known once matchRequest() finds
  // an actual driver and recalculates using that vehicle's pricing.
  app.post("/api/app/customer/pool/estimate", authApp, async (req: any, res: any) => {
    try {
      const {
        pickupLat, pickupLng, dropLat, dropLng,
        seatsRequested = 1,
      } = req.body;

      if (!pickupLat || !pickupLng || !dropLat || !dropLng) {
        return res.status(400).json(poolResponse(false, "POOL_COORDS_REQUIRED", "Pickup and drop coordinates required"));
      }

      const seats = Math.min(Math.max(parseInt(String(seatsRequested), 10) || 1, 1), MAX_SEATS_PER_CAR_SHARE_BOOKING);

      const pLat = parseFloat(pickupLat);
      const pLng = parseFloat(pickupLng);
      const dLat = parseFloat(dropLat);
      const dLng = parseFloat(dropLng);
      const distKm = haversineKmPool(pLat, pLng, dLat, dLng);

      const anyPoolCategoryR = await rawDb.execute(rawSql`
        SELECT id, name, vehicle_type, service_type, type, is_carpool, total_seats
        FROM vehicle_categories
        WHERE is_active = true
      `);
      const hasEligibleVehicle = (anyPoolCategoryR.rows as any[]).some((row) => {
        if (!isPoolVehicleCategory(row)) return false;
        return (parseInt(row.total_seats, 10) || 4) >= seats;
      });

      const { farePerSeat, totalFare } = await calcPoolFare(distKm, seats, null);

      res.json(poolResponse(
        true,
        "POOL_ESTIMATE_OK",
        hasEligibleVehicle ? "Car Share estimate available" : "No Car Share vehicles configured yet",
        {
          distanceKm: distKm,
          seatsRequested: seats,
          maxSeatsPerBooking: MAX_SEATS_PER_CAR_SHARE_BOOKING,
          hasEligibleVehicle,
          farePerSeat,
          totalFare,
        },
      ));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_ESTIMATE_FAILED", e.message || "Could not estimate pool fare", {}, true));
    }
  });

  // ─── CUSTOMER: Get booking status ────────────────────────────────────────

  // ─── CUSTOMER: Find my current active Car Share booking (app-resume) ─────
  // Mirrors the status query below but discovers the booking by customer_id
  // instead of requiring a known requestId — this is what lets the app find
  // an in-progress Car Share booking after being closed/reopened, the same
  // way /api/app/customer/active-trip already does for normal rides.
  app.get("/api/app/customer/pool/active", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const r = await rawDb.execute(rawSql`
        SELECT prr.*,
          dps.driver_id, u.full_name as driver_name, u.phone as driver_phone,
          u.vehicle_number, u.vehicle_model, dd.avg_rating,
          dps.current_lat as driver_lat, dps.current_lng as driver_lng,
          vc.vehicle_type AS vehicle_category_type, vc.name AS vehicle_category_name
        FROM pool_ride_requests prr
        LEFT JOIN driver_pool_sessions dps ON dps.id = prr.session_id
        LEFT JOIN users u ON u.id = dps.driver_id
        LEFT JOIN driver_details dd ON dd.user_id = dps.driver_id
        LEFT JOIN vehicle_categories vc ON vc.id = prr.vehicle_category_id
        WHERE prr.customer_id = ${customer.id}::uuid
          AND prr.status IN ('searching', 'pending_driver_accept', 'matched', 'picked_up')
        ORDER BY prr.created_at DESC
        LIMIT 1
      `);
      if (!r.rows.length) return res.json(poolResponse(true, "POOL_NO_ACTIVE_BOOKING", "No active Car Share booking", { active: false, booking: null }));
      res.json(poolResponse(true, "POOL_ACTIVE_BOOKING_FOUND", "Active Car Share booking found", { active: true, booking: r.rows[0] }));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_ACTIVE_FAILED", e.message || "Could not check active Car Share booking", {}, true));
    }
  });

  app.get("/api/app/customer/pool/status/:requestId", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const requestId = String(req.params.requestId);

      const r = await rawDb.execute(rawSql`
        SELECT prr.*,
          dps.driver_id, u.full_name as driver_name, u.phone as driver_phone,
          u.vehicle_number, u.vehicle_model, dd.avg_rating,
          dps.current_lat as driver_lat, dps.current_lng as driver_lng,
          vc.vehicle_type AS vehicle_category_type, vc.name AS vehicle_category_name,
          CASE WHEN COALESCE(u.verification_status, '') IN ('verified', 'approved') THEN true ELSE false END AS driver_is_verified,
          (
            SELECT COUNT(*)::int
            FROM pool_issue_cases pic
            WHERE pic.reported_user_id = dps.driver_id
          ) AS driver_report_count,
          (
            SELECT COUNT(*)::int
            FROM pool_issue_cases pic
            WHERE pic.reported_user_id = dps.driver_id
              AND pic.status IN ('open', 'under_review')
          ) AS driver_open_issue_count,
          EXISTS(
            SELECT 1
            FROM pool_user_blocks pub
            WHERE pub.active = true
              AND pub.blocked_user_id = dps.driver_id
          ) AS driver_has_active_block
        FROM pool_ride_requests prr
        LEFT JOIN driver_pool_sessions dps ON dps.id = prr.session_id
        LEFT JOIN users u ON u.id = dps.driver_id
        LEFT JOIN driver_details dd ON dd.user_id = dps.driver_id
        LEFT JOIN vehicle_categories vc ON vc.id = prr.vehicle_category_id
        WHERE prr.id = ${requestId}::uuid AND prr.customer_id = ${customer.id}::uuid
        LIMIT 1
      `);
      if (!r.rows.length) return res.status(404).json(poolResponse(false, "POOL_STATUS_NOT_FOUND", "Booking not found"));

      res.json(poolResponse(true, "POOL_STATUS_LOADED", "Pool booking loaded", {
        booking: {
          ...(r.rows[0] as any),
          driverSafety: buildUserSafetySnapshot(r.rows[0], "driver_"),
        },
      }));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_STATUS_FAILED", e.message || "Could not load pool status", {}, true));
    }
  });

  // ─── CUSTOMER: Cancel booking ─────────────────────────────────────────────

  app.post("/api/app/customer/pool/cancel/:requestId", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const requestId = String(req.params.requestId);
      const reason = String(req.body?.reason || "Customer changed plans").trim().slice(0, 300);

      const r = await rawDb.execute(rawSql`
        SELECT prr.status, prr.seats_requested, prr.total_fare, prr.payment_method,
               COALESCE(prr.session_id, prr.proposed_session_id) AS session_id
        FROM pool_ride_requests prr
        WHERE prr.id = ${requestId}::uuid AND prr.customer_id = ${customer.id}::uuid
        LIMIT 1
      `);
      if (!r.rows.length) return res.status(404).json(poolResponse(false, "POOL_CANCEL_NOT_FOUND", "Booking not found"));

      const booking = r.rows[0] as any;
      if (booking.status === "picked_up") {
        return res.status(400).json(poolResponse(false, "POOL_CANCEL_TOO_LATE", "Cannot cancel - already picked up"));
      }
      if (["dropped", "cancelled"].includes(booking.status)) {
        return res.json(poolResponse(true, "POOL_ALREADY_CLOSED", "Already completed/cancelled"));
      }

      const fare = parseFloat(booking.total_fare || 0) || 0;
      const policy = await getPoolRefundPolicy();
      const refundPct = booking.status === "searching" || booking.status === "matched" || booking.status === "pending_driver_accept"
        ? policy.beforeDeparturePct
        : policy.afterDeparturePct;
      const refundAmount = Math.round(fare * Math.max(0, refundPct) / 100 * 100) / 100;
      const refundStatus = refundAmount > 0 ? "pending" : "not_applicable";

      // Cancel + seat release atomically.
      // The WHERE clause guards against: (a) concurrent double-cancel inflating seats twice,
      // (b) a race where the booking transitions to picked_up between our SELECT and this UPDATE.
      const cancelClient = await dbPool.connect();
      let cancelledRows = 0;
      try {
        await cancelClient.query("BEGIN");
        const cancelR = await cancelClient.query(
          `UPDATE pool_ride_requests
           SET status = 'cancelled',
               cancel_reason = $1,
               refund_amount = $2,
               cancelled_at = NOW(),
               updated_at = NOW()
           WHERE id = $3::uuid
             AND customer_id = $4::uuid
             AND status NOT IN ('picked_up', 'dropped', 'cancelled')`,
          [reason, refundAmount, requestId, customer.id],
        );
        cancelledRows = cancelR.rowCount ?? 0;

        if (cancelledRows > 0 && booking.session_id) {
          await cancelClient.query(
            `UPDATE driver_pool_sessions
             SET available_seats = LEAST(max_seats, available_seats + $1),
                 state_version = state_version + 1,
                 updated_at = NOW()
             WHERE id = $2::uuid AND status = 'active'`,
            [parseInt(booking.seats_requested) || 1, booking.session_id],
          );
        }
        await cancelClient.query("COMMIT");
      } catch (txErr) {
        await cancelClient.query("ROLLBACK");
        throw txErr;
      } finally {
        cancelClient.release();
      }

      // If 0 rows updated the status was already terminal — return gracefully
      if (cancelledRows === 0) {
        return res.json(poolResponse(true, "POOL_ALREADY_CLOSED", "Booking already completed or cancelled"));
      }

      if (refundAmount > 0) {
        await rawDb.execute(rawSql`
          INSERT INTO refund_requests (customer_id, amount, reason, payment_method, status, admin_note)
          VALUES (
            ${customer.id}::uuid,
            ${refundAmount},
            ${`Local pool cancellation: ${reason}`},
            ${booking.payment_method || "wallet"},
            'pending',
            ${`Local pool booking ${requestId} cancelled before trip start`}
          )
        `).catch(() => undefined);
      }

      // Notify driver + rebuild route — only if this was an in-session booking
      if (booking.session_id) {

        // Notify driver that passenger cancelled + push updated route plan
        const driverR = await rawDb.execute(rawSql`
          SELECT driver_id FROM driver_pool_sessions WHERE id = ${booking.session_id}::uuid LIMIT 1
        `).catch(() => ({ rows: [] as any[] }));
        const drv = driverR.rows[0] as any;
        if (drv?.driver_id) {
          io.to(`user:${drv.driver_id}`).emit("pool:passenger_cancelled", {
            requestId,
            message: "A passenger cancelled their booking.",
          });
          void sendPoolPush(
            String(drv.driver_id),
            "Pool booking cancelled",
            "A passenger cancelled their local pool booking.",
            {
              type: "pool_booking_cancelled",
              module: "local_pool",
              referenceId: requestId,
              requestId,
            },
          );
          // Rebuild route plan so ghost stops are removed from driver navigation
          try {
            const routePlan = await rebuildSessionRoutePlan(String(booking.session_id));
            io.to(`user:${drv.driver_id}`).emit("pool:route_updated", {
              sessionId: String(booking.session_id),
              routePlan,
            });
          } catch (routeErr: any) {
            console.error("[ROLLING-POOL] route rebuild on cancel failed", routeErr?.message);
          }
        }
        await emitSeatUpdate(String(booking.session_id));
      }

      io.to(`user:${customer.id}`).emit("pool:refund_updated", {
        module: "local_pool",
        referenceId: requestId,
        requestId,
        refundAmount,
        refundStatus,
        status: "cancelled",
      });
      void sendPoolPush(
        String(customer.id),
        "Pool booking cancelled",
        refundAmount > 0 ? "Your refund request has been raised." : "Your local pool booking has been cancelled.",
        {
          type: "pool_refund_update",
          module: "local_pool",
          referenceId: requestId,
          requestId,
          refundAmount: String(refundAmount),
          refundStatus: String(refundStatus),
        },
      );

      res.json(poolResponse(true, "POOL_CANCELLED", "Pool booking cancelled", {
        refundAmount,
        refundStatus,
        refundTimeline: buildRefundTimeline(refundAmount, refundStatus),
        cancellationCharge: Math.max(0, fare - refundAmount),
      }));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_CANCEL_FAILED", e.message || "Could not cancel pool booking", {}, true));
    }
  });

  app.get("/api/app/customer/pool/co-passengers/:requestId", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const requestId = String(req.params.requestId);
      const ownR = await rawDb.execute(rawSql`
        SELECT COALESCE(session_id, proposed_session_id) AS session_id
        FROM pool_ride_requests
        WHERE id = ${requestId}::uuid AND customer_id = ${customer.id}::uuid
        LIMIT 1
      `);
      if (!ownR.rows.length) return res.status(404).json(poolResponse(false, "POOL_CO_PASSENGERS_NOT_FOUND", "Booking not found"));
      const sessionId = (ownR.rows[0] as any)?.session_id;
      if (!sessionId) {
        return res.json(poolResponse(true, "POOL_CO_PASSENGERS_EMPTY", "No co-passengers yet", {
          passengers: [],
          occupancy: { passengerCount: 0, seatsBooked: 0 },
        }));
      }
      const coR = await rawDb.execute(rawSql`
        SELECT prr.id,
               u.full_name AS passenger_name,
               CASE WHEN COALESCE(u.verification_status, '') IN ('verified', 'approved') THEN true ELSE false END AS is_verified,
               prr.pickup_address,
               prr.drop_address,
               prr.seats_requested,
               prr.status,
               (
                 SELECT COUNT(*)::int
                 FROM pool_issue_cases pic
                 WHERE pic.reported_user_id = u.id
               ) AS report_count,
               (
                 SELECT COUNT(*)::int
                 FROM pool_issue_cases pic
                 WHERE pic.reported_user_id = u.id
                   AND pic.status IN ('open', 'under_review')
               ) AS open_issue_count,
               EXISTS(
                 SELECT 1
                 FROM pool_user_blocks pub
                 WHERE pub.active = true
                   AND pub.blocked_user_id = u.id
               ) AS has_active_block
        FROM pool_ride_requests prr
        JOIN users u ON u.id = prr.customer_id
        WHERE COALESCE(prr.session_id, prr.proposed_session_id) = ${String(sessionId)}::uuid
          AND prr.status NOT IN ('cancelled')
        ORDER BY prr.created_at ASC
      `);
      const passengers = (coR.rows as any[]).map((row) => ({
        id: row.id,
        passengerName: row.passenger_name,
        isVerified: row.is_verified === true,
        pickupPoint: row.pickup_address || "Pickup on route",
        dropPoint: row.drop_address || "Drop on route",
        seatsBooked: parseInt(row.seats_requested) || 1,
        status: row.status,
        safety: buildUserSafetySnapshot(row),
      }));
      const seatsBooked = passengers.reduce((sum, row) => sum + (row.seatsBooked || 0), 0);
      res.json(poolResponse(true, "POOL_CO_PASSENGERS_LOADED", "Co-passengers loaded", {
        passengers,
        occupancy: {
          passengerCount: passengers.length,
          seatsBooked,
        },
      }));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_CO_PASSENGERS_FAILED", e.message || "Could not load co-passengers", {}, true));
    }
  });

  app.post("/api/app/customer/pool/requests/:requestId/rate-driver", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const requestId = String(req.params.requestId);
      const overall = Number(req.body?.overallRating);
      const safety = Number(req.body?.safetyRating || overall);
      const cleanliness = Number(req.body?.cleanlinessRating || overall);
      const behaviour = Number(req.body?.behaviourRating || overall);
      const punctuality = Number(req.body?.punctualityRating || overall);
      const note = String(req.body?.note || "").slice(0, 1000);
      if (![overall, safety, cleanliness, behaviour, punctuality].every((value) => Number.isFinite(value) && value >= 1 && value <= 5)) {
        return res.status(400).json(poolResponse(false, "POOL_RATING_INVALID", "All ratings must be between 1 and 5"));
      }
      const ownR = await rawDb.execute(rawSql`
        SELECT prr.id, prr.session_id, dps.driver_id
        FROM pool_ride_requests prr
        JOIN driver_pool_sessions dps ON dps.id = prr.session_id
        WHERE prr.id = ${requestId}::uuid
          AND prr.customer_id = ${customer.id}::uuid
          AND prr.status = 'dropped'
        LIMIT 1
      `);
      if (!ownR.rows.length) return res.status(404).json(poolResponse(false, "POOL_RATING_NOT_FOUND", "Completed pool trip not found"));
      const own = ownR.rows[0] as any;
      const inserted = await rawDb.execute(rawSql`
        INSERT INTO pool_ratings (
          module, reference_type, reference_id, ride_id, from_user_id, to_user_id,
          rating_role, overall_rating, safety_rating, cleanliness_rating,
          behaviour_rating, punctuality_rating, note
        )
        VALUES (
          'local_pool', 'request', ${requestId}::uuid, ${own.session_id}::uuid, ${customer.id}::uuid, ${own.driver_id}::uuid,
          'customer_to_driver', ${overall}, ${safety}, ${cleanliness}, ${behaviour}, ${punctuality}, ${note}
        )
        ON CONFLICT (reference_type, reference_id, from_user_id, rating_role) DO NOTHING
        RETURNING *
      `);
      if (!inserted.rows.length) return res.status(409).json(poolResponse(false, "POOL_RATING_EXISTS", "Rating already submitted"));
      // P0 FIX: this used to write users.total_ratings, a column that does not exist
      // anywhere in the schema — silently swallowed by .catch(), so the driver's
      // aggregate rating was never actually updated. recomputeUserRating() is the
      // single shared source of truth across rides/parcel and pool/car-sharing.
      await recomputeUserRating(own.driver_id).catch(() => undefined);
      res.json(poolResponse(true, "POOL_RATING_SAVED", "Pool rating saved", { rating: inserted.rows[0] }));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_RATING_FAILED", e.message || "Could not save pool rating", {}, true));
    }
  });

  app.post("/api/app/driver/pool/requests/:requestId/rate-passenger", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const requestId = String(req.params.requestId);
      const overall = Number(req.body?.overallRating);
      const safety = Number(req.body?.safetyRating || overall);
      const behaviour = Number(req.body?.behaviourRating || overall);
      const punctuality = Number(req.body?.punctualityRating || overall);
      const note = String(req.body?.note || "").slice(0, 1000);
      if (![overall, safety, behaviour, punctuality].every((value) => Number.isFinite(value) && value >= 1 && value <= 5)) {
        return res.status(400).json(poolResponse(false, "POOL_RATING_INVALID", "All ratings must be between 1 and 5"));
      }
      const ownR = await rawDb.execute(rawSql`
        SELECT prr.id, prr.session_id, prr.customer_id
        FROM pool_ride_requests prr
        JOIN driver_pool_sessions dps ON dps.id = prr.session_id
        WHERE prr.id = ${requestId}::uuid
          AND dps.driver_id = ${driver.id}::uuid
          AND prr.status = 'dropped'
        LIMIT 1
      `);
      if (!ownR.rows.length) return res.status(404).json(poolResponse(false, "POOL_RATING_NOT_FOUND", "Completed pool trip not found"));
      const own = ownR.rows[0] as any;
      const inserted = await rawDb.execute(rawSql`
        INSERT INTO pool_ratings (
          module, reference_type, reference_id, ride_id, from_user_id, to_user_id,
          rating_role, overall_rating, safety_rating, cleanliness_rating,
          behaviour_rating, punctuality_rating, note
        )
        VALUES (
          'local_pool', 'request', ${requestId}::uuid, ${own.session_id}::uuid, ${driver.id}::uuid, ${own.customer_id}::uuid,
          'driver_to_customer', ${overall}, ${safety}, ${overall}, ${behaviour}, ${punctuality}, ${note}
        )
        ON CONFLICT (reference_type, reference_id, from_user_id, rating_role) DO NOTHING
        RETURNING *
      `);
      if (!inserted.rows.length) return res.status(409).json(poolResponse(false, "POOL_RATING_EXISTS", "Rating already submitted"));
      // Completeness fix: this endpoint saved the pool_ratings row but never updated the
      // customer's aggregate users.rating (unlike its rate-driver counterpart above).
      await recomputeUserRating(own.customer_id).catch(() => undefined);
      res.json(poolResponse(true, "POOL_RATING_SAVED", "Passenger rating saved", { rating: inserted.rows[0] }));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_RATING_FAILED", e.message || "Could not save passenger rating", {}, true));
    }
  });

  // ─── CUSTOMER: My pool ride history ──────────────────────────────────────

  app.get("/api/app/customer/pool/history", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const r = await rawDb.execute(rawSql`
        SELECT prr.*,
          u.full_name as driver_name, u.vehicle_number, u.vehicle_model, dd.avg_rating
        FROM pool_ride_requests prr
        LEFT JOIN driver_pool_sessions dps ON dps.id = prr.session_id
        LEFT JOIN users u ON u.id = dps.driver_id
        LEFT JOIN driver_details dd ON dd.user_id = dps.driver_id
        WHERE prr.customer_id = ${customer.id}::uuid
        ORDER BY prr.created_at DESC
        LIMIT 50
      `);
      res.json(poolResponse(true, "POOL_HISTORY_LOADED", "Pool booking history loaded", { bookings: r.rows }));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_HISTORY_FAILED", e.message || "Could not load pool history", {}, true));
    }
  });

  // ─── ADMIN: Active pool sessions ──────────────────────────────────────────

  // ─── ADMIN: Local pool stats (used by admin panel stat cards) ────────────────
  app.get("/api/admin/local-pool/stats", adminAuth, async (_req: any, res: any) => {
    try {
      const r = await rawDb.execute(rawSql`
        SELECT
          COUNT(dps.id)::int                                                        AS total_rides,
          COUNT(dps.id) FILTER (WHERE dps.status = 'active' AND dps.accepting_new_requests = true)::int  AS accepting,
          COUNT(dps.id) FILTER (WHERE dps.status = 'active' AND dps.accepting_new_requests = false)::int AS paused,
          COALESCE(SUM(dps.total_passengers_served), 0)::int                        AS total_passengers,
          COALESCE(SUM(dps.total_earnings), 0)::numeric                             AS total_revenue,
          COALESCE(SUM(prr_agg.gst_total), 0)::numeric                             AS total_gst,
          COALESCE(SUM(prr_agg.commission_total), 0)::numeric                      AS total_commission
        FROM driver_pool_sessions dps
        LEFT JOIN (
          SELECT session_id,
                 SUM(gst_amount)        AS gst_total,
                 SUM(commission_amount) AS commission_total
          FROM pool_ride_requests
          WHERE status IN ('dropped', 'picked_up')
          GROUP BY session_id
        ) prr_agg ON prr_agg.session_id = dps.id
      `);
      res.json({ success: true, ...(r.rows[0] as any) });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ─── ADMIN: Local pool ride list (used by admin panel rides table) ───────────
  app.get("/api/admin/local-pool/rides", adminAuth, async (req: any, res: any) => {
    try {
      const status = req.query.status as string | undefined;
      const page = Math.max(1, parseInt(String(req.query.page || 1)));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || 50))));
      const offset = (page - 1) * limit;

      const whereStatus = status && status !== "all"
        ? rawSql`AND dps.status = ${status}`
        : rawSql``;

      const r = await rawDb.execute(rawSql`
        SELECT
          dps.id, dps.status, dps.accepting_new_requests AS "acceptingNewRequests",
          dps.max_seats AS "maxSeats", dps.available_seats AS "availableSeats",
          (dps.max_seats - dps.available_seats) AS "bookedSeats",
          dps.total_passengers_served AS "totalPassengersServed",
          dps.total_earnings AS "totalEarnings",
          dps.pool_vehicle_type AS "poolVehicleType",
          dps.created_at AS "startedAt", dps.ended_at AS "endedAt",
          u.full_name AS "driverName", u.phone AS "driverPhone",
          u.vehicle_number AS "vehicleNumber", u.vehicle_model AS "vehicleModel",
          dps.current_lat AS "currentLat", dps.current_lng AS "currentLng",
          COUNT(prr.id) FILTER (WHERE prr.status = 'searching')::int               AS "searchingCount",
          COUNT(prr.id) FILTER (WHERE prr.status = 'pending_driver_accept')::int   AS "pendingAcceptCount",
          COUNT(prr.id) FILTER (WHERE prr.status = 'matched')::int                 AS "matchedCount",
          COUNT(prr.id) FILTER (WHERE prr.status = 'picked_up')::int               AS "pickedUpCount",
          COUNT(prr.id) FILTER (WHERE prr.status = 'dropped')::int                 AS "droppedCount"
        FROM driver_pool_sessions dps
        JOIN users u ON u.id = dps.driver_id
        LEFT JOIN driver_details dd ON dd.user_id = dps.driver_id
        LEFT JOIN pool_ride_requests prr ON prr.session_id = dps.id
        WHERE 1=1 ${whereStatus}
        GROUP BY dps.id, u.full_name, u.phone, u.vehicle_number, u.vehicle_model
        ORDER BY dps.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const countR = await rawDb.execute(rawSql`
        SELECT COUNT(*)::int AS total FROM driver_pool_sessions dps WHERE 1=1 ${whereStatus}
      `).catch(() => ({ rows: [{ total: 0 }] }));

      res.json({
        success: true,
        data: r.rows,
        pagination: {
          page,
          limit,
          total: (countR.rows[0] as any)?.total ?? 0,
          pages: Math.ceil(((countR.rows[0] as any)?.total ?? 0) / limit),
        },
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ─── ADMIN: Local pool settings (read + save) ─────────────────────────────────
  app.get("/api/admin/local-pool/settings", adminAuth, async (_req: any, res: any) => {
    try {
      const r = await rawDb.execute(rawSql`
        SELECT key_name, value FROM business_settings
        WHERE key_name IN (
          'local_pool_mode',
          'local_pool_collection_secs',
          'local_pool_match_radius_km',
          'local_pool_max_detour_km',
          'local_pool_direction_tolerance_deg',
          'max_seats_per_booking',
          'base_fare_per_seat',
          'fare_per_km_per_seat',
          'min_fare_per_seat',
          'max_fare_per_seat',
          'pool_multiplier_mini',
          'pool_multiplier_sedan',
          'pool_multiplier_suv',
          'pool_multiplier_premium'
        )
      `).catch(() => ({ rows: [] as any[] }));
      const settings: Record<string, string> = {};
      for (const row of r.rows as any[]) {
        settings[row.key_name] = String(row.value ?? "");
      }
      res.json({ success: true, settings });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.patch("/api/admin/local-pool/settings", adminAuth, async (req: any, res: any) => {
    try {
      const allowed = new Set([
        "local_pool_mode",
        "local_pool_collection_secs",
        "local_pool_match_radius_km",
        "local_pool_max_detour_km",
        "local_pool_direction_tolerance_deg",
        "max_seats_per_booking",
        "base_fare_per_seat",
        "fare_per_km_per_seat",
        "min_fare_per_seat",
        "max_fare_per_seat",
        "pool_multiplier_mini",
        "pool_multiplier_sedan",
        "pool_multiplier_suv",
        "pool_multiplier_premium",
      ]);
      const updates = Object.entries(req.body || {}).filter(([k]) => allowed.has(k));
      if (!updates.length) return res.status(400).json({ success: false, message: "No valid settings provided" });

      await rawDb.transaction(async (tx) => {
        for (const [key, value] of updates) {
          await tx.execute(rawSql`
            INSERT INTO business_settings (key_name, value, settings_type)
            VALUES (${key}, ${String(value)}, 'local_pool_settings')
            ON CONFLICT (key_name) DO UPDATE
            SET value = EXCLUDED.value,
                settings_type = EXCLUDED.settings_type,
                updated_at = NOW()
          `);
        }
      });
      res.json({ success: true, message: "Local pool settings updated" });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ─── ADMIN: Per-session passenger list (used by PassengersModal) ──────────────
  app.get("/api/admin/local-pool/rides/:sessionId/passengers", adminAuth, async (req: any, res: any) => {
    try {
      const sessionId = String(req.params.sessionId);
      const r = await rawDb.execute(rawSql`
        SELECT prr.id, prr.status, prr.seats_requested AS "seatsRequested",
               prr.fare_per_seat AS "farePerSeat", prr.total_fare AS "totalFare",
               prr.gst_amount AS "gstAmount", prr.commission_amount AS "commissionAmount",
               prr.pickup_lat AS "pickupLat", prr.pickup_lng AS "pickupLng",
               prr.drop_lat AS "dropLat", prr.drop_lng AS "dropLng",
               prr.pickup_address AS "pickupAddress", prr.drop_address AS "dropAddress",
               u.full_name AS "customerName", u.phone AS "customerPhone"
        FROM pool_ride_requests prr
        JOIN users u ON u.id = prr.customer_id
        WHERE prr.session_id = ${sessionId}::uuid
        ORDER BY prr.pickup_order ASC NULLS LAST, prr.created_at ASC
      `);
      res.json({ success: true, data: r.rows });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get("/api/admin/pool/sessions", adminAuth, async (req: any, res: any) => {
    try {
      const r = await rawDb.execute(rawSql`
        SELECT dps.*,
          u.full_name as driver_name, u.phone as driver_phone,
          COUNT(prr.id) FILTER (WHERE prr.status = 'picked_up')::int as passengers_onboard,
          COUNT(prr.id) FILTER (WHERE prr.status = 'matched')::int as pending_pickups,
          COUNT(prr.id) FILTER (WHERE prr.status = 'dropped')::int as dropped_count
        FROM driver_pool_sessions dps
        JOIN users u ON u.id = dps.driver_id
        LEFT JOIN pool_ride_requests prr ON prr.session_id = dps.id
        WHERE dps.status = 'active'
        GROUP BY dps.id, u.full_name, u.phone
        ORDER BY dps.created_at DESC
      `);
      res.json(poolResponse(true, "POOL_SESSIONS_LOADED", "Active pool sessions loaded", { sessions: r.rows }));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_SESSIONS_FAILED", e.message || "Could not load active pool sessions", {}, true));
    }
  });

  app.get("/api/admin/pool/stats", adminAuth, async (_req: any, res: any) => {
    try {
      const r = await rawDb.execute(rawSql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')::int as active_sessions,
          COUNT(*) FILTER (WHERE status = 'ended')::int as ended_sessions,
          COALESCE(SUM(total_passengers_served), 0)::int as total_passengers_served,
          COALESCE(SUM(total_earnings), 0)::numeric as total_driver_earnings,
          COALESCE(AVG(NULLIF(max_seats - available_seats, 0)), 0)::numeric as avg_occupied_seats
        FROM driver_pool_sessions
      `);
      res.json(poolResponse(true, "POOL_STATS_LOADED", "Pool analytics loaded", {
        stats: r.rows[0] ?? {},
      }));
    } catch (e: any) {
      res.status(500).json(poolResponse(false, "POOL_STATS_FAILED", e.message || "Could not load pool analytics", {}, true));
    }
  });
}
