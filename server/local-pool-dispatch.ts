/**
 * Local Pool Dispatch Engine
 *
 * Responsibilities:
 *  - Notify nearby online drivers when a pool fills or its collection deadline fires
 *  - Expand search radius if no driver accepts in the first window
 *  - Cancel & refund passengers if no driver is found within the total timeout
 *  - Reaper job: handle collection-deadline expiry for partially-filled pools
 */

import { io } from "./socket";
import { rawDb, rawSql } from "./db";
import { sendFcmNotification } from "./fcm";

// ── Constants ────────────────────────────────────────────────────────────────

const INITIAL_RADIUS_KM = 5;
const EXPANDED_RADIUS_KM = 10;
const EXPAND_AFTER_MS = 2 * 60 * 1000;   // expand radius after 2 min
const TOTAL_TIMEOUT_MS = 10 * 60 * 1000; // cancel after 10 min
const REAPER_INTERVAL_MS = 45 * 1000;    // check expired pools every 45s
const MIN_PASSENGERS_TO_DISPATCH = 1;    // dispatch even with 1 passenger

// ── Session tracking ─────────────────────────────────────────────────────────

interface PoolDispatchSession {
  poolRideId: string;
  notifiedDriverIds: Set<string>;
  expandTimer: NodeJS.Timeout;
  totalTimer: NodeJS.Timeout;
}

const activeSessions = new Map<string, PoolDispatchSession>();

// ── Public API ────────────────────────────────────────────────────────────────

/** Call this when a pool ride enters 'dispatching' status. Idempotent. */
export async function triggerPoolDispatch(poolRideId: string): Promise<void> {
  if (activeSessions.has(poolRideId)) return;

  const ride = await fetchPoolRide(poolRideId);
  if (!ride) return;
  if (ride.driver_id) return; // already accepted

  const session: PoolDispatchSession = {
    poolRideId,
    notifiedDriverIds: new Set(),
    expandTimer: setTimeout(() => expandRadius(poolRideId), EXPAND_AFTER_MS),
    totalTimer: setTimeout(() => cancelPoolDispatch(poolRideId, true), TOTAL_TIMEOUT_MS),
  };
  activeSessions.set(poolRideId, session);

  console.log(`[POOL-DISPATCH] start poolRideId=${poolRideId}`);
  await notifyNearbyDrivers(poolRideId, session, INITIAL_RADIUS_KM);
}

/** Call this when a driver accepts (pool:accepted). Clears the session. */
export function onPoolAccepted(poolRideId: string): void {
  clearSession(poolRideId);
  console.log(`[POOL-DISPATCH] accepted poolRideId=${poolRideId}`);
}

/** Start the background reaper. Call once at server startup. */
export function startLocalPoolReaper(): void {
  setInterval(runReaper, REAPER_INTERVAL_MS);
  console.log("[POOL-DISPATCH] reaper started");
}

// ── Internals ────────────────────────────────────────────────────────────────

async function notifyNearbyDrivers(
  poolRideId: string,
  session: PoolDispatchSession,
  radiusKm: number,
): Promise<void> {
  const ride = await fetchPoolRide(poolRideId);
  if (!ride || ride.driver_id) {
    clearSession(poolRideId);
    return;
  }

  const drivers = await findNearbyDrivers(
    parseFloat(ride.pickup_lat),
    parseFloat(ride.pickup_lng),
    radiusKm,
    ride.vehicle_category_id,
    session.notifiedDriverIds,
  );

  if (drivers.length === 0) {
    console.log(`[POOL-DISPATCH] no new drivers within ${radiusKm}km poolRideId=${poolRideId}`);
    return;
  }

  const payload = {
    poolRideId,
    pickupAddress: ride.pickup_address || "Pickup",
    destinationAddress: ride.destination_address || "Destination",
    bookedSeats: parseInt(ride.booked_seats || "0"),
    maxSeats: parseInt(ride.max_seats || "4"),
    farePerSeat: parseFloat(ride.fare_per_seat || "0"),
    totalPoolFare: parseFloat(ride.fare_per_seat || "0") * parseInt(ride.booked_seats || "0"),
    distanceKm: parseFloat(ride.distance_km || "0"),
    pickupLat: parseFloat(ride.pickup_lat),
    pickupLng: parseFloat(ride.pickup_lng),
    expiresAt: ride.collection_deadline,
  };

  let notified = 0;
  for (const d of drivers) {
    session.notifiedDriverIds.add(d.id);

    // Socket (instant if driver app is connected)
    io.to(`user:${d.id}`).emit("pool:new_ride", payload);

    // FCM for background drivers
    const socketConnected = io?.sockets?.adapter?.rooms?.has(`user:${d.id}`);
    if (!socketConnected && d.fcm_token) {
      sendFcmNotification({
        fcmToken: d.fcm_token,
        title: "Pool Ride Available!",
        body: `${payload.bookedSeats}-seat pool near you — ₹${payload.totalPoolFare.toFixed(0)} total`,
        data: { type: "pool_new_ride", poolRideId },
      }).catch(() => undefined);
    }
    notified++;
  }

  console.log(`[POOL-DISPATCH] notified ${notified} drivers (radius ${radiusKm}km) poolRideId=${poolRideId}`);
}

async function expandRadius(poolRideId: string): Promise<void> {
  const session = activeSessions.get(poolRideId);
  if (!session) return;

  const ride = await fetchPoolRide(poolRideId);
  if (!ride || ride.driver_id) {
    clearSession(poolRideId);
    return;
  }

  console.log(`[POOL-DISPATCH] expanding radius to ${EXPANDED_RADIUS_KM}km poolRideId=${poolRideId}`);
  await notifyNearbyDrivers(poolRideId, session, EXPANDED_RADIUS_KM);
}

async function cancelPoolDispatch(poolRideId: string, timeout: boolean): Promise<void> {
  clearSession(poolRideId);
  const ride = await fetchPoolRide(poolRideId);
  if (!ride) return;
  if (ride.driver_id || ride.status === "completed" || ride.status === "cancelled") return;

  console.log(`[POOL-DISPATCH] cancelling poolRideId=${poolRideId} reason=${timeout ? "timeout" : "no_drivers"}`);

  // Cancel ride + passengers atomically — both must succeed or neither
  const client = await (await import("./db")).pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE local_pool_rides SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1::uuid AND driver_id IS NULL`,
      [poolRideId],
    );
    await client.query(
      `UPDATE local_pool_passengers SET status = 'cancelled', updated_at = NOW()
       WHERE pool_ride_id = $1::uuid AND status = 'booked'`,
      [poolRideId],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[POOL-DISPATCH] cancel transaction failed", (e as any)?.message);
    return;
  } finally {
    client.release();
  }

  // Fetch passengers to notify them
  const passR = await rawDb.execute(rawSql`
    SELECT customer_id FROM local_pool_passengers WHERE pool_ride_id = ${poolRideId}::uuid
  `).catch(() => ({ rows: [] as any[] }));

  const reason = timeout
    ? "No driver was available. Your booking has been cancelled — no payment was taken."
    : "Pool ride cancelled — no driver available nearby.";

  for (const p of passR.rows as any[]) {
    io.to(`user:${p.customer_id}`).emit("pool:cancelled", { poolRideId, reason });
  }
}

function clearSession(poolRideId: string): void {
  const s = activeSessions.get(poolRideId);
  if (!s) return;
  clearTimeout(s.expandTimer);
  clearTimeout(s.totalTimer);
  activeSessions.delete(poolRideId);
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function fetchPoolRide(poolRideId: string): Promise<any | null> {
  const r = await rawDb.execute(rawSql`
    SELECT * FROM local_pool_rides WHERE id = ${poolRideId}::uuid LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  return (r.rows[0] as any) || null;
}

async function findNearbyDrivers(
  lat: number,
  lng: number,
  radiusKm: number,
  vehicleCategoryId: string | null,
  excludeIds: Set<string>,
): Promise<{ id: string; fcm_token: string | null }[]> {
  const r = await rawDb.execute(rawSql`
    SELECT u.id, ud.fcm_token
    FROM users u
    JOIN driver_details dd ON dd.user_id = u.id
    LEFT JOIN user_devices ud ON ud.user_id = u.id
    WHERE u.is_active = true
      AND u.is_locked = false
      AND u.current_trip_id IS NULL
      AND COALESCE(dd.availability_status, 'offline') = 'online'
      AND u.current_lat IS NOT NULL
      AND u.current_lng IS NOT NULL
      AND (
        6371 * 2 * ASIN(SQRT(
          POWER(SIN((${lat} - u.current_lat::float) * PI()/360), 2) +
          COS(${lat} * PI()/180) * COS(u.current_lat::float * PI()/180) *
          POWER(SIN((${lng} - u.current_lng::float) * PI()/360), 2)
        ))
      ) <= ${radiusKm}
      ${vehicleCategoryId
        ? rawSql`AND dd.vehicle_category_id = ${vehicleCategoryId}::uuid`
        : rawSql``}
    ORDER BY (
      6371 * 2 * ASIN(SQRT(
        POWER(SIN((${lat} - u.current_lat::float) * PI()/360), 2) +
        COS(${lat} * PI()/180) * COS(u.current_lat::float * PI()/180) *
        POWER(SIN((${lng} - u.current_lng::float) * PI()/360), 2)
      ))
    ) ASC
    LIMIT 30
  `).catch(() => ({ rows: [] as any[] }));

  return (r.rows as any[]).filter(d => !excludeIds.has(d.id));
}

// ── Reaper ────────────────────────────────────────────────────────────────────

async function runReaper(): Promise<void> {
  try {
    // 1. collecting rides whose deadline just passed with passengers → dispatch them
    const readyR = await rawDb.execute(rawSql`
      SELECT lpr.id
      FROM local_pool_rides lpr
      WHERE lpr.status = 'collecting'
        AND lpr.collection_deadline <= NOW()
        AND lpr.driver_id IS NULL
        AND (SELECT COUNT(*) FROM local_pool_passengers WHERE pool_ride_id = lpr.id AND status = 'booked') >= ${MIN_PASSENGERS_TO_DISPATCH}
    `).catch(() => ({ rows: [] as any[] }));

    for (const row of readyR.rows as any[]) {
      const rideId = String(row.id);
      // CRITICAL FIX C11: Mark as dispatching, then fire dispatch; reset to 'collecting' on error
      await rawDb.execute(rawSql`
        UPDATE local_pool_rides SET status = 'dispatching', updated_at = NOW()
        WHERE id = ${rideId}::uuid AND status = 'collecting'
      `).catch(() => undefined);
      
      try {
        await triggerPoolDispatch(rideId);
      } catch (e: any) {
        console.error("[POOL-DISPATCH] reaper trigger error", e?.message);
        // Reset back so reaper retries on next cycle
        await rawDb.execute(rawSql`
          UPDATE local_pool_rides SET status = 'collecting', updated_at = NOW()
          WHERE id = ${rideId}::uuid AND status = 'dispatching' AND driver_id IS NULL
        `).catch(() => undefined);
      }
    }

    // 2. collecting rides whose deadline passed with 0 passengers → cancel silently
    await rawDb.execute(rawSql`
      UPDATE local_pool_rides SET status = 'cancelled', updated_at = NOW()
      WHERE status = 'collecting'
        AND collection_deadline <= NOW()
        AND booked_seats = 0
        AND driver_id IS NULL
    `).catch(() => undefined);

    // 3. dispatching rides that have been searching > TOTAL_TIMEOUT_MS with no driver → cancel
    // (Belt-and-suspenders: the session totalTimer should have already handled this, but
    //  protects against pod restarts losing in-memory state.)
    const timedOutR = await rawDb.execute(rawSql`
      SELECT id FROM local_pool_rides
      WHERE status = 'dispatching'
        AND driver_id IS NULL
        AND updated_at < NOW() - INTERVAL '${rawSql.raw(String(Math.ceil(TOTAL_TIMEOUT_MS / 1000)))} seconds'
    `).catch(() => ({ rows: [] as any[] }));

    for (const row of timedOutR.rows as any[]) {
      if (!activeSessions.has(String(row.id))) {
        // Session was lost (pod restart) — cancel immediately
        await cancelPoolDispatch(String(row.id), true);
      }
    }
  } catch (e: any) {
    console.error("[POOL-DISPATCH] reaper error", e?.message);
  }
}
