/**
 * Outstation Pool V2 — Distance-Proportional Segment Fare Engine
 *
 * Example: Driver posts VJA → HYD (300km), ₹1.8/km/seat
 *   Passenger A: VJA → HYD = 300km × 1.8 = ₹540/seat
 *   Passenger B: VJA → GNT = 90km × 1.8  = ₹162/seat  (joins + exits midway)
 *   Passenger C: GNT → HYD = 210km × 1.8 = ₹378/seat  (joins at Guntur)
 *
 * Revenue settled per-drop. Driver picks up/drops each passenger individually.
 * Full segment freedom — any pickup/drop along the route within tolerance.
 */

import type { Express } from "express";
import { rawDb, rawSql, pool as dbPool } from "./db";
import { io } from "./socket";
import { recomputeUserRating } from "./ratings";
import { calculateRevenueBreakdown } from "./revenue-engine";
import { enqueuePoolSettlement, processPoolSettlement } from "./pool-settlement";
import { enforceDriverRevenuePolicy } from "./revenue-policy";
import { sendFcmNotification } from "./fcm";
import { assertSchemaObjectsOrThrow } from "./schema-health";
import { getMatchingDriverCategoryIds } from "./vehicle-matching";

// ── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_PRICE_PER_KM_PER_SEAT = 1.8;   // ₹1.8/km/seat
export const MIN_FARE_PER_BOOKING = 50;              // minimum ₹50 per booking
const ROUTE_CORRIDOR_KM = 15;                 // pickup/drop must be within 15km of route line
const DIRECTION_TOLERANCE_DEG = 45;           // bearing tolerance for "on route" check

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

function buildPoolRealtimePayload(module: string, referenceId: string, extra: Record<string, unknown> = {}) {
  return {
    module,
    referenceId,
    ...extra,
  };
}

function normalizePoolKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isPoolVehicleCategory(row: any): boolean {
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

// ── Schema migration (safe — all IF NOT EXISTS / ADD COLUMN IF NOT EXISTS) ──

export async function ensureOutstationPoolV2Schema(): Promise<void> {
  await assertSchemaObjectsOrThrow({
    tables: ["outstation_pool_rides", "outstation_pool_bookings", "pool_issue_cases", "pool_messages", "pool_ratings", "pool_user_blocks"],
  });

  console.log("[OUTSTATION-V2] Schema verified");
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

function getRefundPctForDeparture(rideStatus: string, beforeDeparturePct: number, afterDeparturePct: number) {
  return rideStatus === "scheduled" ? beforeDeparturePct : afterDeparturePct;
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
      detail: eligible ? "Operations verifies departure timing and payment mode." : "Skipped because refund is not applicable.",
    },
    {
      title: "Refund settlement",
      state: refundStatus === "completed" ? "done" : eligible ? "pending" : "skipped",
      detail: eligible ? "Amount is credited to wallet or original payment channel." : "No settlement required.",
    },
  ];
}

function normalizeIssueStatus(value: unknown) {
  const status = String(value || "open").toLowerCase();
  if (status === "resolved" || status === "rejected" || status === "under_review") return status;
  return "open";
}

function parseJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function buildIssueTimeline(issue: any) {
  const adminUpdates = parseJsonArray(issue?.admin_updates);
  const createdAt = issue?.created_at ? new Date(issue.created_at).toISOString() : new Date().toISOString();
  const updatedAt = issue?.updated_at ? new Date(issue.updated_at).toISOString() : createdAt;
  const currentStatus = normalizeIssueStatus(issue?.status);
  const baseTimeline = [
    {
      key: "open",
      title: "Open",
      state: "done",
      timestamp: createdAt,
      note: issue?.description || "Issue raised by customer.",
    },
    {
      key: "under_review",
      title: "Under Review",
      state: currentStatus === "under_review" || currentStatus === "resolved" || currentStatus === "rejected" ? "done" : "pending",
      timestamp: adminUpdates.find((entry: any) => normalizeIssueStatus(entry?.status) === "under_review")?.createdAt || null,
      note: "Operations is reviewing the submitted evidence and trip records.",
    },
    {
      key: "resolved",
      title: "Resolved",
      state: currentStatus === "resolved" ? "done" : "pending",
      timestamp: currentStatus === "resolved" ? updatedAt : null,
      note: issue?.resolution_note || "Awaiting resolution.",
    },
    {
      key: "rejected",
      title: "Rejected",
      state: currentStatus === "rejected" ? "done" : "pending",
      timestamp: currentStatus === "rejected" ? updatedAt : null,
      note: issue?.resolution_note || "Awaiting final decision.",
    },
  ];
  return {
    status: currentStatus,
    stages: baseTimeline,
    adminUpdates: adminUpdates.map((entry: any) => ({
      message: entry?.message || "",
      status: normalizeIssueStatus(entry?.status),
      author: entry?.author || "Operations",
      createdAt: entry?.createdAt || updatedAt,
    })),
  };
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

// ── Geo helpers ───────────────────────────────────────────────────────────────

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const f1 = lat1 * Math.PI / 180, f2 = lat2 * Math.PI / 180;
  const dl = (lng2 - lng1) * Math.PI / 180;
  return ((Math.atan2(
    Math.sin(dl) * Math.cos(f2),
    Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl),
  ) * 180 / Math.PI) + 360) % 360;
}

function bearingDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Distance from point P to line segment A→B (in km).
 * Used to check if a customer's pickup/drop is "on the route corridor".
 */
function pointToSegmentDistKm(
  pLat: number, pLng: number,
  aLat: number, aLng: number,
  bLat: number, bLng: number,
): number {
  const abKm = haversineKm(aLat, aLng, bLat, bLng);
  if (abKm < 0.001) return haversineKm(pLat, pLng, aLat, aLng);

  // Project point onto line using dot product approximation (flat-earth ok for <500km)
  const t = Math.max(0, Math.min(1,
    ((pLat - aLat) * (bLat - aLat) + (pLng - aLng) * (bLng - aLng)) /
    ((bLat - aLat) ** 2 + (bLng - aLng) ** 2),
  ));
  const projLat = aLat + t * (bLat - aLat);
  const projLng = aLng + t * (bLng - aLng);
  return haversineKm(pLat, pLng, projLat, projLng);
}

/**
 * Is this pickup/drop point "on" the route from (aLat,aLng) to (bLat,bLng)?
 * Checks corridor distance AND that it lies within the route extent.
 */
function isOnRoute(
  pLat: number, pLng: number,
  fromLat: number, fromLng: number,
  toLat: number, toLng: number,
): boolean {
  // Must be within corridor
  const corridorDist = pointToSegmentDistKm(pLat, pLng, fromLat, fromLng, toLat, toLng);
  if (corridorDist > ROUTE_CORRIDOR_KM) return false;

  // Must be between the two endpoints (not before from or after to)
  const totalKm = haversineKm(fromLat, fromLng, toLat, toLng);
  const fromToPoint = haversineKm(fromLat, fromLng, pLat, pLng);
  return fromToPoint <= totalKm + ROUTE_CORRIDOR_KM;
}

/**
 * Is pickup BEFORE drop along the route direction?
 * Pickup must be closer to `from` than drop is.
 */
function pickupBeforeDrop(
  pickupLat: number, pickupLng: number,
  dropLat: number, dropLng: number,
  fromLat: number, fromLng: number,
): boolean {
  const fromToPickup = haversineKm(fromLat, fromLng, pickupLat, pickupLng);
  const fromToDrop   = haversineKm(fromLat, fromLng, dropLat, dropLng);
  return fromToPickup < fromToDrop;
}

// ── Fare calculation ──────────────────────────────────────────────────────────

export function calcSegmentFare(segmentKm: number, seats: number, pricePerKmPerSeat: number): {
  farePerSeat: number;
  totalFare: number;
  segmentKm: number;
} {
  const rawPerSeat = Math.max(MIN_FARE_PER_BOOKING, pricePerKmPerSeat * segmentKm);
  const farePerSeat = Math.round(rawPerSeat * 100) / 100;
  return {
    farePerSeat,
    totalFare: Math.round(farePerSeat * seats * 100) / 100,
    segmentKm: Math.round(segmentKm * 100) / 100,
  };
}

// ENFORCE ADMIN FARE CAPS: clamps a driver-supplied price-per-km-per-seat into the
// admin-configured [min, max] range (revenue_model_settings). Shared by every entry
// point that lets a driver set this rate, so the cap can't be bypassed via a
// different endpoint.
export async function applyOutstationPriceCaps(pricePerKmPerSeat: number): Promise<number> {
  let pkmps = pricePerKmPerSeat;
  const opSettingsR = await rawDb.execute(rawSql`
    SELECT key_name, value FROM revenue_model_settings
    WHERE key_name IN ('outstation_pool_min_price_per_km_per_seat', 'outstation_pool_max_price_per_km_per_seat')
  `).catch(() => ({ rows: [] as any[] }));
  const opSettings: Record<string, string> = {};
  (opSettingsR.rows as any[]).forEach((r: any) => { opSettings[r.key_name] = r.value; });
  const minPkmps = parseFloat(opSettings.outstation_pool_min_price_per_km_per_seat || '');
  const maxPkmps = parseFloat(opSettings.outstation_pool_max_price_per_km_per_seat || '');
  if (Number.isFinite(minPkmps) && pkmps < minPkmps) pkmps = minPkmps;
  if (Number.isFinite(maxPkmps) && pkmps > maxPkmps) pkmps = maxPkmps;
  return pkmps;
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerOutstationPoolV2Routes(app: Express, authApp: any, requireAdminAuth?: any): void {
  const adminAuth = requireAdminAuth ?? ((_req: any, res: any) => res.status(401).json({ message: "Admin authentication not configured" }));

  // ─── DRIVER: Post a trip WITH coordinates + price_per_km ─────────────────
  // Replaces the old flat fare_per_seat model. Both are stored.

  app.post("/api/app/driver/outstation-pool/v2/rides", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const {
        fromCity, toCity,
        fromLat, fromLng, toLat, toLng,
        departureDate, departureTime,
        totalSeats = 4,
        pricePerKmPerSeat,
        vehicleNumber, vehicleModel, note,
      } = req.body;

      if (!fromCity || !toCity) return res.status(400).json({ message: "fromCity and toCity required" });
      if (!fromLat || !fromLng || !toLat || !toLng) {
        return res.status(400).json({ message: "from/to coordinates required" });
      }

      const fromLatN = parseFloat(fromLat);
      const fromLngN = parseFloat(fromLng);
      const toLatN   = parseFloat(toLat);
      const toLngN   = parseFloat(toLng);
      const routeKm  = haversineKm(fromLatN, fromLngN, toLatN, toLngN);
      let pkmps = parseFloat(String(pricePerKmPerSeat)) || DEFAULT_PRICE_PER_KM_PER_SEAT;
      pkmps = await applyOutstationPriceCaps(pkmps);

      const driverCategoryR = await rawDb.execute(rawSql`
        SELECT
          dd.vehicle_category_id,
          dd.intercity_enabled,
          vc.id,
          vc.name,
          vc.type,
          vc.service_type,
          vc.vehicle_type,
          vc.is_carpool,
          vc.total_seats
        FROM driver_details dd
        LEFT JOIN vehicle_categories vc ON vc.id = dd.vehicle_category_id
        WHERE dd.user_id = ${driver.id}::uuid
        LIMIT 1
      `).catch(() => ({ rows: [] as any[] }));
      const driverCategory = driverCategoryR.rows[0] as any;
      if (!isPoolVehicleCategory(driverCategory)) {
        return res.status(403).json({
          message: "Only approved pool-enabled drivers can create outstation pool rides",
          code: "OUTSTATION_POOL_DRIVER_NOT_ELIGIBLE",
        });
      }
      // Additional per-driver capability, independent of the category-level
      // pool eligibility above — see the identical gate in
      // outstation-pool-matcher.ts's /availability endpoint.
      if (driverCategory?.intercity_enabled !== true) {
        return res.status(403).json({
          message: "Enable Intercity on your vehicle to create outstation pool rides",
          code: "INTERCITY_NOT_ENABLED",
        });
      }
      try {
        await enforceDriverRevenuePolicy(driver.id, "outstation");
      } catch (policyErr: any) {
        return res.status(policyErr.statusCode || 403).json({
          message: policyErr.message || "Subscription required for outstation pool service",
          code: policyErr.code || "SUBSCRIPTION_REQUIRED",
          moduleName: "outstation",
        });
      }
      // P1: financial auto-lock enforcement (same is_locked flag Ride/Parcel/
      // Local Pool dispatch already excludes locked drivers on - Outstation
      // Pool has its own driver-initiated ride creation instead of a
      // dispatch-matching query, so the check runs here instead).
      const lockR = await rawDb.execute(rawSql`SELECT is_locked, lock_reason FROM users WHERE id=${driver.id}::uuid LIMIT 1`).catch(() => ({ rows: [] as any[] }));
      if ((lockR.rows[0] as any)?.is_locked) {
        return res.status(403).json({
          message: (lockR.rows[0] as any).lock_reason || "Account locked. Please recharge wallet to continue.",
          code: "ACCOUNT_LOCKED",
          isLocked: true,
        });
      }

      const requestedSeats = Math.min(Math.max(parseInt(String(totalSeats)) || 4, 1), 8);
      const categorySeats = parseInt(String(driverCategory?.total_seats || 0));
      const seats = categorySeats > 0 ? Math.min(requestedSeats, categorySeats) : requestedSeats;
      // Legacy fare_per_seat = full-route fare for reference
      const farePerSeat = Math.round(Math.max(MIN_FARE_PER_BOOKING, pkmps * routeKm) * 100) / 100;

      const r = await rawDb.execute(rawSql`
        INSERT INTO outstation_pool_rides
          (driver_id, vehicle_category_id, from_city, to_city, from_lat, from_lng, to_lat, to_lng,
           route_km, departure_date, departure_time,
           total_seats, available_seats, vehicle_number, vehicle_model,
           fare_per_seat, price_per_km_per_seat, note, status, is_active)
        VALUES
          (${driver.id}::uuid,
           ${String(driverCategory.vehicle_category_id || driverCategory.id)}::uuid,
           ${fromCity}, ${toCity},
           ${fromLatN}, ${fromLngN}, ${toLatN}, ${toLngN},
           ${routeKm}, ${departureDate || null}, ${departureTime || null},
           ${seats}, ${seats}, ${vehicleNumber || null}, ${vehicleModel || null},
           ${farePerSeat}, ${pkmps}, ${note || null}, 'scheduled', true)
        RETURNING *
      `);

      res.json({
        success: true,
        ride: r.rows[0],
        info: {
          routeKm: Math.round(routeKm),
          pricePerKmPerSeat: pkmps,
          fullRouteFarePerSeat: farePerSeat,
          example: `VJA→halfway = ₹${Math.round(farePerSeat * 0.5)}/seat`,
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── DRIVER: Start the trip (mark as active, set current location) ────────

  app.get("/api/app/driver/outstation-pool/rides/:id/passengers", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const rideId = String(req.params.id);
      const ownRide = await rawDb.execute(rawSql`
        SELECT id FROM outstation_pool_rides
        WHERE id=${rideId}::uuid AND driver_id=${driver.id}::uuid
        LIMIT 1
      `);
      if (!ownRide.rows.length) return res.status(404).json({ message: "Ride not found" });

      const r = await rawDb.execute(rawSql`
        SELECT opb.*,
          u.full_name as passenger_name,
          u.phone as passenger_phone,
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
        FROM outstation_pool_bookings opb
        LEFT JOIN users u ON u.id = opb.customer_id
        WHERE opb.ride_id=${rideId}::uuid
          AND opb.status != 'cancelled'
        ORDER BY COALESCE(opb.pickup_order, 1), opb.created_at ASC
      `);
      res.json({
        passengers: (r.rows as any[]).map((row) => ({
          ...row,
          safety: buildUserSafetySnapshot(row),
        })),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/app/driver/outstation-pool/rides/:id/start", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const rideId = String(req.params.id);
      const { lat, lng } = req.body || {};

      const r = await rawDb.execute(rawSql`
        UPDATE outstation_pool_rides
        SET status = 'active',
            current_lat = ${lat ? parseFloat(lat) : null},
            current_lng = ${lng ? parseFloat(lng) : null},
            updated_at = NOW()
        WHERE id = ${rideId}::uuid AND driver_id = ${driver.id}::uuid AND status = 'scheduled'
        RETURNING id
      `);
      if (!r.rows.length) return res.status(404).json({ message: "Ride not found or already started" });

      // Notify all confirmed passengers
      const bookingsR = await rawDb.execute(rawSql`
        SELECT customer_id FROM outstation_pool_bookings
        WHERE ride_id = ${rideId}::uuid AND status = 'confirmed'
      `).catch(() => ({ rows: [] as any[] }));
      for (const b of bookingsR.rows as any[]) {
        io.to(`user:${b.customer_id}`).emit("outstation_pool:trip_started", {
          rideId,
          message: "Your driver has started the trip! Get ready for pickup.",
        });
        void sendPoolPush(
          String(b.customer_id),
          "Pool trip started",
          "Your driver has started the outstation pool trip.",
          {
            type: "pool_booking_confirmed",
            module: "outstation_pool",
            referenceId: rideId,
            rideId,
          },
        );
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── DRIVER: Update location (broadcast to all passengers in this ride) ───

  app.post("/api/app/driver/outstation-pool/rides/:id/accepting", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const rideId = String(req.params.id);
      const accepting = req.body?.acceptingNewRequests !== false;
      const r = await rawDb.execute(rawSql`
        UPDATE outstation_pool_rides
        SET accepting_new_requests = ${accepting},
            state_version = state_version + 1,
            updated_at = NOW()
        WHERE id = ${rideId}::uuid
          AND driver_id = ${driver.id}::uuid
          AND status IN ('scheduled', 'active')
        RETURNING id, accepting_new_requests, state_version
      `);
      if (!r.rows.length) return res.status(404).json({ message: "Ride not found or already closed" });
      const row = r.rows[0] as any;
      const passengersR = await rawDb.execute(rawSql`
        SELECT customer_id FROM outstation_pool_bookings
        WHERE ride_id = ${rideId}::uuid AND status IN ('confirmed', 'picked_up')
      `).catch(() => ({ rows: [] as any[] }));
      for (const p of passengersR.rows as any[]) {
        io.to(`user:${p.customer_id}`).emit("outstation_pool:seat_update", {
          rideId,
          acceptingNewRequests: row.accepting_new_requests !== false,
          stateVersion: parseInt(row.state_version || 1),
        });
        void sendPoolPush(
          String(p.customer_id),
          "Pool seat update",
          row.accepting_new_requests !== false
            ? "This ride is accepting new pool bookings."
            : "This ride stopped accepting new pool bookings.",
          {
            type: "pool_seat_update",
            module: "outstation_pool",
            referenceId: rideId,
            rideId,
            acceptingNewRequests: String(row.accepting_new_requests !== false),
            stateVersion: String(parseInt(row.state_version || 1)),
          },
        );
      }
      res.json({ success: true, acceptingNewRequests: row.accepting_new_requests !== false, stateVersion: parseInt(row.state_version || 1) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/app/driver/outstation-pool/rides/:id/location", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const rideId = String(req.params.id);
      const { lat, lng } = req.body;
      const latN = parseFloat(lat);
      const lngN = parseFloat(lng);
      if (!lat || !lng || !isFinite(latN) || !isFinite(lngN) ||
          latN < -90 || latN > 90 || lngN < -180 || lngN > 180) {
        return res.status(400).json({ message: "Valid lat/lng required" });
      }

      await rawDb.execute(rawSql`
        UPDATE outstation_pool_rides
        SET current_lat = ${latN}, current_lng = ${lngN}, updated_at = NOW()
        WHERE id = ${rideId}::uuid AND driver_id = ${driver.id}::uuid AND status = 'active'
      `);

      // Broadcast to all active passengers
      const passR = await rawDb.execute(rawSql`
        SELECT customer_id FROM outstation_pool_bookings
        WHERE ride_id = ${rideId}::uuid AND status IN ('confirmed', 'picked_up')
      `).catch(() => ({ rows: [] as any[] }));
      for (const p of passR.rows as any[]) {
        io.to(`user:${p.customer_id}`).emit("outstation_pool:driver_location", {
          rideId, lat: latN, lng: lngN,
        });
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── DRIVER: Pick up a passenger ─────────────────────────────────────────

  app.post("/api/app/driver/outstation-pool/passengers/:bookingId/pickup", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const bookingId = String(req.params.bookingId);

      const r = await rawDb.execute(rawSql`
        UPDATE outstation_pool_bookings opb
        SET status = 'picked_up', picked_up_at = NOW(), updated_at = NOW()
        FROM outstation_pool_rides opr
        WHERE opb.id = ${bookingId}::uuid
          AND opb.ride_id = opr.id
          AND opr.driver_id = ${driver.id}::uuid
          AND opr.status = 'active'
          AND opb.status = 'confirmed'
        RETURNING opb.customer_id, opb.dropoff_address, opb.to_city
      `);
      if (!r.rows.length) return res.status(404).json({ message: "Booking not found or not in confirmed state" });

      const booking = r.rows[0] as any;
      io.to(`user:${booking.customer_id}`).emit("outstation_pool:picked_up", {
        bookingId,
        message: `You've been picked up! Drop: ${booking.dropoff_address || booking.to_city}`,
      });
      void sendPoolPush(
        String(booking.customer_id),
        "Pool pickup confirmed",
        "You have been picked up for your outstation pool trip.",
        {
          type: "pool_booking_confirmed",
          module: "outstation_pool",
          referenceId: bookingId,
          bookingId,
          status: "picked_up",
        },
      );

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── DRIVER: Drop a passenger + settle per-booking fare ──────────────────

  app.post("/api/app/driver/outstation-pool/passengers/:bookingId/drop", authApp, async (req: any, res: any) => {
    const driver = req.currentUser;
    const bookingId = String(req.params.bookingId);

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");

      // CRITICAL FIX C2: Lock booking row to prevent concurrent double-drop settlement
      const fetchR = await client.query(
        `SELECT opb.*, opr.id as ride_id
         FROM outstation_pool_bookings opb
         JOIN outstation_pool_rides opr ON opr.id = opb.ride_id
         WHERE opb.id = $1::uuid
           AND opr.driver_id = $2::uuid
           AND opr.status = 'active'
           AND opb.status = 'picked_up'
         FOR UPDATE OF opb`,
        [bookingId, driver.id],
      );
      if (!fetchR.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Booking not picked up or not found" });
      }

      const booking = fetchR.rows[0] as any;
      const fare = parseFloat(booking.total_fare || 0);
      const seatsBooked = parseInt(booking.seats_booked) || 1;

      await client.query(
        `UPDATE outstation_pool_bookings
         SET status = 'dropped', dropped_at = NOW(), payment_status = 'paid', updated_at = NOW()
         WHERE id = $1::uuid`,
        [bookingId],
      );
      await client.query(
        `UPDATE outstation_pool_rides
         SET available_seats = LEAST(total_seats, available_seats + $1), state_version = state_version + 1, updated_at = NOW()
         WHERE id = $2::uuid`,
        [seatsBooked, booking.ride_id],
      );

      // Crash-safe settlement: enqueue in the same transaction as the status update,
      // so a crash between COMMIT and settlement leaves a recoverable outbox entry
      // instead of an orphaned drop (driver never paid).
      const settlementOutboxId = await enqueuePoolSettlement(client, {
        bookingId,
        module: "outstation_pool",
        driverId: driver.id,
        fare,
        paymentMethod: booking.payment_method || "cash",
        serviceLabel: "outstation_pool_segment",
      });

      // CRITICAL: Commit BEFORE settlement to release lock and ensure drop is persisted
      await client.query("COMMIT");

      // Process settlement immediately for a fast response; if this fails or the
      // process crashes here, the pool-settlement worker's recovery loop will
      // pick up the pending outbox entry and complete it (see pool-settlement.ts).
      let driverEarnings = fare;
      let newWalletBalance = 0;
      try {
        const breakdown = await calculateRevenueBreakdown(fare, "outstation_pool", driver.id);
        driverEarnings = breakdown.driverEarnings;
        await processPoolSettlement(settlementOutboxId);
        const walletR = await rawDb.execute(rawSql`
          SELECT wallet_balance FROM users WHERE id = ${driver.id}::uuid LIMIT 1
        `);
        newWalletBalance = walletR.rows.length ? parseFloat((walletR.rows[0] as any).wallet_balance) : 0;
      } catch (settleErr: any) {
        console.error("[OUTSTATION-V2] settlement error", settleErr?.message);
      }

      io.to(`user:${booking.customer_id}`).emit("outstation_pool:dropped", {
        bookingId, fare, driverEarnings,
        message: "You've reached your destination! Thanks for riding with Jago Pool.",
      });

      res.json({ success: true, fare, driverEarnings, newWalletBalance });
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => undefined);
      res.status(500).json({ message: e.message });
    } finally {
      client.release();
    }
  });

  // ─── CUSTOMER: Search rides with segment fare preview ────────────────────

  app.get("/api/app/customer/outstation-pool/v2/search", authApp, async (req: any, res: any) => {
    try {
      const {
        fromCity, toCity,
        pickupLat, pickupLng, dropLat, dropLng,
        date, seats = "1",
        vehicleCategoryId, vehicleType,
      } = req.query as any;

      if (!fromCity || !toCity) return res.status(400).json({ message: "fromCity and toCity required" });

      const requestedSeats = parseInt(String(seats), 10) || 1;
      if (requestedSeats < 1 || requestedSeats > 2) {
        return res.status(400).json({ message: "You can book only 1 or 2 seats per booking" });
      }
      const seatsN = requestedSeats;
      const pLat = pickupLat ? parseFloat(pickupLat) : null;
      const pLng = pickupLng ? parseFloat(pickupLng) : null;
      const dLat = dropLat   ? parseFloat(dropLat)   : null;
      const dLng = dropLng   ? parseFloat(dropLng)   : null;

      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let categoryFilter = rawSql``;
      let categoryFilterAvail = rawSql``;
      if (vehicleCategoryId && uuidRe.test(String(vehicleCategoryId))) {
        const matchingIds = (await getMatchingDriverCategoryIds(String(vehicleCategoryId)) || [String(vehicleCategoryId)])
          .filter((id) => uuidRe.test(id));
        if (matchingIds.length === 1) {
          categoryFilter = rawSql`AND opr.vehicle_category_id = ${matchingIds[0]}::uuid`;
          categoryFilterAvail = rawSql`AND oda.vehicle_category_id = ${matchingIds[0]}::uuid`;
        } else if (matchingIds.length > 1) {
          const idList = rawSql.join(matchingIds.map((id) => rawSql`${id}::uuid`), rawSql`, `);
          categoryFilter = rawSql`AND opr.vehicle_category_id IN (${idList})`;
          categoryFilterAvail = rawSql`AND oda.vehicle_category_id IN (${idList})`;
        }
      } else if (vehicleType) {
        const vt = String(vehicleType).trim().toLowerCase();
        categoryFilter = rawSql`AND (
          LOWER(COALESCE(vc.vehicle_type, '')) = ${vt}
          OR LOWER(COALESCE(vc.name, '')) LIKE ${`%${vt}%`}
        )`;
        categoryFilterAvail = categoryFilter;
      }

      const r = await rawDb.execute(rawSql`
        SELECT opr.*,
          u.full_name as driver_name, u.phone as driver_phone,
          dd.avg_rating as driver_rating,
          COALESCE(vc.name, '') as vehicle_category_name,
          COALESCE(vc.vehicle_type, '') as vehicle_type,
          COUNT(opb.id) FILTER (WHERE opb.status != 'cancelled')::int as booked_count,
          'ride' as source
        FROM outstation_pool_rides opr
        JOIN users u ON u.id = opr.driver_id
        LEFT JOIN driver_details dd ON dd.user_id = opr.driver_id
        LEFT JOIN vehicle_categories vc ON vc.id = opr.vehicle_category_id
        LEFT JOIN outstation_pool_bookings opb ON opb.ride_id = opr.id
        WHERE opr.is_active = true
          AND opr.status IN ('scheduled', 'active')
          AND opr.accepting_new_requests = true
          AND opr.available_seats >= ${seatsN}
          AND COALESCE(dd.intercity_enabled, false) = true
          AND LOWER(opr.from_city) LIKE LOWER(${`%${fromCity}%`})
          AND LOWER(opr.to_city) LIKE LOWER(${`%${toCity}%`})
          ${date ? rawSql`AND opr.departure_date = ${date}::date` : rawSql``}
          ${categoryFilter}
        GROUP BY opr.id, u.full_name, u.phone, dd.avg_rating, vc.name, vc.vehicle_type
        ORDER BY opr.departure_date ASC, opr.departure_time ASC
        LIMIT 20
      `);

      // Driver availability windows (server/outstation-pool-matcher.ts's "go
      // available" flow) that haven't yet been booked into a real ride are
      // also searchable — this is what actually connects that flow to
      // customer search/book, which previously only ever looked at
      // outstation_pool_rides. matched_ride_id IS NULL excludes windows
      // already materialized into a ride (those already surface via the
      // query above once materialized, so listing them again here would
      // just duplicate the result).
      const availR = await rawDb.execute(rawSql`
        SELECT oda.*,
          oda.seat_capacity as total_seats,
          u.full_name as driver_name, u.phone as driver_phone,
          u.vehicle_number, u.vehicle_model,
          dd.avg_rating as driver_rating,
          COALESCE(vc.name, '') as vehicle_category_name,
          COALESCE(vc.vehicle_type, '') as vehicle_type,
          0 as booked_count,
          'availability' as source
        FROM outstation_driver_availability oda
        JOIN users u ON u.id = oda.driver_id
        LEFT JOIN driver_details dd ON dd.user_id = oda.driver_id
        LEFT JOIN vehicle_categories vc ON vc.id = oda.vehicle_category_id
        WHERE oda.status = 'available'
          AND oda.matched_ride_id IS NULL
          AND oda.available_seats >= ${seatsN}
          AND COALESCE(dd.intercity_enabled, false) = true
          AND LOWER(oda.from_city) LIKE LOWER(${`%${fromCity}%`})
          AND LOWER(oda.to_city) LIKE LOWER(${`%${toCity}%`})
          ${date ? rawSql`AND ${date}::date BETWEEN oda.earliest_departure::date AND oda.latest_departure::date` : rawSql``}
          ${categoryFilterAvail}
        ORDER BY oda.earliest_departure ASC
        LIMIT 20
      `);
      const availResults = (availR.rows as any[]).map(a => ({
        ...a,
        route_km: (a.from_lat && a.to_lat) ? haversineKm(parseFloat(a.from_lat), parseFloat(a.from_lng), parseFloat(a.to_lat), parseFloat(a.to_lng)) : 0,
        departure_date: a.earliest_departure ? new Date(a.earliest_departure).toISOString().slice(0, 10) : null,
        departure_time: a.earliest_departure ? new Date(a.earliest_departure).toISOString().slice(11, 16) : null,
        fare_per_seat: null,
        availabilityId: a.id,
      }));

      // Calculate segment fare for each result
      const results = [...(r.rows as any[]), ...availResults].map(ride => {
        const pkmps = parseFloat(ride.price_per_km_per_seat || DEFAULT_PRICE_PER_KM_PER_SEAT);
        const fromLatR = parseFloat(ride.from_lat || 0);
        const fromLngR = parseFloat(ride.from_lng || 0);
        const toLatR   = parseFloat(ride.to_lat   || 0);
        const toLngR   = parseFloat(ride.to_lng   || 0);

        let segmentKm = parseFloat(ride.route_km || 0);
        let onRoute = true;

        if (pLat && pLng && dLat && dLng && fromLatR && toLatR) {
          onRoute = isOnRoute(pLat, pLng, fromLatR, fromLngR, toLatR, toLngR) &&
                    isOnRoute(dLat, dLng, fromLatR, fromLngR, toLatR, toLngR) &&
                    pickupBeforeDrop(pLat, pLng, dLat, dLng, fromLatR, fromLngR);
          segmentKm = haversineKm(pLat, pLng, dLat, dLng);
        }

        const { farePerSeat, totalFare } = calcSegmentFare(segmentKm, seatsN, pkmps);

        return {
          ...ride,
          segmentKm: Math.round(segmentKm * 10) / 10,
          farePerSeat,
          totalFareForSeats: totalFare,
          pricePerKmPerSeat: pkmps,
          onRoute,
          fareBreakdown: {
            segmentKm: Math.round(segmentKm * 10) / 10,
            pricePerKmPerSeat: pkmps,
            seatsRequested: seatsN,
            farePerSeat,
            totalFare,
            note: `${Math.round(segmentKm)}km × ₹${pkmps}/km × ${seatsN} seat${seatsN > 1 ? 's' : ''} = ₹${totalFare}`,
          },
        };
      }).filter(r => r.onRoute || (!pLat && !pLng));

      res.json({ data: results, total: results.length });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── CUSTOMER: Book a seat with segment fare ──────────────────────────────

  app.post("/api/app/customer/outstation-pool/v2/book", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const {
        rideId, availabilityId,
        bookingMode = "seat",  // 'seat' (default, 1-2 seats) or 'whole_car' (exclusive, all seats)
        pickupLat, pickupLng, dropLat, dropLng,
        pickupAddress, dropAddress,
        paymentMethod = "cash",
        includeInsurance = true,  // customer opts in/out of insurance (₹2 goes to platform)
      } = req.body;
      // seats/seatsBooked and dropAddress/dropoffAddress: both apps have
      // used slightly different field names historically — accept either.
      const seats = req.body.seats ?? req.body.seatsBooked ?? 1;
      const dropAddressValue = dropAddress ?? req.body.dropoffAddress;
      const wholeCar = bookingMode === "whole_car";

      if (!rideId && !availabilityId) return res.status(400).json({ message: "rideId or availabilityId required" });

      let requestedSeats = parseInt(String(seats), 10) || 1;
      if (!wholeCar && (requestedSeats < 1 || requestedSeats > 2)) {
        return res.status(400).json({ message: "You can book only 1 or 2 seats per booking" });
      }
      let seatsN = requestedSeats;

      // Custom pickup/drop points are optional — when omitted, the booking
      // covers the ride's full posted route (its own from/to become the
      // segment), which is the only option the customer apps currently
      // offer (city-to-city search, no map picker for a mid-route point).
      let pLat = pickupLat != null ? parseFloat(pickupLat) : null;
      let pLng = pickupLng != null ? parseFloat(pickupLng) : null;
      let dLat = dropLat != null ? parseFloat(dropLat) : null;
      let dLng = dropLng != null ? parseFloat(dropLng) : null;
      const customSegment = pLat != null && pLng != null && dLat != null && dLng != null;

      // Reject GPS-not-yet-resolved coordinates (0,0 is in the Atlantic Ocean)
      if (customSegment) {
        if (Math.abs(pLat!) < 0.001 && Math.abs(pLng!) < 0.001) {
          return res.status(400).json({ message: "Invalid pickup coordinates — GPS not yet resolved" });
        }
        if (Math.abs(dLat!) < 0.001 && Math.abs(dLng!) < 0.001) {
          return res.status(400).json({ message: "Invalid drop coordinates — GPS not yet resolved" });
        }
      }

      // Atomically check seats + lock
      const txClient = await dbPool.connect();
      let ride: any;
      try {
        await txClient.query("BEGIN");
        let resolvedRideId = rideId ? String(rideId) : null;

        if (!resolvedRideId && availabilityId) {
          // Materialize a real outstation_pool_rides row from the driver's
          // availability window on first booking — mirrors the existing
          // materialize-on-accept logic in outstation-pool-matcher.ts's
          // requests/:id/accept, just triggered by a direct customer book
          // instead of the (currently unreachable-from-the-apps) request/
          // accept flow.
          const availR = await txClient.query(
            `SELECT * FROM outstation_driver_availability WHERE id = $1 AND status = 'available' FOR UPDATE`,
            [String(availabilityId)],
          );
          const avail = availR.rows[0];
          if (!avail) {
            await txClient.query("ROLLBACK");
            return res.status(409).json({ message: "This availability window is no longer open" });
          }
          if (avail.matched_ride_id) {
            resolvedRideId = String(avail.matched_ride_id);
          } else {
            if (avail.available_seats < seatsN) {
              await txClient.query("ROLLBACK");
              return res.status(409).json({ message: "Not enough seats available" });
            }
            const routeKm = (avail.from_lat && avail.to_lat)
              ? haversineKm(parseFloat(avail.from_lat), parseFloat(avail.from_lng), parseFloat(avail.to_lat), parseFloat(avail.to_lng))
              : 0;
            const pkmps = parseFloat(avail.price_per_km_per_seat || DEFAULT_PRICE_PER_KM_PER_SEAT);
            const farePerSeatFull = Math.round(Math.max(MIN_FARE_PER_BOOKING, pkmps * routeKm) * 100) / 100;
            const newRideR = await txClient.query(
              `INSERT INTO outstation_pool_rides
                (driver_id, vehicle_category_id, from_city, to_city, from_lat, from_lng, to_lat, to_lng,
                 route_km, departure_date, departure_time,
                 total_seats, available_seats, fare_per_seat, price_per_km_per_seat,
                 status, is_active, formed_via)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14,'scheduled',true,'pooled')
               RETURNING id`,
              [
                avail.driver_id, avail.vehicle_category_id, avail.from_city, avail.to_city,
                avail.from_lat, avail.from_lng, avail.to_lat, avail.to_lng,
                routeKm, avail.earliest_departure ? new Date(avail.earliest_departure).toISOString().slice(0, 10) : null,
                avail.earliest_departure ? new Date(avail.earliest_departure).toISOString().slice(11, 16) : null,
                avail.seat_capacity, farePerSeatFull, pkmps,
              ],
            );
            resolvedRideId = String(newRideR.rows[0].id);
            await txClient.query(
              `UPDATE outstation_driver_availability SET matched_ride_id = $1, updated_at = NOW() WHERE id = $2`,
              [resolvedRideId, avail.id],
            );
          }
        }

        const rideR = await txClient.query(
          `SELECT * FROM outstation_pool_rides
           WHERE id = $1 AND is_active = true AND status IN ('scheduled','active')
             AND accepting_new_requests = true
             AND available_seats >= $2
           FOR UPDATE`,
          [resolvedRideId, wholeCar ? 1 : seatsN],
        );
        if (!rideR.rows.length) {
          await txClient.query("ROLLBACK");
          return res.status(409).json({ message: "Ride not available or not enough seats" });
        }
        ride = rideR.rows[0];

        if (wholeCar) {
          if (ride.available_seats !== ride.total_seats) {
            await txClient.query("ROLLBACK");
            return res.status(409).json({ message: "Whole car is unavailable — some seats are already booked on this ride" });
          }
          seatsN = ride.available_seats;
        }
        const finalRideId = resolvedRideId as string;

        if (await hasActivePoolBlock(String(customer.id), String(ride.driver_id))) {
          await txClient.query("ROLLBACK");
          return res.status(403).json({ message: "This pool driver is unavailable for this booking" });
        }

        // Prevent duplicate booking by the same customer on this ride
        const dupR = await txClient.query(
          `SELECT id FROM outstation_pool_bookings
           WHERE ride_id = $1 AND customer_id = $2 AND status NOT IN ('cancelled')
           LIMIT 1`,
          [finalRideId, (req as any).currentUser.id],
        );
        if (dupR.rows.length) {
          await txClient.query("ROLLBACK");
          return res.status(409).json({ message: "You already have an active booking on this ride" });
        }

        const fromLatR = parseFloat(ride.from_lat || 0);
        const fromLngR = parseFloat(ride.from_lng || 0);
        const toLatR   = parseFloat(ride.to_lat   || 0);
        const toLngR   = parseFloat(ride.to_lng   || 0);

        if (customSegment) {
          // Validate customer's custom pickup/drop is on this route
          if (fromLatR && toLatR) {
            if (!isOnRoute(pLat!, pLng!, fromLatR, fromLngR, toLatR, toLngR)) {
              await txClient.query("ROLLBACK");
              return res.status(400).json({ message: "Pickup location is not on this route" });
            }
            if (!isOnRoute(dLat!, dLng!, fromLatR, fromLngR, toLatR, toLngR)) {
              await txClient.query("ROLLBACK");
              return res.status(400).json({ message: "Drop location is not on this route" });
            }
            if (!pickupBeforeDrop(pLat!, pLng!, dLat!, dLng!, fromLatR, fromLngR)) {
              await txClient.query("ROLLBACK");
              return res.status(400).json({ message: "Pickup must be before drop along the route" });
            }
          }
        } else {
          // No custom segment given — book the ride's full posted route.
          pLat = fromLatR; pLng = fromLngR; dLat = toLatR; dLng = toLngR;
        }

        // pLat/pLng/dLat/dLng are guaranteed non-null here: either the
        // customSegment branch validated them, or the else branch just
        // defaulted them to the route's own from/to coordinates.
        const pLatV = pLat as number, pLngV = pLng as number, dLatV = dLat as number, dLngV = dLng as number;

        // Calculate segment fare
        const segmentKm = haversineKm(pLatV, pLngV, dLatV, dLngV);
        const pkmps = parseFloat(ride.price_per_km_per_seat || DEFAULT_PRICE_PER_KM_PER_SEAT);
        const { farePerSeat, totalFare } = calcSegmentFare(segmentKm, seatsN, pkmps);

        // Calculate pickup_order (based on distance from route origin)
        const pickupDistFromOrigin = fromLatR
          ? haversineKm(fromLatR, fromLngR, pLatV, pLngV)
          : 0;
        const existingOrders = await txClient.query(
          `SELECT COUNT(*) as cnt FROM outstation_pool_bookings WHERE ride_id = $1 AND status != 'cancelled'`,
          [finalRideId],
        );
        const pickupOrder = parseInt(existingOrders.rows[0].cnt) + 1;

        // Revenue breakdown preview (commission + GST + optional insurance)
        let revenuePreview: any = null;
        try {
          revenuePreview = await calculateRevenueBreakdown(
            totalFare, "outstation_pool", ride.driver_id,
          );
          // If customer opts out of insurance, remove it from the preview only
          // (actual settlement at drop time will respect this flag)
          if (!includeInsurance && revenuePreview) {
            revenuePreview = {
              ...revenuePreview,
              insurance: 0,
              total: revenuePreview.total - revenuePreview.insurance,
              driverEarnings: revenuePreview.driverEarnings + revenuePreview.insurance,
            };
          }
        } catch { /* non-blocking */ }

        // Insert booking (store insurance_opted for settlement)
        const bookR = await txClient.query(
          `INSERT INTO outstation_pool_bookings
            (ride_id, customer_id, seats_booked, total_fare, fare_per_seat, segment_km,
             from_city, to_city, pickup_lat, pickup_lng, drop_lat, drop_lng,
             pickup_address, dropoff_address, payment_method, status, payment_status, pickup_order, booking_mode)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'confirmed','pending',$16,$17)
           RETURNING id`,
          [
            finalRideId, customer.id, seatsN, totalFare, farePerSeat, Math.round(segmentKm * 100) / 100,
            ride.from_city, ride.to_city,
            pLat, pLng, dLat, dLng,
            pickupAddress || null, dropAddressValue || null,
            paymentMethod, pickupOrder, bookingMode,
          ],
        );
        const bookingId = bookR.rows[0]?.id;

        // Decrement available seats. A whole-car booking additionally closes
        // the ride to further requests so no one else can take "remaining"
        // seats out from under an exclusive booking — the same flag the
        // search/lock queries above already filter on.
        await txClient.query(
          `UPDATE outstation_pool_rides
           SET available_seats = available_seats - $1, state_version = state_version + 1, updated_at = NOW()
               ${wholeCar ? ", accepting_new_requests = false" : ""}
           WHERE id = $2`,
          [seatsN, finalRideId],
        );

        await txClient.query("COMMIT");

        // Notify driver about new booking
        io.to(`user:${ride.driver_id}`).emit("outstation_pool:new_booking", {
          rideId: finalRideId,
          bookingId,
          passengerName: customer.fullName || "Passenger",
          seatsBooked: seatsN,
          bookingMode,
          pickupAddress: pickupAddress || `${pLatV.toFixed(4)},${pLngV.toFixed(4)}`,
          dropAddress: dropAddressValue || `${dLatV.toFixed(4)},${dLngV.toFixed(4)}`,
          totalFare,
          segmentKm: Math.round(segmentKm * 10) / 10,
        });
        void sendPoolPush(
          String(customer.id),
          "Pool booking confirmed",
          "Your outstation pool seat is confirmed.",
          {
            type: "pool_booking_confirmed",
            module: "outstation_pool",
            referenceId: String(bookingId),
            bookingId: String(bookingId),
            rideId: String(finalRideId),
            pickupAddress: String(pickupAddress || ""),
            dropAddress: String(dropAddressValue || ""),
          },
        );
        void sendPoolPush(
          String(ride.driver_id),
          "New outstation pool booking",
          `${customer.fullName || "Passenger"} booked ${seatsN} seat${seatsN > 1 ? "s" : ""}.`,
          {
            type: "pool_new_booking",
            module: "outstation_pool",
            referenceId: String(bookingId),
            bookingId: String(bookingId),
            rideId: String(finalRideId),
          },
        );

        // Build clear fare breakdown for customer
        const fareBreakdown: any = {
          segmentKm: Math.round(segmentKm * 10) / 10,
          pricePerKmPerSeat: pkmps,
          seatsBooked: seatsN,
          farePerSeat,
          subtotal: totalFare,
          // Platform deductions (from driver's share — customer pays totalFare only)
          platformCommission: revenuePreview?.commission ?? null,
          commissionPct: revenuePreview?.commissionPct ?? null,
          gst: revenuePreview?.gst ?? null,
          insurance: includeInsurance ? (revenuePreview?.insurance ?? null) : 0,
          insuranceIncluded: !!includeInsurance,
          totalPlatformCut: revenuePreview?.total ?? null,
          driverEarnings: revenuePreview?.driverEarnings ?? null,
          totalFare,
          note: `${Math.round(segmentKm)}km × ₹${pkmps}/km × ${seatsN} seat${seatsN > 1 ? 's' : ''} = ₹${totalFare}`,
        };

        res.json({
          success: true,
          bookingId,
          rideId: finalRideId,
          seatsBooked: seatsN,
          bookingMode,
          farePerSeat,
          totalFare,
          fareBreakdown,
          message: wholeCar
            ? "Whole car booked! Driver will pick you up at your location."
            : "Booking confirmed! Driver will pick you up at your location.",
        });
      } catch (e) {
        await txClient.query("ROLLBACK");
        throw e;
      } finally {
        txClient.release();
      }
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── CUSTOMER: My outstation pool bookings ────────────────────────────────

  // ─── CUSTOMER: Find my current active Intercity booking (app-resume) ────
  // Same shape as /v2/bookings below, filtered to the one most-recent
  // non-terminal booking — lets the app find an in-progress Outstation Pool
  // booking after being closed/reopened, mirroring
  // /api/app/customer/active-trip's role for normal rides.
  app.get("/api/app/customer/outstation-pool/v2/active", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const r = await rawDb.execute(rawSql`
        SELECT opb.*,
          opr.from_city, opr.to_city, opr.departure_date, opr.departure_time,
          opr.status as ride_status, opr.current_lat, opr.current_lng, opr.driver_id,
          opr.vehicle_number, opr.vehicle_model,
          u.full_name as driver_name, u.phone as driver_phone,
          dd.avg_rating as driver_rating
        FROM outstation_pool_bookings opb
        JOIN outstation_pool_rides opr ON opr.id = opb.ride_id
        JOIN users u ON u.id = opr.driver_id
        LEFT JOIN driver_details dd ON dd.user_id = opr.driver_id
        WHERE opb.customer_id = ${customer.id}::uuid
          AND opb.status IN ('confirmed', 'picked_up')
        ORDER BY opb.created_at DESC
        LIMIT 1
      `);
      if (!r.rows.length) return res.json({ active: false, booking: null });
      res.json({ active: true, booking: r.rows[0] });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/app/customer/outstation-pool/v2/bookings", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const r = await rawDb.execute(rawSql`
        SELECT opb.*,
          opr.from_city, opr.to_city, opr.departure_date, opr.departure_time,
          opr.status as ride_status, opr.current_lat, opr.current_lng, opr.driver_id,
          opr.vehicle_number, opr.vehicle_model,
          u.full_name as driver_name, u.phone as driver_phone,
          dd.avg_rating as driver_rating,
          CASE WHEN COALESCE(u.verification_status, '') IN ('verified', 'approved') THEN true ELSE false END AS driver_is_verified,
          (
            SELECT COUNT(*)::int
            FROM pool_issue_cases pic
            WHERE pic.reported_user_id = opr.driver_id
          ) AS driver_report_count,
          (
            SELECT COUNT(*)::int
            FROM pool_issue_cases pic
            WHERE pic.reported_user_id = opr.driver_id
              AND pic.status IN ('open', 'under_review')
          ) AS driver_open_issue_count,
          EXISTS(
            SELECT 1
            FROM pool_user_blocks pub
            WHERE pub.active = true
              AND pub.blocked_user_id = opr.driver_id
          ) AS driver_has_active_block
        FROM outstation_pool_bookings opb
        JOIN outstation_pool_rides opr ON opr.id = opb.ride_id
        JOIN users u ON u.id = opr.driver_id
        LEFT JOIN driver_details dd ON dd.user_id = opr.driver_id
        WHERE opb.customer_id = ${customer.id}::uuid
        ORDER BY opb.created_at DESC
        LIMIT 30
      `);
      res.json({
        data: (r.rows as any[]).map((row) => ({
          ...row,
          driverSafety: buildUserSafetySnapshot(row, "driver_"),
        })),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── CUSTOMER: Cancel booking (only if not yet picked up) ────────────────

  app.post("/api/app/customer/outstation-pool/v2/bookings/:id/cancel", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const bookingId = String(req.params.id);
      const reason = String(req.body?.reason || "Customer changed plans").trim().slice(0, 300);

      const r = await rawDb.execute(rawSql`
        SELECT opb.id, opb.status, opb.seats_booked, opb.ride_id, opb.total_fare, opb.payment_method,
               opr.status AS ride_status, opr.driver_id,
               u.full_name AS customer_name
        FROM outstation_pool_bookings opb
        JOIN outstation_pool_rides opr ON opr.id = opb.ride_id
        LEFT JOIN users u ON u.id = opb.customer_id
        WHERE opb.id = ${bookingId}::uuid AND opb.customer_id = ${customer.id}::uuid
        LIMIT 1
      `);
      if (!r.rows.length) return res.status(404).json({ message: "Booking not found" });

      const booking = r.rows[0] as any;
      if (booking.status === "picked_up") {
        return res.status(400).json({ message: "Cannot cancel after pickup" });
      }
      if (["dropped", "cancelled", "completed"].includes(booking.status)) {
        return res.json({ success: true, message: "Already completed/cancelled" });
      }

      const fare = parseFloat(booking.total_fare || 0) || 0;
      const policy = await getPoolRefundPolicy();
      const refundPct = getRefundPctForDeparture(String(booking.ride_status || "scheduled"), policy.beforeDeparturePct, policy.afterDeparturePct);
      const refundAmount = Math.round(fare * Math.max(0, refundPct) / 100 * 100) / 100;
      const refundStatus = refundAmount > 0 ? "pending" : "not_applicable";

      // Atomic cancel: status guard prevents concurrent double-cancel + double seat release
      const cancelClient = await dbPool.connect();
      let cancelledRows = 0;
      try {
        await cancelClient.query("BEGIN");
        const cancelR = await cancelClient.query(
          `UPDATE outstation_pool_bookings
           SET status = 'cancelled', cancel_reason = $1, cancelled_at = NOW(),
               cancelled_by = 'customer', refund_amount = $2, refund_status = $3, updated_at = NOW()
           WHERE id = $4::uuid AND customer_id = $5::uuid
             AND status NOT IN ('picked_up', 'dropped', 'cancelled', 'completed')`,
          [reason, refundAmount, refundStatus, bookingId, customer.id],
        );
        cancelledRows = cancelR.rowCount ?? 0;
        if (cancelledRows > 0) {
          await cancelClient.query(
            `UPDATE outstation_pool_rides
             SET available_seats = LEAST(total_seats, available_seats + $1), state_version = state_version + 1, updated_at = NOW()
             WHERE id = $2::uuid`,
            [parseInt(booking.seats_booked) || 1, booking.ride_id],
          );
        }
        await cancelClient.query("COMMIT");
      } catch (txErr) {
        await cancelClient.query("ROLLBACK");
        throw txErr;
      } finally {
        cancelClient.release();
      }
      if (cancelledRows === 0) {
        return res.json({ success: true, message: "Already completed/cancelled" });
      }

      if (refundAmount > 0) {
        await rawDb.execute(rawSql`
          INSERT INTO refund_requests (customer_id, amount, reason, payment_method, status, admin_note)
          VALUES (
            ${customer.id}::uuid,
            ${refundAmount},
            ${`Outstation pool cancellation: ${reason}`},
            ${booking.payment_method || "wallet"},
            'pending',
            ${`Pool booking ${bookingId} cancelled before departure`}
          )
        `).catch(() => undefined);
      }

      io.to(`user:${booking.driver_id}`).emit("outstation_pool:booking_cancelled", {
        bookingId,
        rideId: booking.ride_id,
        seatsReleased: parseInt(booking.seats_booked) || 1,
        customerName: booking.customer_name || "Passenger",
        reason,
      });
      io.to(`user:${customer.id}`).emit("outstation_pool:cancellation_confirmed", {
        bookingId,
        refundAmount,
        refundStatus,
      });
      const refundPayload = buildPoolRealtimePayload("outstation_pool", bookingId, {
        rideId: String(booking.ride_id),
        refundAmount,
        refundStatus,
        status: "cancelled",
      });
      io.to(`user:${customer.id}`).emit("pool:refund_updated", refundPayload);
      io.to(`user:${booking.driver_id}`).emit("pool:refund_updated", refundPayload);
      void sendPoolPush(
        String(customer.id),
        "Pool booking cancelled",
        refundAmount > 0 ? "Your refund request has been raised." : "Your outstation pool booking has been cancelled.",
        {
          type: "pool_booking_cancelled",
          module: "outstation_pool",
          referenceId: bookingId,
          bookingId,
          refundAmount: String(refundAmount),
          refundStatus: String(refundStatus),
        },
      );
      void sendPoolPush(
        String(booking.driver_id),
        "Pool booking cancelled",
        `${booking.customer_name || "A passenger"} cancelled the booking.`,
        {
          type: "pool_booking_cancelled",
          module: "outstation_pool",
          referenceId: bookingId,
          bookingId,
          rideId: String(booking.ride_id),
        },
      );

      res.json({
        success: true,
        refundAmount,
        refundStatus,
        refundTimeline: buildRefundTimeline(refundAmount, refundStatus),
        cancellationCharge: Math.max(0, fare - refundAmount),
        seatReleased: parseInt(booking.seats_booked) || 1,
        message: refundAmount > 0 ? "Booking cancelled. Refund request has been raised." : "Booking cancelled. No refund is applicable after departure.",
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/app/customer/outstation-pool/v2/bookings/:id/co-passengers", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const bookingId = String(req.params.id);
      const ownR = await rawDb.execute(rawSql`
        SELECT opb.id, opb.ride_id
        FROM outstation_pool_bookings opb
        WHERE opb.id = ${bookingId}::uuid AND opb.customer_id = ${customer.id}::uuid
        LIMIT 1
      `);
      if (!ownR.rows.length) return res.status(404).json({ message: "Booking not found" });
      const own = ownR.rows[0] as any;
      const coR = await rawDb.execute(rawSql`
        SELECT opb.id,
               u.full_name AS passenger_name,
               CASE WHEN COALESCE(u.verification_status, '') IN ('verified', 'approved') THEN true ELSE false END AS is_verified,
               opb.pickup_address,
               opb.dropoff_address,
               opb.seats_booked,
               opb.status,
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
        FROM outstation_pool_bookings opb
        JOIN users u ON u.id = opb.customer_id
        WHERE opb.ride_id = ${own.ride_id}::uuid
          AND opb.status NOT IN ('cancelled')
        ORDER BY COALESCE(opb.pickup_order, 1), opb.created_at ASC
      `);
      const passengers = (coR.rows as any[]).map((row) => ({
        id: row.id,
        passengerName: row.passenger_name,
        isVerified: row.is_verified === true,
        pickupPoint: row.pickup_address || "Pickup on route",
        dropPoint: row.dropoff_address || "Drop on route",
        seatsBooked: parseInt(row.seats_booked) || 1,
        status: row.status,
        safety: buildUserSafetySnapshot(row),
      }));
      const seatsBooked = passengers.reduce((sum, row) => sum + (row.seatsBooked || 0), 0);
      res.json({
        passengers,
        occupancy: {
          passengerCount: passengers.length,
          seatsBooked,
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/app/customer/pool/issues", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const {
        module = "outstation_pool",
        referenceType = "booking",
        referenceId,
        issueChannel = "report",
        category,
        description = "",
        reportedUserId = null,
        evidenceUrls = [],
      } = req.body || {};
      if (!referenceId || !category) {
        return res.status(400).json({ message: "referenceId and category are required" });
      }
      let own: any = null;
      if (String(module) === "local_pool" || String(referenceType) === "request") {
        const ownR = await rawDb.execute(rawSql`
          SELECT prr.id, COALESCE(prr.session_id, prr.proposed_session_id) AS ride_id, dps.driver_id
          FROM pool_ride_requests prr
          LEFT JOIN driver_pool_sessions dps ON dps.id = COALESCE(prr.session_id, prr.proposed_session_id)
          WHERE prr.id = ${String(referenceId)}::uuid AND prr.customer_id = ${customer.id}::uuid
          LIMIT 1
        `);
        own = ownR.rows[0] as any;
      } else {
        const ownR = await rawDb.execute(rawSql`
          SELECT opb.id, opb.ride_id, opr.driver_id
          FROM outstation_pool_bookings opb
          JOIN outstation_pool_rides opr ON opr.id = opb.ride_id
          WHERE opb.id = ${String(referenceId)}::uuid AND opb.customer_id = ${customer.id}::uuid
          LIMIT 1
        `);
        own = ownR.rows[0] as any;
      }
      if (!own) return res.status(404).json({ message: "Pool booking not found" });
      const created = await rawDb.execute(rawSql`
        INSERT INTO pool_issue_cases (
          module, reference_type, reference_id, ride_id, customer_id, driver_id,
          reported_user_id, reported_by_role, issue_channel, category, description, evidence_urls, admin_updates
        )
        VALUES (
          ${String(module)},
          ${String(referenceType)},
          ${String(referenceId)}::uuid,
          ${own.ride_id}::uuid,
          ${customer.id}::uuid,
          ${own.driver_id}::uuid,
          ${reportedUserId ? String(reportedUserId) : null}::uuid,
          'customer',
          ${String(issueChannel)},
          ${String(category)},
          ${String(description).slice(0, 1500)},
          ${JSON.stringify(Array.isArray(evidenceUrls) ? evidenceUrls.slice(0, 4) : [])}::jsonb,
          '[]'::jsonb
        )
        RETURNING *
      `);
      const item = created.rows[0] as any;
      const payload = buildPoolRealtimePayload(String(item.module || module), String(item.reference_id || referenceId), {
        issueId: String(item.id),
        status: String(item.status || "open"),
      });
      io.to(`user:${customer.id}`).emit("pool:issue_updated", payload);
      if (own.driver_id) {
        io.to(`user:${own.driver_id}`).emit("pool:issue_updated", payload);
      }
      void sendPoolPush(
        String(customer.id),
        "Pool issue created",
        "Your pool issue has been submitted for review.",
        {
          type: "pool_dispute_update",
          module: String(item.module || module),
          referenceId: String(item.reference_id || referenceId),
          issueId: String(item.id),
          status: String(item.status || "open"),
        },
      );
      res.status(201).json({ success: true, case: item });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/app/customer/pool/issues", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const module = String(req.query.module || "all");
      const referenceId = String(req.query.referenceId || "").trim();
      const itemsR = await rawDb.execute(rawSql`
        SELECT *
        FROM pool_issue_cases
        WHERE customer_id = ${customer.id}::uuid
          ${module !== "all" ? rawSql`AND module = ${module}` : rawSql``}
          ${referenceId ? rawSql`AND reference_id = ${referenceId}::uuid` : rawSql``}
        ORDER BY created_at DESC
        LIMIT 50
      `);
      res.json({
        items: (itemsR.rows as any[]).map((row) => ({
          ...row,
          timeline: buildIssueTimeline(row),
        })),
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/app/customer/pool/issues/:id", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const id = String(req.params.id);
      const issueR = await rawDb.execute(rawSql`
        SELECT pic.*,
               cu.full_name AS customer_name,
               du.full_name AS driver_name,
               ru.full_name AS reported_user_name
        FROM pool_issue_cases pic
        LEFT JOIN users cu ON cu.id = pic.customer_id
        LEFT JOIN users du ON du.id = pic.driver_id
        LEFT JOIN users ru ON ru.id = pic.reported_user_id
        WHERE pic.id = ${id}::uuid
          AND pic.customer_id = ${customer.id}::uuid
        LIMIT 1
      `);
      if (!issueR.rows.length) return res.status(404).json({ message: "Issue not found" });
      const item = issueR.rows[0] as any;
      res.json({ item: { ...item, timeline: buildIssueTimeline(item) } });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/app/customer/pool/share", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const module = String(req.body?.module || "local_pool");
      const referenceId = String(req.body?.referenceId || "").trim();
      if (!referenceId) return res.status(400).json({ message: "referenceId required" });
      let shareData: any = null;
      if (module === "outstation_pool") {
        const r = await rawDb.execute(rawSql`
          SELECT opb.id, opb.status, opb.pickup_address, opb.dropoff_address, opb.seats_booked,
                 opr.from_city, opr.to_city, opr.departure_date, opr.departure_time,
                 opr.vehicle_number, opr.vehicle_model,
                 u.full_name AS driver_name
          FROM outstation_pool_bookings opb
          JOIN outstation_pool_rides opr ON opr.id = opb.ride_id
          LEFT JOIN users u ON u.id = opr.driver_id
          WHERE opb.id = ${referenceId}::uuid AND opb.customer_id = ${customer.id}::uuid
          LIMIT 1
        `);
        shareData = r.rows[0];
      } else {
        const r = await rawDb.execute(rawSql`
          SELECT prr.id, prr.status, prr.pickup_address, prr.drop_address, prr.seats_requested,
                 u.full_name AS driver_name,
                 u.vehicle_number, u.vehicle_model
          FROM pool_ride_requests prr
          LEFT JOIN driver_pool_sessions dps ON dps.id = COALESCE(prr.session_id, prr.proposed_session_id)
          LEFT JOIN users u ON u.id = dps.driver_id
          WHERE prr.id = ${referenceId}::uuid AND prr.customer_id = ${customer.id}::uuid
          LIMIT 1
        `);
        shareData = r.rows[0];
      }
      if (!shareData) return res.status(404).json({ message: "Pool booking not found" });
      const shareText = module === "outstation_pool"
        ? `JAGO Pool Trip\nTrip ID: ${shareData.id}\nRoute: ${shareData.from_city} -> ${shareData.to_city}\nDriver: ${shareData.driver_name || "Assigned soon"}\nVehicle: ${shareData.vehicle_model || "-"} ${shareData.vehicle_number || ""}\nStatus: ${shareData.status}\nPickup: ${shareData.pickup_address || "-"}\nDrop: ${shareData.dropoff_address || "-"}\nSeats: ${shareData.seats_booked || 1}\nDeparture: ${shareData.departure_date || "-"} ${shareData.departure_time || ""}`.trim()
        : `JAGO Local Pool\nTrip ID: ${shareData.id}\nDriver: ${shareData.driver_name || "Matching"}\nVehicle: ${shareData.vehicle_model || "-"} ${shareData.vehicle_number || ""}\nStatus: ${shareData.status}\nPickup: ${shareData.pickup_address || "-"}\nDrop: ${shareData.drop_address || "-"}\nSeats: ${shareData.seats_requested || 1}`.trim();
      res.json({ success: true, shareText, tripId: shareData.id, liveStatus: shareData.status });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/app/customer/pool/block-user", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const blockedUserId = String(req.body?.blockedUserId || "").trim();
      const module = String(req.body?.module || "pool");
      const referenceType = String(req.body?.referenceType || "booking");
      const referenceId = String(req.body?.referenceId || "").trim();
      const reason = String(req.body?.reason || "Blocked after pool incident").slice(0, 300);
      if (!blockedUserId) return res.status(400).json({ message: "blockedUserId required" });
      await rawDb.execute(rawSql`
        INSERT INTO pool_user_blocks (
          blocker_user_id, blocked_user_id, module, reference_type, reference_id, created_by_role, reason
        )
        VALUES (
          ${customer.id}::uuid, ${blockedUserId}::uuid, ${module},
          ${referenceType || null}, ${referenceId ? referenceId : null}::uuid, 'customer', ${reason}
        )
        ON CONFLICT (blocker_user_id, blocked_user_id, module) WHERE active = true DO NOTHING
      `);
      const payload = buildPoolRealtimePayload(module === "pool" ? "local_pool" : module, referenceId || blockedUserId, {
        blockedUserId,
        actorRole: "customer",
      });
      io.to(`user:${customer.id}`).emit("pool:safety_updated", payload);
      void sendPoolPush(
        String(customer.id),
        "Pool safety updated",
        "This user has been blocked from future pool matching.",
        {
          type: "pool_safety_update",
          module: module === "pool" ? "local_pool" : module,
          referenceId: referenceId || blockedUserId,
          blockedUserId,
        },
      );
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/app/driver/pool/block-user", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const blockedUserId = String(req.body?.blockedUserId || "").trim();
      const module = String(req.body?.module || "pool");
      const referenceType = String(req.body?.referenceType || "booking");
      const referenceId = String(req.body?.referenceId || "").trim();
      const reason = String(req.body?.reason || "Blocked after pool incident").slice(0, 300);
      if (!blockedUserId) return res.status(400).json({ message: "blockedUserId required" });
      await rawDb.execute(rawSql`
        INSERT INTO pool_user_blocks (
          blocker_user_id, blocked_user_id, module, reference_type, reference_id, created_by_role, reason
        )
        VALUES (
          ${driver.id}::uuid, ${blockedUserId}::uuid, ${module},
          ${referenceType || null}, ${referenceId ? referenceId : null}::uuid, 'driver', ${reason}
        )
        ON CONFLICT (blocker_user_id, blocked_user_id, module) WHERE active = true DO NOTHING
      `);
      const payload = buildPoolRealtimePayload(module === "pool" ? "local_pool" : module, referenceId || blockedUserId, {
        blockedUserId,
        actorRole: "driver",
      });
      io.to(`user:${driver.id}`).emit("pool:safety_updated", payload);
      void sendPoolPush(
        String(driver.id),
        "Pool safety updated",
        "This passenger has been blocked from future pool matching.",
        {
          type: "pool_safety_update",
          module: module === "pool" ? "local_pool" : module,
          referenceId: referenceId || blockedUserId,
          blockedUserId,
        },
      );
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/app/driver/pool/share", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const module = String(req.body?.module || "local_pool");
      const referenceId = String(req.body?.referenceId || "").trim();
      if (!referenceId) return res.status(400).json({ message: "referenceId required" });
      let shareData: any = null;
      if (module === "outstation_pool") {
        const r = await rawDb.execute(rawSql`
          SELECT opb.id, opb.status, opb.pickup_address, opb.dropoff_address, opb.seats_booked,
                 opr.id AS ride_id, opr.from_city, opr.to_city, opr.departure_date, opr.departure_time,
                 opr.vehicle_number, opr.vehicle_model,
                 u.full_name AS passenger_name
          FROM outstation_pool_bookings opb
          JOIN outstation_pool_rides opr ON opr.id = opb.ride_id
          LEFT JOIN users u ON u.id = opb.customer_id
          WHERE opb.id = ${referenceId}::uuid AND opr.driver_id = ${driver.id}::uuid
          LIMIT 1
        `);
        shareData = r.rows[0];
      } else {
        const r = await rawDb.execute(rawSql`
          SELECT prr.id, prr.status, prr.pickup_address, prr.drop_address, prr.seats_requested,
                 u.full_name AS passenger_name,
                 du.vehicle_number, du.vehicle_model
          FROM pool_ride_requests prr
          JOIN driver_pool_sessions dps ON dps.id = COALESCE(prr.session_id, prr.proposed_session_id)
          LEFT JOIN users u ON u.id = prr.customer_id
          LEFT JOIN users du ON du.id = dps.driver_id
          WHERE prr.id = ${referenceId}::uuid AND dps.driver_id = ${driver.id}::uuid
          LIMIT 1
        `);
        shareData = r.rows[0];
      }
      if (!shareData) return res.status(404).json({ message: "Pool passenger not found" });
      const shareText = module === "outstation_pool"
        ? `JAGO Driver Pool Trip\nPassenger: ${shareData.passenger_name || "Passenger"}\nBooking ID: ${shareData.id}\nRoute: ${shareData.from_city} -> ${shareData.to_city}\nPickup: ${shareData.pickup_address || "-"}\nDrop: ${shareData.dropoff_address || "-"}\nSeats: ${shareData.seats_booked || 1}\nVehicle: ${shareData.vehicle_model || "-"} ${shareData.vehicle_number || ""}\nStatus: ${shareData.status}\nDeparture: ${shareData.departure_date || "-"} ${shareData.departure_time || ""}`.trim()
        : `JAGO Driver Local Pool\nPassenger: ${shareData.passenger_name || "Passenger"}\nRequest ID: ${shareData.id}\nPickup: ${shareData.pickup_address || "-"}\nDrop: ${shareData.drop_address || "-"}\nSeats: ${shareData.seats_requested || 1}\nVehicle: ${shareData.vehicle_model || "-"} ${shareData.vehicle_number || ""}\nStatus: ${shareData.status}`.trim();
      res.json({ success: true, shareText, referenceId: shareData.id, liveStatus: shareData.status });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/app/customer/outstation-pool/v2/bookings/:id/rate-driver", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const bookingId = String(req.params.id);
      const overall = Number(req.body?.overallRating);
      const safety = Number(req.body?.safetyRating || overall);
      const cleanliness = Number(req.body?.cleanlinessRating || overall);
      const behaviour = Number(req.body?.behaviourRating || overall);
      const punctuality = Number(req.body?.punctualityRating || overall);
      const note = String(req.body?.note || "").slice(0, 1000);
      if (![overall, safety, cleanliness, behaviour, punctuality].every((value) => Number.isFinite(value) && value >= 1 && value <= 5)) {
        return res.status(400).json({ message: "All ratings must be between 1 and 5" });
      }

      const ownR = await rawDb.execute(rawSql`
        SELECT opb.id, opb.ride_id, opr.driver_id
        FROM outstation_pool_bookings opb
        JOIN outstation_pool_rides opr ON opr.id = opb.ride_id
        WHERE opb.id = ${bookingId}::uuid
          AND opb.customer_id = ${customer.id}::uuid
          AND opb.status IN ('dropped', 'completed')
        LIMIT 1
      `);
      if (!ownR.rows.length) return res.status(404).json({ message: "Completed booking not found" });
      const own = ownR.rows[0] as any;

      const inserted = await rawDb.execute(rawSql`
        INSERT INTO pool_ratings (
          module, reference_type, reference_id, ride_id, from_user_id, to_user_id,
          rating_role, overall_rating, safety_rating, cleanliness_rating,
          behaviour_rating, punctuality_rating, note
        )
        VALUES (
          'outstation_pool', 'booking', ${bookingId}::uuid, ${own.ride_id}::uuid, ${customer.id}::uuid, ${own.driver_id}::uuid,
          'customer_to_driver', ${overall}, ${safety}, ${cleanliness}, ${behaviour}, ${punctuality}, ${note}
        )
        ON CONFLICT (reference_type, reference_id, from_user_id, rating_role) DO NOTHING
        RETURNING *
      `);
      if (!inserted.rows.length) return res.status(409).json({ message: "Rating already submitted for this booking" });

      // P0 FIX: this used to write users.total_ratings, a column that does not
      // exist anywhere in the schema — silently swallowed by .catch(), so the
      // driver's aggregate rating was never actually updated even though the
      // pool_ratings row itself saved correctly. recomputeUserRating() is the
      // single shared source of truth across rides/parcel (reviews) and
      // pool/outstation/car-sharing (pool_ratings).
      await recomputeUserRating(own.driver_id).catch(() => undefined);

      res.json({ success: true, rating: inserted.rows[0] });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/app/driver/outstation-pool/bookings/:id/rate-passenger", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const bookingId = String(req.params.id);
      const overall = Number(req.body?.overallRating);
      const safety = Number(req.body?.safetyRating || overall);
      const cleanliness = Number(req.body?.cleanlinessRating || overall);
      const behaviour = Number(req.body?.behaviourRating || overall);
      const punctuality = Number(req.body?.punctualityRating || overall);
      const note = String(req.body?.note || "").slice(0, 1000);
      if (![overall, safety, cleanliness, behaviour, punctuality].every((value) => Number.isFinite(value) && value >= 1 && value <= 5)) {
        return res.status(400).json({ message: "All ratings must be between 1 and 5" });
      }

      const ownR = await rawDb.execute(rawSql`
        SELECT opb.id, opb.ride_id, opb.customer_id
        FROM outstation_pool_bookings opb
        JOIN outstation_pool_rides opr ON opr.id = opb.ride_id
        WHERE opb.id = ${bookingId}::uuid
          AND opr.driver_id = ${driver.id}::uuid
          AND opb.status IN ('dropped', 'completed')
        LIMIT 1
      `);
      if (!ownR.rows.length) return res.status(404).json({ message: "Completed booking not found" });
      const own = ownR.rows[0] as any;

      const inserted = await rawDb.execute(rawSql`
        INSERT INTO pool_ratings (
          module, reference_type, reference_id, ride_id, from_user_id, to_user_id,
          rating_role, overall_rating, safety_rating, cleanliness_rating,
          behaviour_rating, punctuality_rating, note
        )
        VALUES (
          'outstation_pool', 'booking', ${bookingId}::uuid, ${own.ride_id}::uuid, ${driver.id}::uuid, ${own.customer_id}::uuid,
          'driver_to_customer', ${overall}, ${safety}, ${cleanliness}, ${behaviour}, ${punctuality}, ${note}
        )
        ON CONFLICT (reference_type, reference_id, from_user_id, rating_role) DO NOTHING
        RETURNING *
      `);
      if (!inserted.rows.length) return res.status(409).json({ message: "Rating already submitted for this booking" });
      // Completeness fix: this endpoint saved the pool_ratings row but never updated the
      // customer's aggregate users.rating (unlike its rate-driver counterpart above).
      await recomputeUserRating(own.customer_id).catch(() => undefined);
      res.json({ success: true, rating: inserted.rows[0] });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/pool/operations/overview", adminAuth, async (_req: any, res: any) => {
    try {
      const [outstationStatsR, localStatsR, issueStatsR, refundStatsR, ratingsR] = await Promise.all([
        rawDb.execute(rawSql`
          SELECT
            COUNT(*)::int AS total_bookings,
            COUNT(*) FILTER (WHERE status = 'confirmed')::int AS active_bookings,
            COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_bookings,
            COALESCE(SUM(seats_booked), 0)::int AS seats_booked,
            COALESCE(SUM(total_fare), 0)::numeric AS revenue
          FROM outstation_pool_bookings
        `).catch(() => ({ rows: [{ total_bookings: 0, active_bookings: 0, cancelled_bookings: 0, seats_booked: 0, revenue: 0 }] as any[] })),
        rawDb.execute(rawSql`
          SELECT
            COUNT(*)::int AS total_local_bookings,
            COUNT(*) FILTER (WHERE status IN ('matched', 'picked_up'))::int AS active_local_bookings,
            COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_local_bookings,
            COALESCE(SUM(seats_requested), 0)::int AS local_seats_booked,
            COALESCE(SUM(total_fare), 0)::numeric AS local_revenue
          FROM pool_ride_requests
        `).catch(() => ({ rows: [{ total_local_bookings: 0, active_local_bookings: 0, cancelled_local_bookings: 0, local_seats_booked: 0, local_revenue: 0 }] as any[] })),
        rawDb.execute(rawSql`
          SELECT
            COUNT(*)::int AS total_issues,
            COUNT(*) FILTER (WHERE status IN ('open', 'under_review'))::int AS open_issues,
            COUNT(*) FILTER (WHERE issue_channel = 'dispute')::int AS disputes,
            COUNT(*) FILTER (WHERE issue_channel = 'report')::int AS reports
          FROM pool_issue_cases
        `).catch(() => ({ rows: [{ total_issues: 0, open_issues: 0, disputes: 0, reports: 0 }] as any[] })),
        rawDb.execute(rawSql`
          SELECT
            COUNT(*)::int AS total_refunds,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_refunds,
            COALESCE(SUM(amount), 0)::numeric AS refund_value
          FROM refund_requests
          WHERE reason ILIKE '%pool%'
        `).catch(() => ({ rows: [{ total_refunds: 0, pending_refunds: 0, refund_value: 0 }] as any[] })),
        rawDb.execute(rawSql`
          SELECT
            COUNT(*)::int AS total_ratings,
            COALESCE(AVG(overall_rating), 0)::numeric AS avg_rating
          FROM pool_ratings
        `).catch(() => ({ rows: [{ total_ratings: 0, avg_rating: 0 }] as any[] })),
      ]);

      res.json({
        outstation: outstationStatsR.rows[0] || {},
        local: localStatsR.rows[0] || {},
        issues: issueStatsR.rows[0] || {},
        refunds: refundStatsR.rows[0] || {},
        ratings: ratingsR.rows[0] || {},
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/pool/issues", adminAuth, async (req: any, res: any) => {
    try {
      const status = String(req.query.status || "all");
      const r = await rawDb.execute(rawSql`
        SELECT pic.*,
               cu.full_name AS customer_name,
               du.full_name AS driver_name,
               ru.full_name AS reported_user_name
        FROM pool_issue_cases pic
        LEFT JOIN users cu ON cu.id = pic.customer_id
        LEFT JOIN users du ON du.id = pic.driver_id
        LEFT JOIN users ru ON ru.id = pic.reported_user_id
        ${status !== "all" ? rawSql`WHERE pic.status = ${status}` : rawSql``}
        ORDER BY pic.created_at DESC
        LIMIT 200
      `);
      res.json({ items: (r.rows as any[]).map((row) => ({ ...row, timeline: buildIssueTimeline(row) })) });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/pool/issues/:id", adminAuth, async (req: any, res: any) => {
    try {
      const id = String(req.params.id);
      const r = await rawDb.execute(rawSql`
        SELECT pic.*,
               cu.full_name AS customer_name,
               du.full_name AS driver_name,
               ru.full_name AS reported_user_name
        FROM pool_issue_cases pic
        LEFT JOIN users cu ON cu.id = pic.customer_id
        LEFT JOIN users du ON du.id = pic.driver_id
        LEFT JOIN users ru ON ru.id = pic.reported_user_id
        WHERE pic.id = ${id}::uuid
        LIMIT 1
      `);
      if (!r.rows.length) return res.status(404).json({ message: "Issue not found" });
      const item = r.rows[0] as any;
      res.json({ item: { ...item, timeline: buildIssueTimeline(item) } });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/pool/issues/:id", adminAuth, async (req: any, res: any) => {
    try {
      const id = String(req.params.id);
      const nextStatus = String(req.body?.status || "under_review");
      const resolutionNote = String(req.body?.resolutionNote || "").slice(0, 1500);
      const adminMessage = String(req.body?.adminMessage || "").slice(0, 1000);
      const blockReportedUser = req.body?.blockReportedUser === true;
      const validStatuses = new Set(["open", "under_review", "resolved", "rejected"]);
      if (!validStatuses.has(nextStatus)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      const existingR = await rawDb.execute(rawSql`
        SELECT * FROM pool_issue_cases WHERE id = ${id}::uuid LIMIT 1
      `);
      if (!existingR.rows.length) return res.status(404).json({ message: "Issue not found" });
      const existing = existingR.rows[0] as any;
      const adminUpdates = parseJsonArray(existing.admin_updates);
      if (adminMessage || nextStatus !== normalizeIssueStatus(existing.status)) {
        adminUpdates.push({
          status: nextStatus,
          message: adminMessage || resolutionNote || `Status updated to ${nextStatus.replace(/_/g, " ")}`,
          author: "Admin",
          createdAt: new Date().toISOString(),
        });
      }
      const updated = await rawDb.execute(rawSql`
        UPDATE pool_issue_cases
        SET status = ${nextStatus},
            resolution_note = ${resolutionNote},
            admin_updates = ${JSON.stringify(adminUpdates)}::jsonb,
            updated_at = NOW()
        WHERE id = ${id}::uuid
        RETURNING *
      `);
      const item = updated.rows[0] as any;
      if (blockReportedUser && item?.reported_user_id && item?.customer_id && item?.reported_user_id !== item?.customer_id) {
        await rawDb.execute(rawSql`
          INSERT INTO pool_user_blocks (
            blocker_user_id, blocked_user_id, module, reference_type, reference_id, created_by_role, reason
          )
          VALUES (
            ${item.customer_id}::uuid, ${item.reported_user_id}::uuid, ${item.module || "pool"},
            ${item.reference_type || null}, ${item.reference_id || null}::uuid, 'admin', ${resolutionNote || adminMessage || 'Blocked by operations after review'}
          )
          ON CONFLICT (blocker_user_id, blocked_user_id, module) WHERE active = true DO NOTHING
        `).catch(() => undefined);
      }
      const payload = buildPoolRealtimePayload(String(item.module || "outstation_pool"), String(item.reference_id), {
        issueId: String(item.id),
        status: String(item.status || nextStatus),
      });
      if (item?.customer_id) {
        io.to(`user:${item.customer_id}`).emit("pool:issue_updated", payload);
      }
      if (item?.driver_id) {
        io.to(`user:${item.driver_id}`).emit("pool:issue_updated", payload);
      }
      if (blockReportedUser && item?.reported_user_id) {
        const safetyPayload = buildPoolRealtimePayload(String(item.module || "outstation_pool"), String(item.reference_id), {
          issueId: String(item.id),
          status: String(item.status || nextStatus),
          blockedUserId: String(item.reported_user_id),
        });
        io.to(`user:${item.customer_id}`).emit("pool:safety_updated", safetyPayload);
        io.to(`user:${item.driver_id}`).emit("pool:safety_updated", safetyPayload);
      }
      void sendPoolPush(
        String(item.customer_id),
        "Pool issue updated",
        adminMessage || resolutionNote || `Issue status updated to ${String(item.status || nextStatus).replace(/_/g, " ")}`,
        {
          type: blockReportedUser ? "pool_safety_update" : "pool_dispute_update",
          module: String(item.module || "outstation_pool"),
          referenceId: String(item.reference_id),
          issueId: String(item.id),
          status: String(item.status || nextStatus),
        },
      );
      res.json({ success: true, item: { ...item, timeline: buildIssueTimeline(item) } });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/pool/blocks", adminAuth, async (_req: any, res: any) => {
    try {
      const r = await rawDb.execute(rawSql`
        SELECT pub.*,
               bu.full_name AS blocker_name,
               tu.full_name AS blocked_name
        FROM pool_user_blocks pub
        LEFT JOIN users bu ON bu.id = pub.blocker_user_id
        LEFT JOIN users tu ON tu.id = pub.blocked_user_id
        WHERE pub.active = true
        ORDER BY pub.created_at DESC
        LIMIT 100
      `);
      res.json({ items: r.rows });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/pool/ratings", adminAuth, async (_req: any, res: any) => {
    try {
      const r = await rawDb.execute(rawSql`
        SELECT pr.*,
               fu.full_name AS from_user_name,
               tu.full_name AS to_user_name
        FROM pool_ratings pr
        LEFT JOIN users fu ON fu.id = pr.from_user_id
        LEFT JOIN users tu ON tu.id = pr.to_user_id
        ORDER BY pr.created_at DESC
        LIMIT 100
      `);
      res.json({ items: r.rows });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/pool/safety-review", adminAuth, async (_req: any, res: any) => {
    try {
      const [alertsR, summaryR] = await Promise.all([
        rawDb.execute(rawSql`
          SELECT sa.id, sa.trip_id, sa.triggered_by, sa.notes, sa.status, sa.created_at,
                 u.full_name AS user_name, u.phone AS user_phone
          FROM safety_alerts sa
          LEFT JOIN users u ON u.id = sa.user_id
          WHERE sa.alert_type = 'sos'
            AND (
              COALESCE(sa.notes, '') ILIKE '%pool%'
              OR EXISTS (SELECT 1 FROM outstation_pool_bookings opb WHERE opb.id = sa.trip_id::uuid)
              OR EXISTS (SELECT 1 FROM pool_ride_requests prr WHERE prr.id = sa.trip_id::uuid)
            )
          ORDER BY sa.created_at DESC
          LIMIT 50
        `).catch(() => ({ rows: [] as any[] })),
        rawDb.execute(rawSql`
          SELECT
            (SELECT COUNT(*)::int FROM safety_alerts sa
              WHERE sa.alert_type = 'sos'
                AND sa.status = 'active'
                AND (
                  COALESCE(sa.notes, '') ILIKE '%pool%'
                  OR EXISTS (SELECT 1 FROM outstation_pool_bookings opb WHERE opb.id = sa.trip_id::uuid)
                  OR EXISTS (SELECT 1 FROM pool_ride_requests prr WHERE prr.id = sa.trip_id::uuid)
                )
            ) AS active_sos,
            (SELECT COUNT(*)::int FROM pool_issue_cases WHERE issue_channel = 'dispute' AND status IN ('open', 'under_review')) AS open_disputes,
            (SELECT COUNT(*)::int FROM pool_user_blocks WHERE active = true) AS active_blocks
        `).catch(() => ({ rows: [{ active_sos: 0, open_disputes: 0, active_blocks: 0 }] as any[] })),
      ]);
      res.json({ alerts: alertsR.rows, summary: summaryR.rows[0] || { active_sos: 0, open_disputes: 0, active_blocks: 0 } });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/pool/blocks", adminAuth, async (req: any, res: any) => {
    try {
      const blockerUserId = String(req.body?.blockerUserId || "").trim();
      const blockedUserId = String(req.body?.blockedUserId || "").trim();
      const module = String(req.body?.module || "pool");
      const reason = String(req.body?.reason || "Blocked by operations").slice(0, 300);
      if (!blockerUserId || !blockedUserId) return res.status(400).json({ message: "Both users are required" });
      await rawDb.execute(rawSql`
        INSERT INTO pool_user_blocks (
          blocker_user_id, blocked_user_id, module, created_by_role, reason
        )
        VALUES (${blockerUserId}::uuid, ${blockedUserId}::uuid, ${module}, 'admin', ${reason})
        ON CONFLICT (blocker_user_id, blocked_user_id, module) WHERE active = true DO NOTHING
      `);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });
}
