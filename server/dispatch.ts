/**
 * Concurrent Radius Dispatch Engine (Uber/Ola style)
 *
 * Broadcasts trip request to ALL eligible drivers within radius simultaneously.
 * First to accept wins atomically via WHERE driver_id IS NULL guard.
 * Auto-expands radius when nobody accepts within configurable timeout.
 *
 * Works for all service types: bike, auto, cab, parcel, b2b, carpool, outstation.
 */

import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { io } from "./socket";
import { recordHeartbeat } from "./health-checks";
import { withJobLock } from "./job-lock";
import { notifyDriverNewRide } from "./fcm";
import { type DriverMatchScore } from "./ai";
import { scoreDriverForDispatch } from "./dispatch-score";
import { findParcelCapableDrivers } from "./parcel-advanced";
import { sortDriversByGenderPriority } from "./gender-matching";
import {
  logDriverOffer,
  recordOfferOutcome,
  rerankWithPredictiveScoring,
  getPlatformAcceptRate,
} from "./predictive-dispatch";
import {
  buildDispatchRequirementsFromTripInput,
  findEligibleDriversForDispatch,
  resolveDispatchRequirementsFromTrip,
  type DispatchRequirements,
} from "./dispatch-eligibility";
import { applyWalletChange } from "./revenue-engine";

// ── Dispatch configuration ───────────────────────────────────────────────────

export interface DispatchConfig {
  radiusStepsKm: number[];
  driverTimeoutMs: number;   // ms to wait at each radius before expanding
  maxTotalTimeMs: number;
  driversPerStep: number;
}

// Hardcoded defaults — overridden by admin_settings key 'dispatch_configs' in DB
const DISPATCH_CONFIGS_DEFAULT: Record<string, DispatchConfig> = {
  bike:       { radiusStepsKm: [2, 4, 6, 8],       driverTimeoutMs: 30000, maxTotalTimeMs: 300000, driversPerStep: 20 },
  auto:       { radiusStepsKm: [2, 4, 6, 8],       driverTimeoutMs: 30000, maxTotalTimeMs: 300000, driversPerStep: 20 },
  cab:        { radiusStepsKm: [2, 4, 6, 8, 12],   driverTimeoutMs: 30000, maxTotalTimeMs: 360000, driversPerStep: 20 },
  parcel:     { radiusStepsKm: [3, 6, 10],          driverTimeoutMs: 30000, maxTotalTimeMs: 240000, driversPerStep: 15 },
  b2b_parcel: { radiusStepsKm: [3, 6, 10],          driverTimeoutMs: 30000, maxTotalTimeMs: 300000, driversPerStep: 15 },
  carpool:    { radiusStepsKm: [2, 4, 6, 10],       driverTimeoutMs: 30000, maxTotalTimeMs: 360000, driversPerStep: 20 },
  outstation: { radiusStepsKm: [5, 10, 15, 25],     driverTimeoutMs: 30000, maxTotalTimeMs: 420000, driversPerStep: 15 },
};

// DB config cache (refreshed every 60s)
let _configCache: Record<string, DispatchConfig> | null = null;
let _configCacheLoadedAt = 0;
const CONFIG_CACHE_TTL_MS = 60_000;

async function loadDispatchConfigsFromDb(): Promise<Record<string, DispatchConfig>> {
  try {
    const result = await rawDb.execute(rawSql`
      SELECT value FROM admin_settings WHERE key='dispatch_configs' LIMIT 1
    `);
    if (result.rows.length) {
      const raw = (result.rows[0] as any).value;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
        return parsed as Record<string, DispatchConfig>;
      }
    }
  } catch (_) {}
  return DISPATCH_CONFIGS_DEFAULT;
}

async function getDispatchConfig(serviceType: string): Promise<DispatchConfig> {
  const now = Date.now();
  if (!_configCache || now - _configCacheLoadedAt > CONFIG_CACHE_TTL_MS) {
    _configCache = await loadDispatchConfigsFromDb().catch(() => DISPATCH_CONFIGS_DEFAULT);
    _configCacheLoadedAt = now;
  }
  return _configCache[serviceType] ?? _configCache["auto"] ?? DISPATCH_CONFIGS_DEFAULT.auto;
}

// ── Session state ────────────────────────────────────────────────────────────

interface DispatchSession {
  tripId: string;
  customerId: string;
  pickupLat: number;
  pickupLng: number;
  vehicleCategoryId?: string;
  parcelVehicleCategory?: string;
  serviceType: string;
  config: DispatchConfig;
  requirements: DispatchRequirements;
  tripMeta: TripMeta;

  // Concurrent broadcast state
  radiusIndex: number;
  offeredDriverIds: Set<string>;   // all drivers currently holding an outstanding offer
  notifiedDriverIds: Set<string>;  // all drivers ever notified this session (including prior radii)
  rejectedDriverIds: Set<string>;  // drivers who explicitly rejected or timed out
  status: "searching" | "broadcasting" | "accepted" | "cancelled" | "no_drivers" | "expired";
  createdAt: number;

  // Timers
  radiusTimer: ReturnType<typeof setTimeout> | null;  // fires when current radius window expires
  totalTimer: ReturnType<typeof setTimeout> | null;
  retryCount: number;
  retryTimer: ReturnType<typeof setTimeout> | null;

  // Per-driver offer tracking (for predictive dispatch metrics)
  offerStartedAt: Map<string, number>;  // driverId → timestamp when offer was sent

  // Per-driver AI scoring metadata — populated during broadcastToAllDrivers
  // Enables getCurrentOfferedTripForDriver to return score/distance to polling endpoint
  driverMeta: Map<string, { score: number; distanceKm: number; scoreBreakdown: any }>;
}

export interface TripMeta {
  refId: string;
  customerName: string;
  pickupAddress: string;
  destinationAddress: string;
  pickupShortName?: string;
  destinationShortName?: string;
  pickupLat: number;
  pickupLng: number;
  estimatedFare: number;
  estimatedDistance: number;
  paymentMethod: string;
  tripType: string;
  vehicleCategoryName?: string;
}

// ── Dispatch Engine (singleton) ──────────────────────────────────────────────

const activeDispatches = new Map<string, DispatchSession>();

async function clearPersistedOffer(tripId: string): Promise<void> {
  await rawDb.execute(rawSql`
    UPDATE trip_requests
    SET offered_driver_id=NULL,
        offer_expires_at=NULL,
        offer_payload=NULL,
        updated_at=NOW()
    WHERE id=${tripId}::uuid
  `);
}

/**
 * Resolve the service type from trip_type and vehicle category name.
 */
export function resolveServiceType(
  tripType: string,
  vehicleCategoryName?: string
): string {
  const tt = (tripType || "").toLowerCase();
  const vc = (vehicleCategoryName || "").toLowerCase();

  if (tt === "parcel" || tt === "delivery") return "parcel";
  if (tt === "cargo" || tt === "b2b") return "b2b_parcel";
  if (tt === "carpool" || tt === "pool") return "carpool";
  if (tt === "intercity" || tt === "outstation") return "outstation";

  if (vc.includes("bike") || vc.includes("two")) return "bike";
  if (vc.includes("auto") || vc.includes("rickshaw")) return "auto";
  if (vc.includes("cab") || vc.includes("car") || vc.includes("sedan") || vc.includes("suv") || vc.includes("mini")) return "cab";

  return "auto";
}

/**
 * Start concurrent dispatch for a trip.
 */
export async function startDispatch(
  tripId: string,
  customerId: string,
  pickupLat: number,
  pickupLng: number,
  vehicleCategoryId: string | undefined,
  serviceType: string,
  tripMeta: TripMeta,
  parcelVehicleCategory?: string,
  seedRejectedDriverIds: string[] = []
): Promise<void> {
  cancelDispatch(tripId);

  if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng) || pickupLat === 0 || pickupLng === 0) {
    console.error(`[DISPATCH_COORDS_INVALID] trip=${tripId} pickup=${pickupLat},${pickupLng}`);
    throw new Error("Dispatch requires real pickup coordinates");
  }

  const config = await getDispatchConfig(serviceType);
  const requirements = await resolveDispatchRequirementsFromTrip(tripId)
    || await buildDispatchRequirementsFromTripInput({
      tripId,
      tripType: tripMeta.tripType,
      vehicleCategoryId: vehicleCategoryId || null,
      parcelVehicleCategory: parcelVehicleCategory || null,
      seatsBooked: 1,
    });

  const session: DispatchSession = {
    tripId,
    customerId,
    pickupLat,
    pickupLng,
    vehicleCategoryId,
    parcelVehicleCategory,
    serviceType,
    config,
    requirements,
    tripMeta,
    radiusIndex: 0,
    offeredDriverIds: new Set(),
    notifiedDriverIds: new Set(),
    rejectedDriverIds: new Set(seedRejectedDriverIds.filter(Boolean)),
    status: "searching",
    createdAt: Date.now(),
    radiusTimer: null,
    totalTimer: null,
    retryCount: 0,
    retryTimer: null,
    offerStartedAt: new Map(),
    driverMeta: new Map(),
  };

  activeDispatches.set(tripId, session);

  session.totalTimer = setTimeout(() => {
    if (session.status === "searching" || session.status === "broadcasting") {
      expireDispatch(session, "No pilots available nearby. Please try again.");
    }
  }, config.maxTotalTimeMs);

  console.log(
    `[DISPATCH] ✅ CONCURRENT DISPATCH STARTED — trip=${tripId} type=${serviceType} ` +
    `pickup=(${pickupLat},${pickupLng}) vehicleCategory=${vehicleCategoryId ?? "any"} ` +
    `— radius steps: ${config.radiusStepsKm.join("→")}km broadcastWindow=${config.driverTimeoutMs / 1000}s/step`
  );

  await broadcastToRadius(session);
}

/**
 * Called when a driver accepts a trip (from socket accept handler, ONLY for the winning driver).
 * Clears dispatch session and notifies all non-winning offered drivers.
 */
export async function onDriverAccepted(tripId: string, driverId: string): Promise<void> {
  const session = activeDispatches.get(tripId);
  if (!session) {
    // Session already cleaned up — another driver won before this one was processed
    if (io) io.to(`user:${driverId}`).emit("trip:request_taken", { tripId });
    return;
  }

  if (session.status === "accepted") {
    // Race: two accepts arrived almost simultaneously, second one loses
    if (io) io.to(`user:${driverId}`).emit("trip:request_taken", { tripId });
    return;
  }

  session.status = "accepted";
  clearTimers(session);
  await clearPersistedOffer(tripId).catch(() => {});

  // Record predictive dispatch outcome for winner
  const offeredAt = session.offerStartedAt.get(driverId);
  const responseTimeSec = offeredAt
    ? Math.round((Date.now() - offeredAt) / 1000)
    : session.config.driverTimeoutMs / 1000;
  recordOfferOutcome(driverId, tripId, "accepted", responseTimeSec).catch(() => {});

  // Notify ALL other offered/notified drivers that the trip is taken
  if (io) {
    const allNotified = new Set([
      ...Array.from(session.offeredDriverIds),
      ...Array.from(session.notifiedDriverIds),
    ]);
    allNotified.forEach((notifiedId) => {
      if (notifiedId !== driverId) {
        io.to(`user:${notifiedId}`).emit("trip:request_taken", { tripId });
      }
    });
  }

  activeDispatches.delete(tripId);
  console.log(`[DISPATCH] ✅ DRIVER ACCEPTED (concurrent win) — trip=${tripId} driver=${driverId} totalOffered=${session.notifiedDriverIds.size}`);

  // Verify driver still online 5s after accepting
  (async () => {
    try {
      const { verifyDriverAfterAccept, logInfo } = await import("./hardening");
      const isOnline = await verifyDriverAfterAccept(driverId, tripId);
      if (isOnline) {
        await logInfo("DISPATCH-VERIFY", "Driver verified online after accept", {
          driverId: driverId.toString().slice(0, 8),
          tripId: tripId.toString().slice(0, 8),
        });
      }
    } catch (e: any) {
      console.error("[Driver verification] Error:", e.message);
    }
  })();
}

/**
 * Called when a driver explicitly rejects a trip.
 * Marks driver as rejected; if all offered drivers have now responded, expand radius.
 */
export async function onDriverRejected(tripId: string, driverId: string): Promise<void> {
  const session = activeDispatches.get(tripId);
  if (!session) return;

  session.rejectedDriverIds.add(driverId);
  session.offeredDriverIds.delete(driverId);

  // Record predictive dispatch outcome
  const offeredAt = session.offerStartedAt.get(driverId);
  const responseTimeSec = offeredAt ? Math.round((Date.now() - offeredAt) / 1000) : 0;
  recordOfferOutcome(driverId, tripId, "rejected", responseTimeSec).catch(() => {});
  session.offerStartedAt.delete(driverId);

  // Notify driver their offer is cleared
  if (io) {
    io.to(`user:${driverId}`).emit("trip:offer_timeout", { tripId });
  }

  emitCustomerSearchStatus(session);

  console.log(
    `[DISPATCH] Driver ${driverId} rejected trip ${tripId} — ` +
    `remaining offered=${session.offeredDriverIds.size}`
  );

  // If all offered drivers have responded (no one left to accept), expand immediately
  if (session.offeredDriverIds.size === 0 && (session.status === "broadcasting" || session.status === "searching")) {
    if (session.radiusTimer) {
      clearTimeout(session.radiusTimer);
      session.radiusTimer = null;
    }
    session.radiusIndex++;
    await broadcastToRadius(session);
  }
}

/**
 * Cancel dispatch for a trip (customer cancelled, system cancel, etc.)
 */
export function cancelDispatch(tripId: string): void {
  const session = activeDispatches.get(tripId);
  if (!session) return;

  session.status = "cancelled";
  clearTimers(session);

  // Notify ALL currently offered drivers that the trip was cancelled
  if (io) {
    session.offeredDriverIds.forEach((offeredId) => {
      io.to(`user:${offeredId}`).emit("trip:cancelled", {
        tripId,
        cancelledBy: "customer",
      });
    });
    // Also notify any driver who was notified but may not be in offeredDriverIds
    session.notifiedDriverIds.forEach((notifiedId) => {
      if (!session.offeredDriverIds.has(notifiedId)) {
        io.to(`user:${notifiedId}`).emit("trip:cancelled", { tripId, cancelledBy: "customer" });
      }
    });
  }

  activeDispatches.delete(tripId);
  clearPersistedOffer(tripId).catch(() => {});
  console.log(`[DISPATCH] Cancelled trip ${tripId} — notified ${session.offeredDriverIds.size} offered drivers`);
}

/**
 * Check if a trip has an active dispatch session.
 */
export function hasActiveDispatch(tripId: string): boolean {
  return activeDispatches.has(tripId);
}

/**
 * Get dispatch status for monitoring/debugging.
 */
export function getDispatchStatus(tripId: string) {
  const session = activeDispatches.get(tripId);
  if (!session) return null;
  const config = session.config;
  const currentRadius = config.radiusStepsKm[Math.min(session.radiusIndex, config.radiusStepsKm.length - 1)];
  return {
    tripId,
    serviceType: session.serviceType,
    status: session.status,
    currentRadiusKm: currentRadius,
    radiusStep: Math.min(session.radiusIndex + 1, config.radiusStepsKm.length),
    totalRadiusSteps: config.radiusStepsKm.length,
    offeredCount: session.offeredDriverIds.size,
    notifiedCount: session.notifiedDriverIds.size,
    rejectedCount: session.rejectedDriverIds.size,
    currentOfferedDriverId: null, // concurrent mode — no single offered driver
    elapsedMs: Date.now() - session.createdAt,
  };
}

/**
 * Get count of all active dispatches (for admin monitoring).
 */
export function getActiveDispatchCount(): number {
  return activeDispatches.size;
}

/**
 * Returns true if this driver currently holds an offer for this trip.
 * Used by socket accept handler to validate before doing DB write.
 */
export function isDriverCurrentlyOfferedTrip(tripId: string, driverId: string): boolean {
  const session = activeDispatches.get(tripId);
  if (!session) return true; // session gone → let DB guard decide
  return session.offeredDriverIds.has(driverId) || session.notifiedDriverIds.has(driverId);
}

/**
 * Get the current pending trip offer for a driver (for incoming-trip polling endpoint).
 */
export function getCurrentOfferedTripForDriver(driverId: string): { tripId: string; trip: Record<string, any> } | null {
  let match: DispatchSession | null = null;
  for (const session of Array.from(activeDispatches.values())) {
    if (session.status !== "broadcasting" && session.status !== "searching") continue;
    if (!session.offeredDriverIds.has(driverId)) continue;
    if (!match || session.createdAt > match.createdAt) {
      match = session;
    }
  }

  if (!match) return null;

  const meta = match.driverMeta.get(driverId);
  return {
    tripId: match.tripId,
    trip: {
      tripId: match.tripId,
      ...match.tripMeta,
      vehicleCategoryId: match.vehicleCategoryId || null,
      timeoutMs: match.config.driverTimeoutMs,
      aiScore: meta?.score ?? null,
      driverDistanceKm: meta?.distanceKm ?? null,
      scoreBreakdown: meta?.scoreBreakdown ?? null,
    },
  };
}

// ── Internal concurrent dispatch logic ──────────────────────────────────────

/**
 * Broadcast to all eligible drivers within the current radius step.
 * Starts a radius-level timer; on expiry, expands to next radius.
 */
async function broadcastToRadius(session: DispatchSession): Promise<void> {
  if (session.status === "accepted" || session.status === "cancelled" || session.status === "no_drivers" || session.status === "expired") return;

  const config = session.config;
  if (session.radiusIndex >= config.radiusStepsKm.length) {
    expireDispatch(session, "No pilots available nearby. Please try again.");
    return;
  }

  const radiusKm = config.radiusStepsKm[session.radiusIndex];

  // Exclude already-notified and rejected drivers
  const excludeIds = Array.from(new Set([
    ...Array.from(session.notifiedDriverIds),
    ...Array.from(session.rejectedDriverIds),
    session.customerId,
  ].filter(Boolean)));

  console.log(
    `[DISPATCH] Broadcasting radius ${radiusKm}km ` +
    `(step ${session.radiusIndex + 1}/${config.radiusStepsKm.length}) ` +
    `trip=${session.tripId} alreadyNotified=${session.notifiedDriverIds.size}`
  );

  try {
    // Verify trip is still searching in DB
    const tripCheck = await rawDb.execute(rawSql`
      SELECT current_status FROM trip_requests WHERE id=${session.tripId}::uuid
    `);
    const dbStatus = (tripCheck.rows[0] as any)?.current_status;
    if (!dbStatus || (dbStatus !== "searching" && dbStatus !== "driver_assigned")) {
      session.status = "cancelled";
      clearTimers(session);
      activeDispatches.delete(session.tripId);
      return;
    }

    // Find eligible drivers
    let drivers: DriverMatchScore[];
    if ((session.serviceType === "parcel" || session.serviceType === "b2b_parcel") && session.parcelVehicleCategory) {
      const parcelDrivers = await findParcelCapableDrivers(
        session.pickupLat,
        session.pickupLng,
        radiusKm,
        session.parcelVehicleCategory,
        excludeIds,
        config.driversPerStep
      );
      drivers = parcelDrivers.map((row: any) => {
        const distKm = Number(row.distance_km) || 99;
        const rating = Number(row.rating) || 3.0;
        const behaviorScore = Number(row.behavior_score) || 50;
        const scoreResult = scoreDriverForDispatch({ distanceKm: distKm, rating, behaviorScore, completionRate: 0.8, avgResponseTimeSec: 60 });
        return {
          driverId: row.id,
          fullName: row.full_name || "Pilot",
          phone: row.phone || "",
          lat: Number(row.lat),
          lng: Number(row.lng),
          distanceKm: Math.round(distKm * 100) / 100,
          rating: Math.round(rating * 10) / 10,
          totalTrips: 0,
          avgResponseTimeSec: 60,
          score: scoreResult.score,
          fcmToken: row.fcm_token || undefined,
          driverGender: row.gender ? String(row.gender).toLowerCase() : null,
          scoreBreakdown: scoreResult.scoreBreakdown,
        };
      });
      drivers.sort((a, b) => b.score - a.score);
      if (session.requirements.prioritizeFemaleDrivers) {
        drivers = sortDriversByGenderPriority(drivers, true) as DriverMatchScore[];
      }
    } else {
      drivers = await findDriversInRadius(
        session.pickupLat,
        session.pickupLng,
        radiusKm,
        session.requirements,
        excludeIds,
        config.driversPerStep
      );
    }

    console.log(
      `[DISPATCH_TRACE] trip=${session.tripId} pickup=${session.pickupLat},${session.pickupLng} ` +
      `radius=${radiusKm}km candidates=${drivers.length} ` +
      `matches=${drivers.map((d) => `${d.driverId}:${d.distanceKm}km@${d.lat},${d.lng}`).join(",") || "none"}`
    );

    // Re-check after awaits — a concurrent accept in another callback may have resolved the session.
    // Using includes() because TS narrows session.status from the early-exit guard above.
    if (["accepted", "cancelled"].includes(session.status)) return;

    // Re-rank with predictive acceptance probability
    if (drivers.length > 1) {
      try {
        const acceptRate = await getPlatformAcceptRate();
        drivers = await rerankWithPredictiveScoring(
          drivers, session.pickupLat, session.pickupLng, session.serviceType, acceptRate,
        );
      } catch (_) {}
    }

    if (drivers.length === 0) {
      // No new drivers at this radius — if existing offers are still outstanding, wait for them
      if (session.offeredDriverIds.size > 0) {
        console.log(`[DISPATCH] No new drivers at ${radiusKm}km for trip ${session.tripId} — waiting for ${session.offeredDriverIds.size} existing offers`);
        // Start timer to expand further when window expires
        scheduleRadiusExpansion(session);
        emitCustomerSearchStatus(session);
        return;
      }
      // No drivers at all at this radius — expand
      session.radiusIndex++;
      emitCustomerSearchStatus(session);
      await broadcastToRadius(session);
      return;
    }

    // Broadcast simultaneously to ALL eligible drivers
    await broadcastToAllDrivers(session, drivers);

    emitCustomerSearchStatus(session);

    // Schedule radius expansion after timeout (even if some drivers haven't responded)
    scheduleRadiusExpansion(session);

  } catch (err: any) {
    console.error(`[DISPATCH] Error broadcasting radius for trip ${session.tripId}:`, err.message);
    session.radiusIndex++;
    await broadcastToRadius(session);
  }
}

/**
 * Schedule automatic radius expansion after the broadcast window expires.
 */
function scheduleRadiusExpansion(session: DispatchSession): void {
  if (session.radiusTimer) {
    clearTimeout(session.radiusTimer);
    session.radiusTimer = null;
  }

  session.radiusTimer = setTimeout(async () => {
    session.radiusTimer = null;
    if (session.status === "accepted" || session.status === "cancelled" || session.status === "no_drivers" || session.status === "expired") return;

    // Mark any non-responding drivers as timed out
    const timedOutDrivers = Array.from(session.offeredDriverIds);
    for (const driverId of timedOutDrivers) {
      session.rejectedDriverIds.add(driverId);
      session.offeredDriverIds.delete(driverId);
      const offeredAt = session.offerStartedAt.get(driverId);
      const responseTimeSec = offeredAt ? Math.round((Date.now() - offeredAt) / 1000) : session.config.driverTimeoutMs / 1000;
      recordOfferOutcome(driverId, session.tripId, "timeout", responseTimeSec).catch(() => {});
      session.offerStartedAt.delete(driverId);
      if (io) {
        io.to(`user:${driverId}`).emit("trip:offer_timeout", { tripId: session.tripId });
      }
    }

    if (timedOutDrivers.length > 0) {
      console.log(`[DISPATCH] Radius ${session.config.radiusStepsKm[session.radiusIndex]}km timed out for trip ${session.tripId} — ${timedOutDrivers.length} drivers timed out`);
    }

    session.radiusIndex++;
    await broadcastToRadius(session);
  }, session.config.driverTimeoutMs);
}

/**
 * Send trip offer to ALL drivers simultaneously (concurrent broadcast).
 */
async function broadcastToAllDrivers(session: DispatchSession, drivers: DriverMatchScore[]): Promise<void> {
  session.status = "broadcasting";

  // Record broadcast metadata in DB (best-effort, for monitoring)
  const radiusKm = session.config.radiusStepsKm[Math.min(session.radiusIndex, session.config.radiusStepsKm.length - 1)];
  rawDb.execute(rawSql`
    UPDATE trip_requests
    SET offer_payload=${JSON.stringify({
      broadcastBatchSize: drivers.length,
      radiusKm,
      broadcastedAt: new Date().toISOString(),
      driverIds: drivers.map((d) => d.driverId),
    })}::jsonb,
        offer_expires_at=NOW() + (${Math.ceil(session.config.driverTimeoutMs / 1000)} * INTERVAL '1 second'),
        updated_at=NOW()
    WHERE id=${session.tripId}::uuid
      AND current_status='searching'
      AND driver_id IS NULL
  `).catch(() => {});

  const now = Date.now();

  // Send to all drivers in parallel
  await Promise.all(
    drivers.map(async (driver) => {
      if (session.status === "accepted" || session.status === "cancelled") return;

      // Skip already notified or rejected
      if (session.notifiedDriverIds.has(driver.driverId) || session.rejectedDriverIds.has(driver.driverId)) return;

      // findEligibleDriversForDispatch already ran comprehensive eligibility seconds ago —
      // re-checking per-driver would double DB load with no safety gain

      session.notifiedDriverIds.add(driver.driverId);
      session.offeredDriverIds.add(driver.driverId);
      session.offerStartedAt.set(driver.driverId, now);
      session.driverMeta.set(driver.driverId, {
        score: driver.score,
        distanceKm: driver.distanceKm,
        scoreBreakdown: driver.scoreBreakdown ?? null,
      });

      logDriverOffer(driver.driverId, session.tripId, session.pickupLat, session.pickupLng, session.serviceType).catch(() => {});

      const payload = {
        tripId: session.tripId,
        ...session.tripMeta,
        vehicleCategoryId: session.vehicleCategoryId || null,
        vehicleCategoryName: session.tripMeta.vehicleCategoryName || null,
        vehicleCategory: session.tripMeta.vehicleCategoryName || null,
        aiScore: driver.score,
        aiScoreBreakdown: driver.scoreBreakdown || null,
        driverDistanceKm: driver.distanceKm,
        timeoutMs: session.config.driverTimeoutMs,
      };

      // Socket notification
      if (io) {
        io.to(`user:${driver.driverId}`).emit("trip:new_request", payload);
      }

      // FCM notification (background/killed app)
      if (driver.fcmToken) {
        notifyDriverNewRide({
          fcmToken: driver.fcmToken,
          driverName: driver.fullName,
          customerName: session.tripMeta.customerName,
          pickupAddress: session.tripMeta.pickupAddress,
          destinationAddress: session.tripMeta.destinationAddress,
          estimatedFare: session.tripMeta.estimatedFare,
          estimatedDistance: session.tripMeta.estimatedDistance,
          tripId: session.tripId,
          vehicleCategoryId: session.vehicleCategoryId || null,
          vehicleCategoryName: session.tripMeta.vehicleCategoryName || null,
          timeoutMs: session.config.driverTimeoutMs,
        }).catch((err: any) => {
          // FCM failed — socket already notified; emit fallback for background apps
          if (io) {
            io.to(`user:${driver.driverId}`).emit("trip:new_request", { ...payload, _fcmFallback: true });
          }
          console.error(`[DISPATCH] FCM FAILED pilot=${driver.driverId} err=${err?.message || err}`);
        });
      }

      const socketRoom = io?.sockets?.adapter?.rooms?.get(`user:${driver.driverId}`);
      const socketConnected = !!(socketRoom && socketRoom.size > 0);
      console.log(
        `[DISPATCH] OFFERED trip=${session.tripId} pilot=${driver.driverId} (${driver.fullName}, ` +
        `${driver.distanceKm}km, score=${driver.score}) pickup=${session.pickupLat},${session.pickupLng} ` +
        `driver=${driver.lat},${driver.lng} socketOnline=${socketConnected} fcm=${Boolean(driver.fcmToken)}`
      );
    })
  );

  console.log(
    `[DISPATCH] ✅ BROADCAST COMPLETE trip=${session.tripId} radius=${radiusKm}km ` +
    `driversBroadcasted=${session.offeredDriverIds.size} totalNotified=${session.notifiedDriverIds.size}`
  );
}

/**
 * Expire/fail the dispatch session — no driver found.
 * Before giving up: retry once from radius step 0 after 45s.
 */
async function expireDispatch(session: DispatchSession, message: string): Promise<void> {
  if (session.status === "accepted" || session.status === "cancelled") return;

  const MAX_RETRIES = 1;
  if (session.retryCount < MAX_RETRIES) {
    session.retryCount++;
    session.radiusIndex = 0;
    session.status = "searching";
    session.notifiedDriverIds = new Set();
    session.offeredDriverIds = new Set();
    try {
      const tripR = await rawDb.execute(rawSql`
        SELECT rejected_driver_ids FROM trip_requests WHERE id=${session.tripId}::uuid LIMIT 1
      `);
      const dbRejected = (tripR.rows[0] as any)?.rejected_driver_ids;
      if (Array.isArray(dbRejected)) {
        session.rejectedDriverIds = new Set([
          ...Array.from(session.rejectedDriverIds),
          ...dbRejected.map((id: unknown) => String(id)).filter(Boolean),
        ]);
      }
    } catch (_) {}

    console.log(`[DISPATCH] No drivers found for trip ${session.tripId} — scheduling retry #${session.retryCount} in 45s`);
    emitCustomerSearchStatus(session);

    session.retryTimer = setTimeout(async () => {
      session.retryTimer = null;
      if (session.status !== "searching") return;
      console.log(`[DISPATCH] Retry #${session.retryCount} starting for trip ${session.tripId}`);
      await broadcastToRadius(session);
    }, 45000);
    return;
  }

  session.status = "no_drivers";
  clearTimers(session);

  if (io) {
    io.to(`user:${session.customerId}`).emit("trip:no_drivers", { tripId: session.tripId, message });
  }

  try {
    await rawDb.execute(rawSql`
      UPDATE trip_requests
      SET current_status='cancelled',
          cancel_reason=${message},
          cancelled_by='system',
          offered_driver_id=NULL,
          offer_expires_at=NULL,
          offer_payload=NULL,
          updated_at=NOW()
      WHERE id=${session.tripId}::uuid
        AND current_status IN ('searching', 'driver_assigned')
    `);
  } catch (err: any) {
    console.error(`[DISPATCH] Failed to cancel trip ${session.tripId}:`, err.message);
  }

  // Auto-refund if customer paid online
  try {
    const tripData = await rawDb.execute(rawSql`
      SELECT payment_status, customer_id FROM trip_requests
      WHERE id=${session.tripId}::uuid LIMIT 1
    `);
    const t = tripData.rows[0] as any;
    if (t?.payment_status === "paid_online" && t?.customer_id) {
      const atomicRefund = await rawDb.execute(rawSql`
        UPDATE customer_payments
        SET status='refunded', refunded_at=NOW()
        WHERE trip_id=${session.tripId}::uuid
          AND customer_id=${t.customer_id}::uuid
          AND payment_type='ride_payment'
          AND status='completed'
        RETURNING id, amount
      `);
      if (atomicRefund.rows.length) {
        const refundAmt = parseFloat((atomicRefund.rows[0] as any).amount);
        await applyWalletChange({
          userId: t.customer_id,
          amount: refundAmt,
          type: "CREDIT",
          reason: "no_driver_refund",
          refId: session.tripId,
          metadata: { reason: "No drivers available" },
        });
        await rawDb.execute(rawSql`
          UPDATE trip_requests SET payment_status='refunded_to_wallet'
          WHERE id=${session.tripId}::uuid
        `).catch(() => {});
        if (io) {
          io.to(`user:${session.customerId}`).emit("trip:refunded", {
            tripId: session.tripId,
            amount: refundAmt,
            reason: "No drivers available — full refund to wallet",
          });
        }
        console.log(`[DISPATCH-REFUND] ₹${refundAmt} auto-refunded — customer ${t.customer_id}, trip ${session.tripId}`);
      }
    }
  } catch (err: any) {
    console.error(`[DISPATCH-REFUND] Failed auto-refund for trip ${session.tripId}:`, err.message);
  }

  activeDispatches.delete(session.tripId);
  console.log(`[DISPATCH] Trip ${session.tripId} expired — ${message}`);
}

/**
 * Find drivers within a specific radius, sorted by AI score.
 */
async function findDriversInRadius(
  pickupLat: number,
  pickupLng: number,
  radiusKm: number,
  requirements: DispatchRequirements,
  excludeDriverIds: string[],
  limit: number
): Promise<DriverMatchScore[]> {
  console.log(`[DISPATCH] findDriversInRadius: lat=${pickupLat} lng=${pickupLng} radius=${radiusKm}km category=${requirements.vehicleCategoryId || "any"}`);
  const strictDrivers = await findEligibleDriversForDispatch({
    pickupLat,
    pickupLng,
    radiusKm,
    excludeDriverIds,
    limit,
    requirements,
  });

  if (!strictDrivers.length) {
    console.log(
      `[DISPATCH] Strict eligibility returned 0 drivers — ` +
      `service=${requirements.platformServiceKey || "unknown"} vehicle=${requirements.vehicleCategoryId || "any"}`
    );
    return [];
  }

  const scored: DriverMatchScore[] = strictDrivers.map((row: any) => {
    const distKm = Number(row.distanceKm) || 99;
    const rating = Number(row.rating) || 3.0;
    const avgResp = Number(row.avgResponseTimeSec) || 60;
    const behaviorScore = Number(row.behaviorScore) || 50;
    const completionRate = Number(row.completionRate) || 0.8;
    const scoreResult = scoreDriverForDispatch({
      distanceKm: distKm,
      rating,
      avgResponseTimeSec: avgResp,
      behaviorScore,
      completionRate,
      locationAgeSeconds: Number(row.locationAgeSeconds) || 0,
    });
    return {
      driverId: row.driverId,
      fullName: row.fullName || "Pilot",
      phone: row.phone || "",
      lat: Number(row.lat),
      lng: Number(row.lng),
      distanceKm: Math.round(distKm * 100) / 100,
      rating: Math.round(rating * 10) / 10,
      totalTrips: Number(row.totalTrips) || 0,
      avgResponseTimeSec: Math.round(avgResp),
      score: scoreResult.score,
      fcmToken: row.fcmToken || undefined,
      driverGender: row.driverGender || null,
      scoreBreakdown: scoreResult.scoreBreakdown,
    };
  });

  if (requirements.prioritizeFemaleDrivers) {
    scored.sort((a, b) => {
      const aF = String(a.driverGender || "").toLowerCase() === "female" ? 0 : 1;
      const bF = String(b.driverGender || "").toLowerCase() === "female" ? 0 : 1;
      if (aF !== bF) return aF - bF;
      return b.score - a.score;
    });
  } else {
    scored.sort((a, b) => b.score - a.score);
  }
  return scored;
}

/**
 * Emit search status update to the customer.
 */
function emitCustomerSearchStatus(session: DispatchSession): void {
  if (!io) return;
  const config = session.config;
  const currentRadius = config.radiusStepsKm[Math.min(session.radiusIndex, config.radiusStepsKm.length - 1)];

  io.to(`user:${session.customerId}`).emit("dispatch:status", {
    tripId: session.tripId,
    status: "searching",
    currentRadiusKm: currentRadius,
    radiusStep: Math.min(session.radiusIndex + 1, config.radiusStepsKm.length),
    totalRadiusSteps: config.radiusStepsKm.length,
    driversNotified: session.notifiedDriverIds.size,
    driversOffered: session.offeredDriverIds.size,
    message: "Looking for a pilot near you...",
  });

  io.to(`user:${session.customerId}`).emit("trip:searching", {
    tripId: session.tripId,
    message: "Looking for another pilot...",
  });
}

/**
 * Clear all timers for a dispatch session.
 */
function clearTimers(session: DispatchSession): void {
  if (session.radiusTimer) {
    clearTimeout(session.radiusTimer);
    session.radiusTimer = null;
  }
  if (session.totalTimer) {
    clearTimeout(session.totalTimer);
    session.totalTimer = null;
  }
  if (session.retryTimer) {
    clearTimeout(session.retryTimer);
    session.retryTimer = null;
  }
}

// ── Scheduled ride dispatch trigger ──────────────────────────────────────────

export function startScheduledRideDispatcher(): void {
  setInterval(async () => {
    recordHeartbeat("scheduledRideDispatcher");
    await withJobLock("scheduledRideDispatcher", async () => {
    try {
      const upcoming = await rawDb.execute(rawSql`
        SELECT t.id, t.customer_id, t.pickup_lat, t.pickup_lng,
               t.vehicle_category_id, t.trip_type, t.ref_id,
               t.pickup_address, t.destination_address,
               t.estimated_fare, t.estimated_distance, t.payment_method,
               t.pickup_short_name, t.destination_short_name,
               u.full_name as customer_name,
               vc.name as vehicle_category_name
        FROM trip_requests t
        JOIN users u ON u.id = t.customer_id
        LEFT JOIN vehicle_categories vc ON vc.id = t.vehicle_category_id
        WHERE t.current_status = 'scheduled'
          AND t.is_scheduled = true
          AND t.scheduled_at <= NOW() + INTERVAL '5 minutes'
          AND t.scheduled_at > NOW() - INTERVAL '10 minutes'
      `);

      for (const row of upcoming.rows) {
        const trip = row as any;
        if (activeDispatches.has(trip.id)) continue;

        await rawDb.execute(rawSql`
          UPDATE trip_requests SET current_status='searching', updated_at=NOW()
          WHERE id=${trip.id}::uuid AND current_status='scheduled'
        `);

        const serviceType = resolveServiceType(trip.trip_type, trip.vehicle_category_name);
        await startDispatch(
          trip.id,
          trip.customer_id,
          Number(trip.pickup_lat),
          Number(trip.pickup_lng),
          trip.vehicle_category_id,
          serviceType,
          {
            refId: trip.ref_id,
            customerName: trip.customer_name || "Customer",
            pickupAddress: trip.pickup_address || "",
            destinationAddress: trip.destination_address || "",
            pickupShortName: trip.pickup_short_name,
            destinationShortName: trip.destination_short_name,
            pickupLat: Number(trip.pickup_lat),
            pickupLng: Number(trip.pickup_lng),
            estimatedFare: Number(trip.estimated_fare) || 0,
            estimatedDistance: Number(trip.estimated_distance) || 0,
            paymentMethod: trip.payment_method || "cash",
            tripType: trip.trip_type || "normal",
            vehicleCategoryName: trip.vehicle_category_name || undefined,
          }
        );

        console.log(`[DISPATCH] Scheduled ride ${trip.id} activated for concurrent dispatch`);
      }
    } catch (err: any) {
      console.error("[DISPATCH] Scheduled ride dispatcher error:", err.message);
    }
    });
  }, 30000);

  console.log("[DISPATCH] Scheduled ride dispatcher started (30s interval)");
}

// ── Stale dispatch cleanup ───────────────────────────────────────────────────

export function startDispatchCleanup(): void {
  setInterval(() => {
    recordHeartbeat("dispatchCleanup");
    const now = Date.now();
    for (const [tripId, session] of Array.from(activeDispatches.entries())) {
      if (now - session.createdAt > 600000) {
        console.warn(`[DISPATCH] Cleaning up stale session trip=${tripId} age=${Math.round((now - session.createdAt) / 1000)}s`);
        session.status = "expired";
        clearTimers(session);
        activeDispatches.delete(tripId);
      }
    }
  }, 60000);

  console.log("[DISPATCH] Stale session cleanup started (60s interval)");
}

export async function restartDispatchForTrip(
  tripId: string,
  seedRejectedDriverIds: string[] = []
): Promise<void> {
  const tripR = await rawDb.execute(rawSql`
    SELECT
      t.id, t.customer_id, t.pickup_lat, t.pickup_lng,
      t.pickup_address, t.destination_address,
      t.pickup_short_name, t.destination_short_name,
      t.estimated_fare, t.estimated_distance,
      t.payment_method, t.trip_type, t.vehicle_category_id, t.ref_id,
      u.full_name as customer_name
    FROM trip_requests t
    JOIN users u ON u.id = t.customer_id
    WHERE t.id = ${tripId}::uuid
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  if (!tripR.rows.length) return;

  const trip = tripR.rows[0] as any;
  const requirements = await resolveDispatchRequirementsFromTrip(tripId);
  const serviceType = requirements?.dispatchServiceType || resolveServiceType(trip.trip_type, "");

  await startDispatch(
    tripId,
    trip.customer_id,
    Number(trip.pickup_lat) || 0,
    Number(trip.pickup_lng) || 0,
    trip.vehicle_category_id || undefined,
    serviceType,
    {
      refId: trip.ref_id || "",
      customerName: trip.customer_name || "Customer",
      pickupAddress: trip.pickup_address || "",
      destinationAddress: trip.destination_address || "",
      pickupShortName: trip.pickup_short_name || undefined,
      destinationShortName: trip.destination_short_name || undefined,
      pickupLat: Number(trip.pickup_lat) || 0,
      pickupLng: Number(trip.pickup_lng) || 0,
      estimatedFare: Number(trip.estimated_fare) || 0,
      estimatedDistance: Number(trip.estimated_distance) || 0,
      paymentMethod: trip.payment_method || "cash",
      tripType: trip.trip_type || "normal",
    },
    requirements?.parcelVehicleCategory || undefined,
    seedRejectedDriverIds
  );
}

// ── Orphaned dispatch recovery ────────────────────────────────────────────────

async function restartDispatchForTripRow(trip: any): Promise<void> {
  if (activeDispatches.has(trip.id)) return;
  const serviceType = resolveServiceType(trip.trip_type, trip.vehicle_category_name || "");
  await startDispatch(
    trip.id,
    trip.customer_id,
    Number(trip.pickup_lat) || 0,
    Number(trip.pickup_lng) || 0,
    trip.vehicle_category_id || undefined,
    serviceType,
    {
      refId: trip.ref_id || "",
      customerName: trip.customer_name || "Customer",
      pickupAddress: trip.pickup_address || "",
      destinationAddress: trip.destination_address || "",
      pickupShortName: trip.pickup_short_name || undefined,
      destinationShortName: trip.destination_short_name || undefined,
      pickupLat: Number(trip.pickup_lat) || 0,
      pickupLng: Number(trip.pickup_lng) || 0,
      estimatedFare: Number(trip.estimated_fare) || 0,
      estimatedDistance: Number(trip.estimated_distance) || 0,
      paymentMethod: trip.payment_method || "cash",
      tripType: trip.trip_type || "normal",
      vehicleCategoryName: trip.vehicle_category_name || undefined,
    },
  );
}

export async function recoverOrphanedSearchingTrips(): Promise<number> {
  const rows = await rawDb.execute(rawSql`
    SELECT t.id, t.customer_id, t.pickup_lat, t.pickup_lng, t.vehicle_category_id, t.trip_type,
           t.ref_id, t.pickup_address, t.destination_address, t.estimated_fare, t.estimated_distance,
           t.payment_method, t.pickup_short_name, t.destination_short_name,
           u.full_name as customer_name, vc.name as vehicle_category_name
    FROM trip_requests t
    JOIN users u ON u.id = t.customer_id
    LEFT JOIN vehicle_categories vc ON vc.id = t.vehicle_category_id
    WHERE t.current_status = 'searching'
      AND t.created_at > NOW() - INTERVAL '45 minutes'
  `).catch(() => ({ rows: [] as any[] }));

  let recovered = 0;
  for (const trip of rows.rows as any[]) {
    if (activeDispatches.has(trip.id)) continue;
    try {
      await restartDispatchForTripRow(trip);
      recovered++;
      console.log(`[DISPATCH] Recovered orphaned trip ${trip.id}`);
    } catch (err: any) {
      console.error(`[DISPATCH] Recovery failed for trip ${trip.id}:`, err?.message || err);
    }
  }
  return recovered;
}

export function startDispatchRecoveryLoop(): void {
  withJobLock("dispatchRecoveryLoop", () =>
    recoverOrphanedSearchingTrips().then(() => undefined)
  ).catch((err: any) => {
    console.error("[DISPATCH] Initial recovery pass failed:", err?.message || err);
  });
  setInterval(() => {
    recordHeartbeat("dispatchRecoveryLoop");
    withJobLock("dispatchRecoveryLoop", () =>
      recoverOrphanedSearchingTrips().then(() => undefined)
    ).catch((err: any) => {
      console.error("[DISPATCH] Recovery loop error:", err?.message || err);
    });
  }, 45000);
  console.log("[DISPATCH] Orphaned-trip recovery loop started (45s interval)");
}
