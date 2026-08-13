/**
 * Anti-fraud detection service.
 *
 * Checks (all sync hot-path, async DB log):
 *
 * 1. Speed fraud      — reported GPS speed > 120 km/h
 * 2. GPS jump fraud   — position teleports > 2km in < 15s
 * 3. No-movement      — trip in_progress but driver < 50m movement for 3+ min
 * 4. Cancel abuse     — customer > 4 cancellations within 1 hour
 *
 * All checks are non-blocking: return bool instantly, log to system_logs async.
 * In-memory maps hold last-known state for O(1) per-event checks.
 * Memory is pruned every 15 min to prevent unbounded growth.
 */

import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";

// ── Haversine (inline — no import needed) ────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── DB log helper ────────────────────────────────────────────────────────────

function logFraudFlag(tag: string, message: string, details: Record<string, unknown>): void {
  rawDb.execute(rawSql`
    INSERT INTO system_logs (level, tag, message, details)
    VALUES ('warn', ${tag}, ${message}, ${JSON.stringify(details)}::jsonb)
  `).catch(() => { });
}

// ── 1. Speed fraud ────────────────────────────────────────────────────────────

const MAX_SPEED_KMH = 120;

/**
 * Returns true if the reported speed is physically impossible for road travel.
 * NOTE: speed from GPS can spike briefly — callers should debounce before acting.
 */
export function checkSpeedFraud(
  driverId: string,
  speedKmh: number,
  tripId?: string | null,
): boolean {
  if (!isFinite(speedKmh) || speedKmh <= MAX_SPEED_KMH) return false;
  logFraudFlag("FRAUD_SPEED", `Speed anomaly: ${speedKmh.toFixed(0)} km/h`, {
    driverId, speedKmh, tripId: tripId ?? null,
  });
  return true;
}

// ── 2. GPS jump fraud ─────────────────────────────────────────────────────────

interface LocationRecord { lat: number; lng: number; ts: number }

const driverLastLocation = new Map<string, LocationRecord>();

const MAX_JUMP_KM = 2.0;
const MIN_JUMP_INTERVAL_MS = 15_000; // jump must happen in < 15s to be suspicious

/**
 * Returns true if the driver's position jumped impossibly far since last update.
 * Always updates internal last-known position.
 */
export function checkGpsJumpFraud(driverId: string, lat: number, lng: number): boolean {
  const now = Date.now();
  const prev = driverLastLocation.get(driverId);
  driverLastLocation.set(driverId, { lat, lng, ts: now });

  if (!prev) return false;
  const elapsedMs = now - prev.ts;
  if (elapsedMs >= MIN_JUMP_INTERVAL_MS) return false; // normal gap, not a teleport

  const distKm = haversineKm(prev.lat, prev.lng, lat, lng);
  if (distKm <= MAX_JUMP_KM) return false;

  logFraudFlag("FRAUD_GPS_JUMP", `Position jump: ${distKm.toFixed(2)}km in ${elapsedMs}ms`, {
    driverId, distKm: +distKm.toFixed(3), elapsedMs,
    from: { lat: prev.lat, lng: prev.lng },
    to: { lat, lng },
  });
  return true;
}

export function clearDriverLocationState(driverId: string): void {
  driverLastLocation.delete(driverId);
}

// ── 3. No-movement during trip ────────────────────────────────────────────────

interface MovementRecord {
  lat: number;
  lng: number;
  firstSeenTs: number;
  lastMovedTs: number;
  flaggedAt: number | null; // last time we emitted a flag (prevents log spam)
}

const tripMovementState = new Map<string, MovementRecord>();

const NO_MOVEMENT_STALL_MS = 3 * 60 * 1000;  // 3 min without 50m movement
const NO_MOVEMENT_MIN_KM = 0.05;              // 50 metres
const NO_MOVEMENT_FLAG_COOLDOWN_MS = 5 * 60 * 1000; // re-flag at most every 5 min

/**
 * Returns true if driver hasn't moved during an active trip for too long.
 * Must be called on every driver:location event while trip is in_progress.
 */
export function checkTripNoMovement(
  tripId: string,
  driverId: string,
  lat: number,
  lng: number,
): boolean {
  const now = Date.now();
  const state = tripMovementState.get(tripId);

  if (!state) {
    tripMovementState.set(tripId, {
      lat, lng, firstSeenTs: now, lastMovedTs: now, flaggedAt: null,
    });
    return false;
  }

  const movedKm = haversineKm(state.lat, state.lng, lat, lng);
  if (movedKm >= NO_MOVEMENT_MIN_KM) {
    tripMovementState.set(tripId, { ...state, lat, lng, lastMovedTs: now });
    return false;
  }

  const stallMs = now - state.lastMovedTs;
  if (stallMs < NO_MOVEMENT_STALL_MS) return false;

  // Cooldown so we don't spam on every location update
  if (state.flaggedAt && now - state.flaggedAt < NO_MOVEMENT_FLAG_COOLDOWN_MS) return false;

  tripMovementState.set(tripId, { ...state, flaggedAt: now });
  logFraudFlag("FRAUD_NO_MOVEMENT", `Driver stalled ${(stallMs / 60000).toFixed(1)} min during trip`, {
    driverId, tripId, stallMinutes: +(stallMs / 60000).toFixed(2), lat, lng,
  });
  return true;
}

export function clearTripMovementState(tripId: string): void {
  tripMovementState.delete(tripId);
}

// ── 4. Cancellation abuse ─────────────────────────────────────────────────────

const CANCEL_WINDOW_MS = 60 * 60 * 1000; // 1 hour rolling window
const CANCEL_LIMIT = 4;                   // block on the 5th cancel within window

const customerCancelLog = new Map<string, number[]>();

/** Record a customer cancellation event. Call when customer cancels a trip. */
export function recordCustomerCancellation(customerId: string): void {
  const now = Date.now();
  const existing = customerCancelLog.get(customerId) ?? [];
  const recent = existing.filter(ts => now - ts < CANCEL_WINDOW_MS);
  recent.push(now);
  customerCancelLog.set(customerId, recent);
}

/**
 * Returns true if customer has exceeded the cancellation limit.
 * Call before allowing a new booking to enforce the soft block.
 */
export function isCustomerCancellationBlocked(customerId: string): boolean {
  const now = Date.now();
  const log = customerCancelLog.get(customerId) ?? [];
  const recent = log.filter(ts => now - ts < CANCEL_WINDOW_MS);
  if (recent.length < CANCEL_LIMIT) return false;

  logFraudFlag("FRAUD_CANCEL_ABUSE", `Cancel abuse: ${recent.length} cancels in 1hr`, {
    customerId, cancelCount: recent.length,
  });
  return true;
}

export function getCustomerCancelCount(customerId: string): number {
  const now = Date.now();
  const log = customerCancelLog.get(customerId) ?? [];
  return log.filter(ts => now - ts < CANCEL_WINDOW_MS).length;
}

// ── Memory housekeeping ───────────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();

  Array.from(driverLastLocation.entries()).forEach(([id, loc]) => {
    if (now - loc.ts > 10 * 60 * 1000) driverLastLocation.delete(id);
  });

  Array.from(tripMovementState.entries()).forEach(([tripId, state]) => {
    if (now - state.firstSeenTs > 4 * 60 * 60 * 1000) tripMovementState.delete(tripId);
  });

  Array.from(customerCancelLog.entries()).forEach(([id, log]) => {
    const recent = log.filter((ts: number) => now - ts < CANCEL_WINDOW_MS);
    if (recent.length === 0) customerCancelLog.delete(id);
    else customerCancelLog.set(id, recent);
  });
}, 15 * 60 * 1000);
