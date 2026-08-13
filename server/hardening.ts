/**
 * HARDENING.TS - Critical production safety functions
 * 
 * This module implements all 8 hardening fixes:
 * 1. Driver accept validation (ping verification)
 * 2. Notification failsafe (retry + fallback)
 * 3. Auto timeout system
 * 4. No-show penalties
 * 5. Stale ride cleanup
 * 6. Customer visibility
 * 7. Logging system
 * 8. Real device testing
 */

import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { hasActiveDriverSocket, io } from "./socket";
import { sendFcmNotification } from "./fcm";
import { sendAlert as sendObservabilityAlert } from "./observability";
import { recordHeartbeat } from "./health-checks";
import { withJobLock } from "./job-lock";
// Removed legacy SMS notification logic. Only FCM and socket notifications are supported.

// ═══════════════════════════════════════════════════════════════════════════════
// 🔧 HARDENING SETTINGS LOADER
// ═══════════════════════════════════════════════════════════════════════════════

let hardeningConfig: any = null;

export async function loadHardeningSettings() {
  if (hardeningConfig) return hardeningConfig;
  
  const r = await rawDb.execute(rawSql`
    SELECT * FROM hardening_settings WHERE id = 1 LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  
  hardeningConfig = r.rows[0] || {
    driver_ping_timeout_ms: 5000,
    auto_timeout_search_mins: 2,
    auto_timeout_assigned_mins: 10,
    no_show_driver_penalty: 100,
    no_show_customer_charge: 50,
    no_show_rating_deduction: 0.5,
    no_show_ban_threshold: 3,
    retry_count_fcm: 3,
    retry_backoff_ms: 100,
    stale_ride_cancel_mins: 30,
  };
  
  return hardeningConfig;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📝 STRUCTURED LOGGING (FIX #8)
// ═══════════════════════════════════════════════════════════════════════════════

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  CRITICAL = 4,
}

export async function logEvent(
  level: LogLevel,
  tag: string,
  message: string,
  data?: Record<string, any>
) {
  const timestamp = new Date().toISOString();
  const payload = {
    timestamp,
    level: LogLevel[level],
    tag,
    message,
    data: data || null,
  };
  
  // Console (always)
  const colors: Record<number, string> = {
    [LogLevel.DEBUG]: '\x1b[36m',      // cyan
    [LogLevel.INFO]: '\x1b[32m',       // green
    [LogLevel.WARN]: '\x1b[33m',       // yellow
    [LogLevel.ERROR]: '\x1b[31m',      // red
    [LogLevel.CRITICAL]: '\x1b[41m',   // bg red
  };
  const reset = '\x1b[0m';
  console.log(`${colors[level]}[${LogLevel[level]}]${reset} ${JSON.stringify(payload)}`);
  
  // Database (for WARN and above)
  if (level >= LogLevel.WARN) {
    await rawDb.execute(rawSql`
      INSERT INTO system_logs (level, tag, message, data)
      VALUES (${LogLevel[level]}, ${tag}, ${message}, ${JSON.stringify(data)}::jsonb)
    `).catch(() => {}); // Fail silently
  }
  
  // Alert (for CRITICAL)
  if (level === LogLevel.CRITICAL) {
    await sendAlert({ severity: 'critical', title: tag, body: message });
  }
}

export async function logInfo(tag: string, message: string, data?: any) {
  return logEvent(LogLevel.INFO, tag, message, data);
}
export async function logWarn(tag: string, message: string, data?: any) {
  return logEvent(LogLevel.WARN, tag, message, data);
}
export async function logError(tag: string, message: string, data?: any) {
  return logEvent(LogLevel.ERROR, tag, message, data);
}
export async function logCritical(tag: string, message: string, data?: any) {
  return logEvent(LogLevel.CRITICAL, tag, message, data);
}

/**
 * Send critical alert to monitoring system (Slack, email, DataDog, etc.)
 */
export async function sendAlert(opts: { severity: string; title: string; body: string }) {
  console.warn(`[ALERT-${opts.severity.toUpperCase()}] ${opts.title}: ${opts.body}`);
  await sendObservabilityAlert({
    level: opts.severity === "critical" ? "critical" : "error",
    source: "hardening",
    message: opts.title,
    details: opts.body,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ✅ FIX #1: DRIVER ACCEPT VALIDATION (Ping Verification)
// ═══════════════════════════════════════════════════════════════════════════════

const driverPingTracker = new Map<string, {
  tripId: string;
  timer: NodeJS.Timeout;
  resolve: (result: boolean) => void;
}>();

/**
 * After driver accepts a trip, verify they're still active within 5 seconds.
 * If no ping back → mark as ghost acceptance, reassign to next driver.
 */
export async function verifyDriverAfterAccept(
  driverId: string,
  tripId: string
): Promise<boolean> {
  const config = await loadHardeningSettings();
  const timeoutMs = config.driver_ping_timeout_ms || 5000;

  if (await hasActiveDriverSocket(driverId)) {
    await logInfo('DRIVER-VERIFY', 'Driver already has an active socket after accept', { driverId, tripId });
    return true;
  }
  
  return new Promise((resolve) => {
    // Request socket ping from driver
    const requireResponse = { tripId, requireResponse: true };
    
    if (io) {
      io.to(`driver:${driverId}`).emit('system:ping_request', requireResponse);
      io.to(`user:${driverId}`).emit('system:ping_request', requireResponse);
    }
    
    // Set timeout for ping response
    const timer = setTimeout(async () => {
      const tracked = driverPingTracker.get(driverId);
      if (!tracked || tracked.tripId !== tripId) {
        resolve(false);
        return;
      }
      driverPingTracker.delete(driverId);

      const activeTripCheck = await rawDb.execute(rawSql`
        SELECT
          t.current_status,
          u.current_trip_id,
          dl.is_online,
          dl.updated_at
        FROM trip_requests t
        LEFT JOIN users u ON u.id=${driverId}::uuid
        LEFT JOIN driver_locations dl ON dl.driver_id=${driverId}::uuid
        WHERE t.id=${tripId}::uuid
        LIMIT 1
      `).catch(() => ({ rows: [] as any[] }));
      const activeTrip = activeTripCheck.rows[0] as any;
      const stillClaimed =
        activeTrip &&
        String(activeTrip.current_status || "") === "accepted" &&
        String(activeTrip.current_trip_id || "") === tripId &&
        (
          (await hasActiveDriverSocket(driverId)) ||
          (activeTrip.is_online === true && activeTrip.updated_at && (Date.now() - new Date(activeTrip.updated_at).getTime()) <= 30_000)
        );
      if (stillClaimed) {
        await logInfo('DRIVER-VERIFY', 'Driver accept verified from current-trip state without ping response', {
          driverId,
          tripId,
        });
        resolve(true);
        return;
      }
      
      await logWarn('DRIVER-VERIFY', 'Driver ping timeout - ghost acceptance', {
        driverId,
        tripId,
        timeoutMs,
      });
      
      // Driver didn't respond - treat as rejected
      await reassignTripToNextDriver(tripId, driverId, 'driver_offline');
      resolve(false);
    }, timeoutMs);
    
    driverPingTracker.set(driverId, { tripId, timer, resolve });
    
    // Driver responds within timeout → clear timer and resolve true
    // (Response handled in socket handler below)
  });
}

/**
 * Socket handler: Driver pings back within 5 seconds ✅
 */
export function handleDriverPingResponse(driverId: string) {
  const entry = driverPingTracker.get(driverId);
  if (entry) {
    clearTimeout(entry.timer);
    driverPingTracker.delete(driverId);
    entry.resolve(true);
    
    logInfo('DRIVER-VERIFY', 'Driver ping OK', { driverId, tripId: entry.tripId }).catch(() => {});
    return true;
  }
  return false;
}

/**
 * Reassign trip to next driver after current one fails
 */
async function reassignTripToNextDriver(
  tripId: string,
  failedDriverId: string,
  reason: string
) {
  await logCritical('DISPATCH-REASSIGN', `Trip ${tripId} reassigning due to ${reason}`, { failedDriverId });
  
  await rawDb.execute(rawSql`
    UPDATE users
    SET current_trip_id = NULL
    WHERE id=${failedDriverId}::uuid
      AND current_trip_id=${tripId}::uuid
  `).catch(() => {});

  // Reset trip back to searching and remember the failed driver so dispatch skips them.
  await rawDb.execute(rawSql`
    UPDATE trip_requests
    SET current_status='searching',
        driver_id=NULL,
        driver_accepted_at=NULL,
        driver_arriving_at=NULL,
        updated_at=NOW(),
        rejected_driver_ids = CASE
          WHEN ${failedDriverId}::uuid = ANY(COALESCE(rejected_driver_ids, '{}'::uuid[])) THEN COALESCE(rejected_driver_ids, '{}'::uuid[])
          ELSE array_append(COALESCE(rejected_driver_ids, '{}'::uuid[]), ${failedDriverId}::uuid)
        END
    WHERE id=${tripId}::uuid
  `).catch(() => {});

  // Get trip details
  const tripR = await rawDb.execute(rawSql`
    SELECT
      t.id,
      t.customer_id,
      t.pickup_lat,
      t.pickup_lng,
      t.pickup_address,
      t.destination_address,
      t.estimated_distance,
      t.estimated_fare,
      t.payment_method,
      t.trip_type,
      t.vehicle_category_id,
      t.ref_id,
      t.rejected_driver_ids,
      u.full_name AS customer_name,
      vc.name AS vehicle_name
    FROM trip_requests t
    JOIN users u ON u.id = t.customer_id
    LEFT JOIN vehicle_categories vc ON vc.id = t.vehicle_category_id
    WHERE t.id=${tripId}::uuid
    LIMIT 1
  `);

  if (!tripR.rows.length) return;

  const trip = tripR.rows[0] as any;

  const rejectedIds = Array.isArray(trip.rejected_driver_ids)
    ? trip.rejected_driver_ids.map((id: unknown) => String(id)).filter(Boolean)
    : [];

  const { startDispatch, resolveServiceType } = await import("./dispatch");
  const serviceType = resolveServiceType(trip.trip_type || "ride", trip.vehicle_name || "");

  await notifyCustomerTripStatus(String(trip.customer_id), tripId, "searching", {
    reason,
    message: "Reassigning you to the next available pilot",
  });

  await startDispatch(
    String(tripId),
    String(trip.customer_id),
    Number(trip.pickup_lat),
    Number(trip.pickup_lng),
    trip.vehicle_category_id ? String(trip.vehicle_category_id) : undefined,
    serviceType,
    {
      refId: String(trip.ref_id || ""),
      customerName: String(trip.customer_name || "Customer"),
      pickupAddress: String(trip.pickup_address || ""),
      destinationAddress: String(trip.destination_address || ""),
      pickupLat: Number(trip.pickup_lat),
      pickupLng: Number(trip.pickup_lng),
      estimatedFare: Number(trip.estimated_fare || 0),
      estimatedDistance: Number(trip.estimated_distance || 0),
      paymentMethod: String(trip.payment_method || "cash"),
      tripType: String(trip.trip_type || "ride"),
    },
    trip.vehicle_name ? String(trip.vehicle_name) : undefined,
    rejectedIds,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 📲 FIX #2: NOTIFICATION FAILSAFE (Retry + Fallback)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Send notification with retry logic + fallback channels
 */
export async function sendNotificationWithFailsafe(opts: {
  recipientId: string;
  fcmToken?: string;
  phoneNumber?: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  tripId?: string;
  type?: string;  // 'trip_offer', 'booking_confirmation', etc.
}): Promise<{ success: boolean; channel: string }> {
  const config = await loadHardeningSettings();
  const maxRetries = config.retry_count_fcm || 3;
  const backoffMs = config.retry_backoff_ms || 100;
  
  let lastError: any;
  
  // ════════════════════════════════════════════════════════════════════════════
  // CHANNEL 1: FCM
  // ════════════════════════════════════════════════════════════════════════════
  
  if (opts.fcmToken) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await sendFcmNotification({
          fcmToken: opts.fcmToken,
          title: opts.title,
          body: opts.body,
          data: opts.data,
        });
        
        // Log successful FCM send
        await rawDb.execute(rawSql`
          INSERT INTO notification_logs 
            (recipient_id, trip_id, notification_type, fcm_token, fcm_result, attempt_count, sent_at)
          VALUES 
            (${opts.recipientId}::uuid, ${opts.tripId}::uuid, ${opts.type || 'notification'}, 
             ${opts.fcmToken}, 'sent', ${attempt}, NOW())
        `).catch(() => {});
        
        await logInfo('NOTIFICATION-FCM', 'FCM sent successfully', {
          recipientId: opts.recipientId,
          tripId: opts.tripId,
          attempt,
        });
        
        return { success: true, channel: 'fcm' };
      } catch (e: any) {
        lastError = e;
        
        if (attempt < maxRetries) {
          const delay = backoffMs * Math.pow(2, attempt - 1); // Exponential backoff
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    
    // FCM exhausted
    await logWarn('NOTIFICATION-FCM', `FCM failed after ${maxRetries} attempts`, {
      recipientId: opts.recipientId,
      error: lastError?.message,
    });
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // CHANNEL 2: SOCKET.IO (Fallback for web drivers)
  // ════════════════════════════════════════════════════════════════════════════
  
  if (io) {
    try {
      io.to(`user:${opts.recipientId}`).emit('notification', {
        title: opts.title,
        body: opts.body,
        data: opts.data,
        type: opts.type,
      });
      
      await logInfo('NOTIFICATION-SOCKET', 'Socket notification sent', {
        recipientId: opts.recipientId,
        tripId: opts.tripId,
      });
      
      return { success: true, channel: 'socket' };
    } catch (e: any) {
      lastError = e;
      await logWarn('NOTIFICATION-SOCKET', 'Socket send failed', { error: e.message });
    }
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // SMS fallback removed. Only FCM and socket notifications are supported.
  
  // ════════════════════════════════════════════════════════════════════════════
  // ALL CHANNELS FAILED
  // ════════════════════════════════════════════════════════════════════════════
  
  await logCritical('NOTIFICATION-FAILURE', 'ALL notification channels failed', {
    recipientId: opts.recipientId,
    tripId: opts.tripId,
    attempted: ['fcm', 'socket'].filter(c => {
      if (c === 'fcm') return !!opts.fcmToken;
      if (c === 'socket') return true;
      return false;
    }),
  });
  
  return { success: false, channel: 'none' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ⏰ FIX #3: AUTO TIMEOUT SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Auto-cancel trips that are stuck in searching or assigned state
 * Runs every 30 seconds
 */
export async function autoTimeoutStuckTrips() {
  const config = await loadHardeningSettings();
  const searchTimeoutMins = config.auto_timeout_search_mins || 2;
  const assignedTimeoutMins = config.auto_timeout_assigned_mins || 10;
  
  // ════════════════════════════════════════════════════════════════════════════
  // CASE 1: Searching for > 2 minutes with no driver found
  // ════════════════════════════════════════════════════════════════════════════
  
  const stuckSearching = await rawDb.execute(rawSql`
    SELECT id, customer_id, estimated_fare, payment_method
    FROM trip_requests
    WHERE current_status = 'searching'
      AND created_at < NOW() - (${String(searchTimeoutMins)} || ' minutes')::interval
      AND auto_cancelled = false
    LIMIT 50
  `).catch(() => ({ rows: [] as any[] }));

  for (const trip of stuckSearching.rows) {
    const tripId = (trip as any).id;
    const customerId = (trip as any).customer_id;
    const fare = (trip as any).estimated_fare;
    const paymentMethod = (trip as any).payment_method;

    await autoTimeoutTrip(tripId, customerId, fare, paymentMethod, 'search_timeout');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 2: Driver assigned but not arrived after 10 minutes
  // ════════════════════════════════════════════════════════════════════════════

  const stuckAssigned = await rawDb.execute(rawSql`
    SELECT id, customer_id, driver_id, estimated_fare, payment_method
    FROM trip_requests
    WHERE current_status = 'driver_assigned'
      AND driver_assigned_at < NOW() - (${String(assignedTimeoutMins)} || ' minutes')::interval
      AND auto_cancelled = false
    LIMIT 50
  `).catch(() => ({ rows: [] as any[] }));

  for (const trip of stuckAssigned.rows) {
    const tripId = (trip as any).id;
    const customerId = (trip as any).customer_id;
    const driverId = (trip as any).driver_id;
    const fare = (trip as any).estimated_fare;
    const paymentMethod = (trip as any).payment_method;

    // Mark as driver no-show
    await recordNoShow(driverId, tripId, 'not_arrived');

    await autoTimeoutTrip(tripId, customerId, fare, paymentMethod, 'driver_not_arrived_timeout');
  }
}

async function autoTimeoutTrip(
  tripId: string,
  customerId: string,
  fare: number,
  paymentMethod: string,
  reason: string
) {
  // Cancel trip
  await rawDb.execute(rawSql`
    UPDATE trip_requests
    SET current_status='cancelled', auto_cancelled=true,
        cancellation_reason=${reason}, updated_at=NOW()
    WHERE id=${tripId}::uuid
  `).catch(() => {});

  // Refund only wallet-paid bookings — cash trips never had money deducted from wallet
  const walletPayment = ['wallet', 'prepaid'].includes(String(paymentMethod || '').toLowerCase());
  if (walletPayment && fare > 0) {
    await rawDb.execute(rawSql`
      UPDATE users SET wallet_balance = wallet_balance + ${fare}
      WHERE id=${customerId}::uuid
    `).catch(() => {});
  }

  // Log event
  await logInfo('AUTO-TIMEOUT', `Trip ${reason}`, {
    tripId: tripId.toString().slice(0, 8),
    customerId: customerId.toString().slice(0, 8),
    refundAmount: fare,
  });

  // Notify customer
  const customer = await rawDb.execute(rawSql`
    SELECT fcm_token, phone FROM users WHERE id=${customerId}::uuid
  `).catch(() => ({ rows: [] as any[] }));

  if (customer.rows.length) {
    const cust = customer.rows[0] as any;
    await sendNotificationWithFailsafe({
      recipientId: customerId.toString(),
      fcmToken: cust.fcm_token,
      phoneNumber: cust.phone,
      title: '⏰ Trip Cancelled - Timeout',
      body: walletPayment && fare > 0 ? `No driver found. ₹${fare} refunded to wallet.` : 'No driver found. Your booking has been cancelled.',
      type: 'trip_cancelled',
      tripId: tripId.toString(),
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🚫 FIX #4: NO-SHOW PENALTY SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Record no-show and apply penalties
 */
export async function recordNoShow(
  userId: string,
  tripId: string,
  reason: 'driver_not_at_location' | 'not_arrived' | 'customer_not_found'
) {
  const config = await loadHardeningSettings();
  
  const isDriver = reason === 'driver_not_at_location';
  const penaltyAmount = isDriver 
    ? config.no_show_driver_penalty 
    : config.no_show_customer_charge;
  const ratingDeduction = config.no_show_rating_deduction;
  
  // ════════════════════════════════════════════════════════════════════════════
  // DEDUCT PENALTY
  // ════════════════════════════════════════════════════════════════════════════
  
  await rawDb.execute(rawSql`
    UPDATE users
    SET wallet_balance = wallet_balance - ${penaltyAmount}
    WHERE id=${userId}::uuid
  `).catch(() => {});
  
  // ════════════════════════════════════════════════════════════════════════════
  // DEDUCT RATING
  // ════════════════════════════════════════════════════════════════════════════
  
  if (isDriver) {
    await rawDb.execute(rawSql`
      UPDATE driver_details
      SET avg_rating = GREATEST(1.0, avg_rating - ${ratingDeduction})
      WHERE user_id=${userId}::uuid
    `).catch(() => {});
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // LOG NO-SHOW
  // ════════════════════════════════════════════════════════════════════════════
  
  if (isDriver) {
    await rawDb.execute(rawSql`
      INSERT INTO driver_no_shows (driver_id, trip_id, reason, penalty_amount, rating_deduction)
      VALUES (${userId}::uuid, ${tripId}::uuid, ${reason}, ${penaltyAmount}, ${ratingDeduction})
    `).catch(() => {});
  } else {
    await rawDb.execute(rawSql`
      INSERT INTO customer_no_shows (customer_id, trip_id, reason, charge_amount)
      VALUES (${userId}::uuid, ${tripId}::uuid, ${reason}, ${penaltyAmount})
    `).catch(() => {});
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // CHECK FOR BAN (3+ no-shows in 30 days)
  // ════════════════════════════════════════════════════════════════════════════
  
  const banThreshold = config.no_show_ban_threshold || 3;
  
  const recentNoShows = isDriver
    ? await rawDb.execute(rawSql`
        SELECT COUNT(*) as cnt FROM driver_no_shows
        WHERE driver_id=${userId}::uuid
          AND created_at > NOW() - INTERVAL '30 days'
      `).catch(() => ({ rows: [{ cnt: 0 }] }))
    : await rawDb.execute(rawSql`
        SELECT COUNT(*) as cnt FROM customer_no_shows
        WHERE customer_id=${userId}::uuid
          AND created_at > NOW() - INTERVAL '30 days'
      `).catch(() => ({ rows: [{ cnt: 0 }] }));
  
  const count = (recentNoShows.rows[0] as any)?.cnt || 0;
  
  if (count >= banThreshold) {
    await rawDb.execute(rawSql`
      UPDATE users
      SET is_banned_for_no_show=true, 
          ban_reason=${`${count} no-shows in 30 days`},
          ban_until=NOW() + INTERVAL '7 days'
      WHERE id=${userId}::uuid
    `).catch(() => {});
    
    await logCritical('NO-SHOW-BAN', `User banned for repeated no-shows`, {
      userId: userId.toString().slice(0, 8),
      noShowCount: count,
      banUntil: '7 days',
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🧹 FIX #5: STALE OUTSTATION RIDE CLEANUP
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Auto-cancel outstation rides that are past departure time
 * Refund all customers + notify them
 * Runs every 10 minutes
 */
export async function cleanupStaleOutstationRides() {
  const config = await loadHardeningSettings();
  const cancelMins = config.stale_ride_cancel_mins || 30;
  
  // Find rides past departure time
  const staleRides = await rawDb.execute(rawSql`
    SELECT id, driver_id, from_city, to_city, total_seats, available_seats
    FROM outstation_pool_rides
    WHERE status = 'scheduled'
      AND is_active = true
      AND CONCAT(departure_date, ' ', COALESCE(departure_time, '00:00'))::timestamp
          < NOW() - (${String(cancelMins)} || ' minutes')::interval
    LIMIT 100
  `).catch(() => ({ rows: [] as any[] }));
  
  for (const ride of staleRides.rows) {
    const rideId = (ride as any).id;
    const driverId = (ride as any).driver_id;
    
    // Get all confirmed bookings
    const bookings = await rawDb.execute(rawSql`
      SELECT * FROM outstation_pool_bookings
      WHERE ride_id=${rideId}::uuid AND status='confirmed'
    `).catch(() => ({ rows: [] as any[] }));
    
    // Refund each customer
    for (const booking of bookings.rows) {
      const b = booking as any;
      const customerId = b.customer_id;
      const totalFare = b.total_fare;
      
      // Refund wallet
      await rawDb.execute(rawSql`
        UPDATE users SET wallet_balance = wallet_balance + ${totalFare}
        WHERE id=${customerId}::uuid
      `).catch(() => {});
      
      // Update booking
      await rawDb.execute(rawSql`
        UPDATE outstation_pool_bookings
        SET status='refunded', payment_status='refunded_to_wallet',
            refund_processed_at=NOW(), refund_amount=${totalFare}
        WHERE id=${b.id}::uuid
      `).catch(() => {});
      
      // Notify customer
      const customer = await rawDb.execute(rawSql`
        SELECT fcm_token, phone FROM users WHERE id=${customerId}::uuid
      `).catch(() => ({ rows: [] as any[] }));
      
      if (customer.rows.length) {
        const cust = customer.rows[0] as any;
        await sendNotificationWithFailsafe({
          recipientId: customerId.toString(),
          fcmToken: cust.fcm_token,
          phoneNumber: cust.phone,
          title: '🚗 Ride Cancelled',
          body: `Outstation ride past departure time. ₹${totalFare} refunded.`,
          type: 'ride_cancelled',
        });
      }
    }
    
    // Cancel the ride
    await rawDb.execute(rawSql`
      UPDATE outstation_pool_rides
      SET status='cancelled', is_active=false, 
          auto_cancelled_at=NOW(),
          auto_cancel_reason='past_departure_time'
      WHERE id=${rideId}::uuid
    `).catch(() => {});
    
    await logInfo('STALE-RIDE-CLEANUP', 'Outstation ride auto-cancelled', {
      rideId: rideId.toString().slice(0, 8),
      refundedCustomers: bookings.rows.length,
      totalRefunded: bookings.rows.reduce((s: number, b: any) => s + (b.total_fare || 0), 0),
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 👁️ FIX #6: CUSTOMER VISIBILITY (Trip Status Updates in Real-Time)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Emit trip status update to customer (in real-time via socket)
 * Called whenever trip state changes
 */
export async function notifyCustomerTripStatus(
  customerId: string,
  tripId: string,
  status: string,
  meta?: Record<string, any>
) {
  if (io) {
    io.to(`user:${customerId}`).emit('trip:status_update', {
      tripId,
      status,  // 'searching', 'driver_assigned', 'driver_arriving', 'trip_started', 'completed'
      timestamp: new Date(),
      meta,
    });
  }
  
  // Also log for record
  await logInfo('CUSTOMER-VISIBILITY', `Trip status update: ${status}`, {
    customerId: customerId.toString().slice(0, 8),
    tripId: tripId.toString().slice(0, 8),
    meta,
  });
}

/**
 * Allow customer to see search progress
 */
export async function updateCustomerSearchProgress(
  customerId: string,
  tripId: string,
  progressData: {
    radiusKm: number;
    driversSearching: number;
    elapsedSeconds: number;
    message: string;
  }
) {
  if (io) {
    io.to(`user:${customerId}`).emit('trip:search_progress', {
      tripId,
      ...progressData,
      timestamp: new Date(),
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🧪 FIX #7 & #8: LOGGING & REAL DEVICE TESTING
// ═══════════════════════════════════════════════════════════════════════════════

// Logging already exported above (logInfo, logWarn, logError, logCritical)

/**
 * Create test trip for real device testing
 */
export async function createTestTrip(
  customerId: string,
  testType: 'basic' | 'payment' | 'notification' | 'network_loss'
): Promise<{ tripId: string; testData: Record<string, any> }> {
  const testTrips: Record<string, any> = {
    basic: {
      pickupLat: 17.3850,
      pickupLng: 78.4867,  // Hyderabad
      destinationLat: 17.3850,
      destinationLng: 78.4867,
      estimatedDistance: 5,
      estimatedFare: 150,
      paymentMethod: 'cash',
    },
    payment: {
      pickupLat: 17.3850,
      pickupLng: 78.4867,
      destinationLat: 17.3850,
      destinationLng: 78.4867,
      estimatedDistance: 10,
      estimatedFare: 250,
      paymentMethod: 'online',
    },
    notification: {
      isTestTrip: true,
      testType: 'notification',
    },
    network_loss: {
      isTestTrip: true,
      testType: 'network_loss',
    },
  };
  
  const tripData = testTrips[testType] || testTrips.basic;
  
  const tripR = await rawDb.execute(rawSql`
    INSERT INTO trip_requests (
      customer_id, pickup_lat, pickup_lng, destination_lat, destination_lng,
      estimated_distance, estimated_fare, payment_method, current_status,
      is_test_trip
    )
    VALUES (
      ${customerId}::uuid, ${tripData.pickupLat}, ${tripData.pickupLng},
      ${tripData.destinationLat}, ${tripData.destinationLng},
      ${tripData.estimatedDistance}, ${tripData.estimatedFare},
      ${tripData.paymentMethod}, 'created', true
    )
    RETURNING id
  `).catch(() => ({ rows: [] as any[] }));
  
  const tripId = (tripR.rows[0] as any)?.id || '';
  
  await logInfo('TEST-TRIP', `Created ${testType} test trip`, {
    customerId: customerId.toString().slice(0, 8),
    tripId: tripId.toString().slice(0, 8),
    testType,
  });
  
  return { tripId, testData: tripData };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 🔄 INITIALIZE ALL HARDENING SCHEDULES
// ═══════════════════════════════════════════════════════════════════════════════

let hardeningJobsStarted = false;

export async function startHardeningJobs() {
  if (hardeningJobsStarted) return;
  hardeningJobsStarted = true;
  
  await logInfo('HARDENING-INIT', 'Starting all hardening scheduled jobs', {});
  
  // Auto-timeout check: every 30 seconds
  setInterval(() => {
    recordHeartbeat("hardeningAutoTimeout");
    withJobLock("hardeningAutoTimeout", autoTimeoutStuckTrips).catch(e => {
      logError('HARDENING-JOB', 'Auto-timeout job failed', { error: e.message }).catch(() => {});
    });
  }, 30 * 1000);

  // Stale ride cleanup: every 10 minutes
  setInterval(() => {
    recordHeartbeat("hardeningStaleRideCleanup");
    withJobLock("hardeningStaleRideCleanup", cleanupStaleOutstationRides).catch(e => {
      logError('HARDENING-JOB', 'Stale ride cleanup failed', { error: e.message }).catch(() => {});
    });
  }, 10 * 60 * 1000);
  
  await logInfo('HARDENING-INIT', 'All hardening jobs initialized', {});
}
