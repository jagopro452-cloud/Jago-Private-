/**
 * Outstation Pool — Scheduled Auto-Assignment Matcher
 *
 * Upgrades Outstation Pool from a driver-posts/customer-browses marketplace
 * into a scheduled auto-dispatch flow, mirroring the existing Local Pool
 * engine (server/rolling-pool.ts: driver_pool_sessions + pool_ride_requests)
 * but matched by ROUTE + DEPARTURE TIME WINDOW instead of live GPS proximity.
 *
 * Flow:
 *   1. Driver goes "available for outstation" for a route + time window
 *      (outstation_driver_availability) instead of hand-building a full ride.
 *   2. Customer requests a route + time window (outstation_pool_requests)
 *      and pays a small non-refundable advance to discourage no-shows.
 *   3. Matcher (30s loop) pairs searching requests to available drivers on
 *      the same route with an overlapping time window and enough seats.
 *   4. Driver accepts (mirrors the existing IncomingTripSheet accept/skip
 *      pattern) — the FIRST accepted passenger creates a row in the
 *      existing, unchanged outstation_pool_rides table; every accepted
 *      passenger becomes an outstation_pool_bookings row using the same
 *      calcSegmentFare pricing logic already used by manual postings.
 *      From that point on, the existing outstation-pool-v2.ts trip
 *      execution pipeline (start/pickup/drop/complete) takes over untouched.
 *   5. 1 hour before departure, a push notification confirms the assigned
 *      driver/vehicle to each matched passenger.
 */

import type { Express } from "express";
import { rawDb, rawSql, pool as dbPool } from "./db";
import { io } from "./socket";
import { sendFcmNotification } from "./fcm";
import { calculateRevenueBreakdown } from "./revenue-engine";
import { enforceDriverRevenuePolicy } from "./revenue-policy";
import { assertSchemaObjectsOrThrow } from "./schema-health";
import {
  calcSegmentFare,
  isPoolVehicleCategory,
  applyOutstationPriceCaps,
  DEFAULT_PRICE_PER_KM_PER_SEAT,
  MIN_FARE_PER_BOOKING,
} from "./outstation-pool-v2";

const MATCHER_INTERVAL_MS = 30_000; // outstation matching is less time-sensitive than live city pickup
const DRIVER_ACCEPT_TIMEOUT_SEC = 45;
const SEARCH_TIMEOUT_MIN = 60; // scheduled requests can wait longer than a live pickup search
const ADVANCE_AMOUNT = 75; // flat non-refundable booking fee (₹50–100 range agreed)
const PRE_DEPARTURE_NOTIFY_MINUTES = 60;

let matcherStarted = false;

async function getLatestFcmToken(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const r = await rawDb.execute(rawSql`
    SELECT fcm_token FROM user_devices
    WHERE user_id = ${userId}::uuid AND fcm_token IS NOT NULL AND fcm_token != ''
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  return ((r.rows[0] as any)?.fcm_token || null) as string | null;
}

async function sendPoolPush(userId: string | null | undefined, title: string, body: string, data: Record<string, string>) {
  const token = await getLatestFcmToken(userId);
  if (!token) return false;
  return sendFcmNotification({ fcmToken: token, title, body, channelId: "trip_alerts_v2", sound: "trip_alert", data }).catch(() => false);
}

export async function ensureOutstationPoolMatchingSchema(): Promise<void> {
  await assertSchemaObjectsOrThrow({
    tables: ["outstation_driver_availability", "outstation_pool_requests"],
  });
  console.log("[OUTSTATION-MATCHER] Schema verified");
}

// ── Core matching ──────────────────────────────────────────────────────────

async function findBestAvailability(
  fromCity: string, toCity: string,
  earliestDeparture: string, latestDeparture: string,
  seatsNeeded: number,
  vehicleCategoryId?: string | null,
): Promise<{ availabilityId: string; driverId: string } | null> {
  const categoryClause = vehicleCategoryId
    ? rawSql`AND oda.vehicle_category_id = ${vehicleCategoryId}::uuid`
    : rawSql``;
  const r = await rawDb.execute(rawSql`
    SELECT oda.id, oda.driver_id
    FROM outstation_driver_availability oda
    WHERE oda.status = 'available'
      AND oda.available_seats >= ${seatsNeeded}
      AND lower(oda.from_city) = lower(${fromCity})
      AND lower(oda.to_city) = lower(${toCity})
      AND oda.earliest_departure <= ${latestDeparture}::timestamp
      AND oda.latest_departure >= ${earliestDeparture}::timestamp
      ${categoryClause}
    ORDER BY oda.created_at ASC
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const row = r.rows[0] as any;
  if (!row) return null;
  return { availabilityId: String(row.id), driverId: String(row.driver_id) };
}

async function matchRequest(requestId: string): Promise<boolean> {
  const reqR = await rawDb.execute(rawSql`
    SELECT * FROM outstation_pool_requests WHERE id = ${requestId}::uuid AND status = 'searching' LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const req = reqR.rows[0] as any;
  if (!req) return false;

  const match = await findBestAvailability(
    req.from_city, req.to_city,
    req.earliest_departure, req.latest_departure,
    parseInt(req.seats_requested),
    req.vehicle_category_id || null,
  );
  if (!match) return false;

  const txClient = await dbPool.connect();
  try {
    await txClient.query("BEGIN");
    const lockR = await txClient.query(
      `SELECT available_seats FROM outstation_driver_availability
       WHERE id = $1 AND status = 'available' AND available_seats >= $2
       FOR UPDATE`,
      [match.availabilityId, parseInt(req.seats_requested)],
    );
    if (!lockR.rows.length) {
      await txClient.query("ROLLBACK");
      return false;
    }
    await txClient.query(
      `UPDATE outstation_pool_requests
       SET proposed_availability_id = $1, status = 'pending_driver_accept',
           seat_lock_expires_at = NOW() + INTERVAL '45 seconds', updated_at = NOW()
       WHERE id = $2`,
      [match.availabilityId, requestId],
    );
    await txClient.query(
      `UPDATE outstation_driver_availability
       SET available_seats = available_seats - $1, updated_at = NOW()
       WHERE id = $2`,
      [parseInt(req.seats_requested), match.availabilityId],
    );
    await txClient.query("COMMIT");
  } catch (e: any) {
    console.error("[OUTSTATION-MATCHER] match transaction failed", e?.message);
    await txClient.query("ROLLBACK").catch(() => undefined);
    return false;
  } finally {
    txClient.release();
  }

  const custR = await rawDb.execute(rawSql`
    SELECT full_name, phone FROM users WHERE id = ${req.customer_id}::uuid LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const cust = (custR.rows[0] as any) || {};

  io.to(`user:${match.driverId}`).emit("outstation_pool:new_request", {
    requestId,
    availabilityId: match.availabilityId,
    customerName: cust.full_name || "Passenger",
    customerPhone: cust.phone,
    fromCity: req.from_city,
    toCity: req.to_city,
    pickupAddress: req.pickup_address,
    dropAddress: req.drop_address,
    seatsRequested: parseInt(req.seats_requested),
    earliestDeparture: req.earliest_departure,
    latestDeparture: req.latest_departure,
    expiresInSeconds: DRIVER_ACCEPT_TIMEOUT_SEC,
    requiresDriverAccept: true,
  });
  void sendPoolPush(match.driverId, "New Outstation Pool Request",
    `${req.from_city} → ${req.to_city}, ${req.seats_requested} seat(s)`,
    { type: "outstation_pool_request", requestId });

  io.to(`user:${req.customer_id}`).emit("outstation_pool:matched_pending", {
    requestId,
    availabilityId: match.availabilityId,
    seatLockExpiresAt: new Date(Date.now() + DRIVER_ACCEPT_TIMEOUT_SEC * 1000).toISOString(),
    message: "A compatible driver was found. Waiting for confirmation.",
  });

  return true;
}

async function releaseExpiredProposals(): Promise<void> {
  const expiredR = await rawDb.execute(rawSql`
    WITH expired AS (
      SELECT id, customer_id, proposed_availability_id, seats_requested
      FROM outstation_pool_requests
      WHERE status = 'pending_driver_accept' AND seat_lock_expires_at <= NOW()
    ),
    released AS (
      UPDATE outstation_pool_requests opr
      SET status = 'searching', proposed_availability_id = NULL, seat_lock_expires_at = NULL, updated_at = NOW()
      FROM expired WHERE opr.id = expired.id
      RETURNING expired.id, expired.customer_id, expired.proposed_availability_id, expired.seats_requested
    )
    SELECT * FROM released
  `).catch(() => ({ rows: [] as any[] }));

  for (const row of expiredR.rows as any[]) {
    if (row.proposed_availability_id) {
      await rawDb.execute(rawSql`
        UPDATE outstation_driver_availability
        SET available_seats = available_seats + ${parseInt(row.seats_requested)}, updated_at = NOW()
        WHERE id = ${row.proposed_availability_id}::uuid
      `).catch(() => undefined);
    }
    io.to(`user:${row.customer_id}`).emit("outstation_pool:search_continuing", { requestId: row.id });
  }
}

async function cancelStaleSearches(): Promise<void> {
  const staleR = await rawDb.execute(rawSql`
    UPDATE outstation_pool_requests
    SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = 'no_driver_found', updated_at = NOW()
    WHERE status = 'searching'
      AND searched_at < NOW() - INTERVAL '${rawSql.raw(String(SEARCH_TIMEOUT_MIN))} minutes'
    RETURNING id, customer_id
  `).catch(() => ({ rows: [] as any[] }));
  for (const row of staleR.rows as any[]) {
    io.to(`user:${(row as any).customer_id}`).emit("outstation_pool:no_driver", {
      requestId: (row as any).id,
      message: "No pool driver found for this route/time. Try a regular outstation booking.",
    });
  }
}

async function notifyUpcomingDepartures(): Promise<void> {
  const r = await rawDb.execute(rawSql`
    SELECT b.id AS booking_id, b.customer_id, b.seats_booked,
           r.departure_date, r.departure_time, r.driver_id, r.vehicle_number, r.vehicle_model,
           d.full_name AS driver_name, d.phone AS driver_phone
    FROM outstation_pool_bookings b
    JOIN outstation_pool_rides r ON r.id = b.ride_id
    JOIN users d ON d.id = r.driver_id
    WHERE b.status = 'confirmed'
      AND COALESCE(b.notified_1h, false) = false
      AND r.departure_date IS NOT NULL AND r.departure_time IS NOT NULL
      AND (r.departure_date::text || ' ' || r.departure_time::text)::timestamp
          BETWEEN NOW() + INTERVAL '${rawSql.raw(String(PRE_DEPARTURE_NOTIFY_MINUTES - 5))} minutes'
              AND NOW() + INTERVAL '${rawSql.raw(String(PRE_DEPARTURE_NOTIFY_MINUTES))} minutes'
  `).catch(() => ({ rows: [] as any[] }));

  for (const row of r.rows as any[]) {
    void sendPoolPush(row.customer_id, "Your Outstation Ride Departs in 1 Hour",
      `${row.driver_name} — ${row.vehicle_model || ""} ${row.vehicle_number || ""}`.trim(),
      { type: "outstation_pool_predeparture", bookingId: row.booking_id });
    await rawDb.execute(rawSql`
      UPDATE outstation_pool_bookings SET notified_1h = true WHERE id = ${row.booking_id}::uuid
    `).catch(() => undefined);
  }
}

async function runMatcher(): Promise<void> {
  try {
    const searchingR = await rawDb.execute(rawSql`
      SELECT id FROM outstation_pool_requests WHERE status = 'searching'
    `).catch(() => ({ rows: [] as any[] }));
    for (const row of searchingR.rows as any[]) {
      matchRequest(String((row as any).id)).catch((e) => console.error("[OUTSTATION-MATCHER] matchRequest failed", e?.message));
    }
    await releaseExpiredProposals();
    await cancelStaleSearches();
    await notifyUpcomingDepartures();
  } catch (e: any) {
    console.error("[OUTSTATION-MATCHER] error", e?.message);
  }
}

export function startOutstationPoolMatcher(): void {
  if (matcherStarted) return;
  matcherStarted = true;
  setInterval(runMatcher, MATCHER_INTERVAL_MS);
  console.log("[OUTSTATION-MATCHER] matcher started");
}

// ── Routes ───────────────────────────────────────────────────────────────

export function registerOutstationPoolMatchingRoutes(app: Express, authApp: any): void {
  ensureOutstationPoolMatchingSchema()
    .then(() => startOutstationPoolMatcher())
    .catch((e) => console.error("[OUTSTATION-MATCHER] schema init failed", e?.message));

  // ─── DRIVER: Go available for outstation pool (replaces manual ride posting) ───
  app.post("/api/app/driver/outstation-pool/availability", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const {
        fromCity, toCity, fromLat, fromLng, toLat, toLng,
        seatCapacity = 4, pricePerKmPerSeat,
        earliestDeparture, latestDeparture,
      } = req.body;
      if (!fromCity || !toCity) return res.status(400).json({ message: "fromCity and toCity required" });
      if (!earliestDeparture || !latestDeparture) {
        return res.status(400).json({ message: "earliestDeparture and latestDeparture required" });
      }

      const catR = await rawDb.execute(rawSql`
        SELECT dd.vehicle_category_id, vc.is_carpool, vc.service_type, vc.type, vc.vehicle_type, vc.name
        FROM driver_details dd
        LEFT JOIN vehicle_categories vc ON vc.id = dd.vehicle_category_id
        WHERE dd.user_id = ${driver.id}::uuid LIMIT 1
      `).catch(() => ({ rows: [] as any[] }));
      const category = catR.rows[0] as any;
      if (!isPoolVehicleCategory(category)) {
        return res.status(403).json({
          message: "Only approved pool-enabled drivers can go available for outstation pool",
          code: "OUTSTATION_POOL_DRIVER_NOT_ELIGIBLE",
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

      const seats = Math.min(Math.max(parseInt(String(seatCapacity)) || 4, 1), 8);
      const pkmps = await applyOutstationPriceCaps(parseFloat(String(pricePerKmPerSeat)) || DEFAULT_PRICE_PER_KM_PER_SEAT);

      const r = await rawDb.execute(rawSql`
        INSERT INTO outstation_driver_availability
          (driver_id, vehicle_category_id, from_city, to_city, from_lat, from_lng, to_lat, to_lng,
           seat_capacity, available_seats, price_per_km_per_seat, earliest_departure, latest_departure, status)
        VALUES
          (${driver.id}::uuid, ${category.vehicle_category_id || null}::uuid, ${fromCity}, ${toCity},
           ${fromLat || null}, ${fromLng || null}, ${toLat || null}, ${toLng || null},
           ${seats}, ${seats}, ${pkmps}, ${earliestDeparture}::timestamp, ${latestDeparture}::timestamp, 'available')
        RETURNING *
      `);
      res.json({ success: true, availability: r.rows[0] });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch("/api/app/driver/outstation-pool/availability/:id/end", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      await rawDb.execute(rawSql`
        UPDATE outstation_driver_availability
        SET status = 'ended', ended_at = NOW(), updated_at = NOW()
        WHERE id = ${req.params.id}::uuid AND driver_id = ${driver.id}::uuid
      `);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/app/driver/outstation-pool/availability/mine", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const r = await rawDb.execute(rawSql`
        SELECT * FROM outstation_driver_availability
        WHERE driver_id = ${driver.id}::uuid AND status = 'available'
        ORDER BY created_at DESC LIMIT 1
      `).catch(() => ({ rows: [] as any[] }));
      res.json({ availability: r.rows[0] || null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── DRIVER: Accept / skip a pooled request ─────────────────────────────
  app.post("/api/app/driver/outstation-pool/requests/:id/accept", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const requestId = req.params.id;

      const reqR = await rawDb.execute(rawSql`
        SELECT opr.*, oda.driver_id AS avail_driver_id, oda.from_lat, oda.from_lng, oda.to_lat, oda.to_lng,
               oda.price_per_km_per_seat, oda.vehicle_category_id, oda.seat_capacity, oda.available_seats,
               oda.matched_ride_id
        FROM outstation_pool_requests opr
        JOIN outstation_driver_availability oda ON oda.id = opr.proposed_availability_id
        WHERE opr.id = ${requestId}::uuid AND opr.status = 'pending_driver_accept'
        LIMIT 1
      `).catch(() => ({ rows: [] as any[] }));
      const reqRow = reqR.rows[0] as any;
      if (!reqRow) return res.status(404).json({ message: "Request not found or already handled" });
      if (String(reqRow.avail_driver_id) !== String(driver.id)) {
        return res.status(403).json({ message: "Not your request to accept" });
      }

      let rideId = reqRow.matched_ride_id;
      if (!rideId) {
        // First accepted passenger on this availability window — form the ride now,
        // reusing the exact shape the existing manual-posting endpoint writes.
        const routeKm = (reqRow.from_lat && reqRow.to_lat)
          ? await computeHaversineKm(reqRow.from_lat, reqRow.from_lng, reqRow.to_lat, reqRow.to_lng)
          : 0;
        const pkmps = parseFloat(reqRow.price_per_km_per_seat || DEFAULT_PRICE_PER_KM_PER_SEAT);
        const farePerSeat = Math.round(Math.max(MIN_FARE_PER_BOOKING, pkmps * routeKm) * 100) / 100;

        const rideR = await rawDb.execute(rawSql`
          INSERT INTO outstation_pool_rides
            (driver_id, vehicle_category_id, from_city, to_city, from_lat, from_lng, to_lat, to_lng,
             route_km, total_seats, available_seats, fare_per_seat, price_per_km_per_seat,
             status, is_active, formed_via)
          VALUES
            (${driver.id}::uuid, ${reqRow.vehicle_category_id}::uuid, ${reqRow.from_city}, ${reqRow.to_city},
             ${reqRow.from_lat}, ${reqRow.from_lng}, ${reqRow.to_lat}, ${reqRow.to_lng},
             ${routeKm}, ${reqRow.seat_capacity}, ${reqRow.seat_capacity}, ${farePerSeat}, ${pkmps},
             'scheduled', true, 'pooled')
          RETURNING id
        `);
        rideId = (rideR.rows[0] as any).id;
        await rawDb.execute(rawSql`
          UPDATE outstation_driver_availability SET matched_ride_id = ${rideId}::uuid, updated_at = NOW()
          WHERE id = ${reqRow.proposed_availability_id}::uuid
        `);
      }

      const segmentKm = await computeHaversineKm(
        parseFloat(reqRow.from_lat), parseFloat(reqRow.from_lng),
        parseFloat(reqRow.to_lat), parseFloat(reqRow.to_lng),
      );
      const pkmps = parseFloat(reqRow.price_per_km_per_seat || DEFAULT_PRICE_PER_KM_PER_SEAT);
      const { farePerSeat, totalFare } = calcSegmentFare(segmentKm, parseInt(reqRow.seats_requested), pkmps);

      let revenue: any = null;
      try { revenue = await calculateRevenueBreakdown(totalFare, "outstation_pool", driver.id); } catch { /* non-blocking */ }

      const bookR = await rawDb.execute(rawSql`
        INSERT INTO outstation_pool_bookings
          (ride_id, customer_id, seats_booked, total_fare, fare_per_seat, segment_km,
           from_city, to_city, pickup_address, dropoff_address, status, payment_status,
           advance_amount, advance_status,
           commission_amount, gst_amount, insurance_amount, driver_earnings, revenue_model)
        VALUES
          (${rideId}::uuid, ${reqRow.customer_id}::uuid, ${reqRow.seats_requested}, ${totalFare}, ${farePerSeat}, ${segmentKm},
           ${reqRow.from_city}, ${reqRow.to_city}, ${reqRow.pickup_address}, ${reqRow.drop_address}, 'confirmed', 'pending',
           ${reqRow.advance_amount || 0}, ${reqRow.advance_status || 'paid'},
           ${revenue?.commission || 0}, ${revenue?.gst || 0}, ${revenue?.insurance || 0}, ${revenue?.driverEarnings || totalFare}, ${revenue?.model || null})
        RETURNING id
      `);
      const bookingId = (bookR.rows[0] as any).id;

      await rawDb.execute(rawSql`
        UPDATE outstation_pool_requests
        SET status = 'matched', matched_ride_id = ${rideId}::uuid, matched_booking_id = ${bookingId}::uuid, matched_at = NOW(), updated_at = NOW()
        WHERE id = ${requestId}::uuid
      `);

      io.to(`user:${reqRow.customer_id}`).emit("outstation_pool:confirmed", {
        requestId, rideId, bookingId, totalFare, farePerSeat,
      });
      void sendPoolPush(reqRow.customer_id, "Outstation Pool Ride Confirmed",
        `Driver confirmed your ${reqRow.from_city} → ${reqRow.to_city} ride.`,
        { type: "outstation_pool_confirmed", bookingId });

      res.json({ success: true, rideId, bookingId });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/app/driver/outstation-pool/requests/:id/skip", authApp, async (req: any, res: any) => {
    try {
      const driver = req.currentUser;
      const reqR = await rawDb.execute(rawSql`
        SELECT * FROM outstation_pool_requests WHERE id = ${req.params.id}::uuid AND status = 'pending_driver_accept' LIMIT 1
      `).catch(() => ({ rows: [] as any[] }));
      const reqRow = reqR.rows[0] as any;
      if (!reqRow) return res.status(404).json({ message: "Request not found or already handled" });

      await rawDb.execute(rawSql`
        UPDATE outstation_pool_requests
        SET status = 'searching', proposed_availability_id = NULL, seat_lock_expires_at = NULL, updated_at = NOW()
        WHERE id = ${req.params.id}::uuid
      `);
      if (reqRow.proposed_availability_id) {
        await rawDb.execute(rawSql`
          UPDATE outstation_driver_availability
          SET available_seats = available_seats + ${parseInt(reqRow.seats_requested)}, updated_at = NOW()
          WHERE id = ${reqRow.proposed_availability_id}::uuid
        `);
      }
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // ─── CUSTOMER: Request a pooled outstation ride ─────────────────────────
  app.post("/api/app/customer/outstation-pool/requests", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const {
        fromCity, toCity, fromLat, fromLng, toLat, toLng,
        pickupAddress, dropAddress, seatsRequested = 1,
        earliestDeparture, latestDeparture, vehicleCategoryId,
      } = req.body;
      if (!fromCity || !toCity) return res.status(400).json({ message: "fromCity and toCity required" });
      if (!earliestDeparture || !latestDeparture) {
        return res.status(400).json({ message: "earliestDeparture and latestDeparture required" });
      }
      const seats = Math.min(Math.max(parseInt(String(seatsRequested)) || 1, 1), 4);

      // Small non-refundable advance, debited from wallet up front.
      const walletDebit = await rawDb.execute(rawSql`
        UPDATE users SET wallet_balance = wallet_balance - ${ADVANCE_AMOUNT}
        WHERE id = ${customer.id}::uuid AND wallet_balance >= ${ADVANCE_AMOUNT}
        RETURNING wallet_balance
      `);
      if (!walletDebit.rows.length) {
        return res.status(402).json({ message: `Insufficient wallet balance. A ₹${ADVANCE_AMOUNT} advance is required to request a pooled outstation ride.` });
      }

      const r = await rawDb.execute(rawSql`
        INSERT INTO outstation_pool_requests
          (customer_id, vehicle_category_id, from_city, to_city, from_lat, from_lng, to_lat, to_lng,
           pickup_address, drop_address, seats_requested, earliest_departure, latest_departure,
           status, advance_amount, advance_status)
        VALUES
          (${customer.id}::uuid, ${vehicleCategoryId || null}::uuid, ${fromCity}, ${toCity},
           ${fromLat || null}, ${fromLng || null}, ${toLat || null}, ${toLng || null},
           ${pickupAddress || null}, ${dropAddress || null}, ${seats},
           ${earliestDeparture}::timestamp, ${latestDeparture}::timestamp,
           'searching', ${ADVANCE_AMOUNT}, 'paid')
        RETURNING *
      `);
      res.json({ success: true, request: r.rows[0] });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/app/customer/outstation-pool/requests/mine", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const r = await rawDb.execute(rawSql`
        SELECT * FROM outstation_pool_requests
        WHERE customer_id = ${customer.id}::uuid
        ORDER BY created_at DESC LIMIT 20
      `).catch(() => ({ rows: [] as any[] }));
      res.json({ requests: r.rows });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/app/customer/outstation-pool/requests/:id/cancel", authApp, async (req: any, res: any) => {
    try {
      const customer = req.currentUser;
      const reqR = await rawDb.execute(rawSql`
        SELECT * FROM outstation_pool_requests
        WHERE id = ${req.params.id}::uuid AND customer_id = ${customer.id}::uuid
          AND status IN ('searching', 'pending_driver_accept')
        LIMIT 1
      `).catch(() => ({ rows: [] as any[] }));
      const reqRow = reqR.rows[0] as any;
      if (!reqRow) return res.status(404).json({ message: "Request not found or already matched" });

      await rawDb.execute(rawSql`
        UPDATE outstation_pool_requests
        SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = 'customer_cancelled',
            advance_status = 'forfeited', updated_at = NOW()
        WHERE id = ${req.params.id}::uuid
      `);
      if (reqRow.proposed_availability_id) {
        await rawDb.execute(rawSql`
          UPDATE outstation_driver_availability
          SET available_seats = available_seats + ${parseInt(reqRow.seats_requested)}, updated_at = NOW()
          WHERE id = ${reqRow.proposed_availability_id}::uuid
        `);
      }
      // Advance is forfeited per policy — not refunded. Fare (if a booking already
      // exists) is handled by the existing, unchanged outstation-pool-v2 cancel
      // endpoint and its own refund-before/after-departure policy.
      res.json({ success: true, advanceForfeited: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}

async function computeHaversineKm(lat1: number, lng1: number, lat2: number, lng2: number): Promise<number> {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
