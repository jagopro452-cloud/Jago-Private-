/**
 * HARDENING INTEGRATION FOR TRIP ROUTES
 * 
 * This file provides integration helpers for hardening in trip-related APIs:
 * - Trip booking
 * - Trip acceptance
 * - Trip completion
 * - Trip cancellation
 * 
 * Designed to be called from server/routes.ts endpoints
 */

import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { sendNotificationWithFailsafe, logInfo, logWarn, logError, logCritical, recordNoShow, loadHardeningSettings } from "./hardening";
import { canWalletCoverCharge } from "./utils/stability-guards";
import { applyWalletChange } from "./revenue-engine";

// ═══════════════════════════════════════════════════════════════════════════════
// BOOKING VALIDATION (Before trip_requests INSERT)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Rate limit: Max N booking attempts per customer per hour
 */
export async function checkBookingRateLimit(
  customerId: string,
  maxBookingsPerHour: number = 20
): Promise<{ allowed: boolean; reason?: string }> {
  const bookingsIn1Hour = await rawDb.execute(rawSql`
    SELECT COUNT(*) as cnt FROM trip_requests
    WHERE customer_id=${customerId}::uuid
      AND created_at > NOW() - INTERVAL '1 hour'
  `).catch(() => ({ rows: [{ cnt: 0 }] }));
  
  const count = (bookingsIn1Hour.rows[0] as any)?.cnt || 0;
  
  if (count >= maxBookingsPerHour) {
    await logWarn('BOOKING-RATE-LIMIT', `Customer ${customerId.toString().slice(0, 8)} exceeded rate limit`, {
      bookingsIn1Hour: count,
      maxAllowed: maxBookingsPerHour,
    });
    return { allowed: false, reason: `Too many bookings. Max ${maxBookingsPerHour}/hour` };
  }
  
  return { allowed: true };
}

/**
 * Fraud detection: Customer booking from same coordinates repeatedly but canceling?
 */
export async function detectBookingFraud(
  customerId: string,
  pickupLat: number,
  pickupLng: number
): Promise<{ isFraudulent: boolean; reason?: string }> {
  // Check for rapid same-location bookings + cancellations
  const recentLocations = await rawDb.execute(rawSql`
    SELECT 
      pickup_lat, pickup_lng, current_status,
      COUNT(*) as cnt
    FROM trip_requests
    WHERE customer_id=${customerId}::uuid
      AND created_at > NOW() - INTERVAL '2 hours'
      AND ABS(pickup_lat - ${pickupLat}) < 0.01       -- ~1km radius
      AND ABS(pickup_lng - ${pickupLng}) < 0.01
    GROUP BY ROUND(pickup_lat::numeric, 4), ROUND(pickup_lng::numeric, 4), current_status
    HAVING COUNT(*) >= 5
  `).catch(() => ({ rows: [] as any[] }));
  
  if (recentLocations.rows.length > 0) {
    const row = recentLocations.rows[0] as any;
    // Check if most are cancelled
    const cancelled = row.current_status === 'cancelled' ? 1 : 0;
    
    if (cancelled > 0 && row.cnt >= 5) {
      await logWarn('FRAUD-DETECT', 'Potential fraudulent booking pattern detected', {
        customerId: customerId.toString().slice(0, 8),
        location: `${pickupLat.toFixed(4)}, ${pickupLng.toFixed(4)}`,
        recentAttempts: row.cnt,
      });
      
      return { 
        isFraudulent: true, 
        reason: 'Suspicious booking pattern detected. Please wait before booking again.' 
      };
    }
  }
  
  return { isFraudulent: false };
}

/**
 * Check if customer has active bans (no-show, payment fraud, etc.)
 */
export async function checkCustomerBans(customerId: string): Promise<{ banned: boolean; reason?: string; until?: string }> {
  const banStatus = await rawDb.execute(rawSql`
    SELECT is_banned_for_no_show, ban_until, ban_reason,
           is_locked, locked_reason, locked_until
    FROM users
    WHERE id=${customerId}::uuid
  `).catch(() => ({ rows: [] as any[] }));
  
  if (!banStatus.rows.length) {
    return { banned: false };
  }
  
  const user = banStatus.rows[0] as any;
  
  // Check no-show ban
  if (user.is_banned_for_no_show && user.ban_until && new Date(user.ban_until) > new Date()) {
    return {
      banned: true,
      reason: user.ban_reason || 'Account banned due to repeated no-shows',
      until: user.ban_until,
    };
  }
  
  // Check account lock (payment due, etc.)
  if (user.is_locked && user.locked_until && new Date(user.locked_until) > new Date()) {
    return {
      banned: true,
      reason: user.locked_reason || 'Account locked. Please clear dues to continue.',
      until: user.locked_until,
    };
  }
  
  return { banned: false };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRIP ACCEPTANCE INTEGRATION (After accept-trip UPDATE)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Post-acceptance: Notify customer with driver details AND setup timeout handlers
 */
export async function notifyCustomerWithDriver(
  customerId: string,
  driverId: string,
  tripId: string,
  driverName: string,
  driverPhone: string,
  driverRating: number
) {
  // Get customer FCM token
  const CustomerDevices = await rawDb.execute(rawSql`
    SELECT fcm_token, phone FROM user_devices
    WHERE user_id=${customerId}::uuid AND fcm_token IS NOT NULL
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  
  const device = CustomerDevices.rows[0] as any;
  
  // Notify customer
  const result = await sendNotificationWithFailsafe({
    recipientId: customerId.toString(),
    fcmToken: device?.fcm_token,
    phoneNumber: device?.phone,
    title: '✅ Driver Assigned',
    body: `${driverName} (⭐${driverRating.toFixed(1)}) is on the way. Tap to call.`,
    data: {
      tripId,
      driverId,
      driverName,
      driverPhone,
      driverRating: String(driverRating),
      action: 'trip:driver_assigned',
    },
    type: 'trip_driver_assigned',
  });
  
  if (result.success) {
    await logInfo('TRIP-ACCEPT', 'Customer notified of driver assignment', {
      customerId: customerId.toString().slice(0, 8),
      driverId: driverId.toString().slice(0, 8),
      tripId: tripId.toString().slice(0, 8),
      channel: result.channel,
    });
  }
}

/**
 * Post-acceptance: Setup auto-timeout handlers for this trip
 * (Runs async, doesn't block the accept response)
 */
export async function setupTripTimeoutHandlers(
  tripId: string,
  customerId: string,
  driverId: string
) {
  // These will be triggered by the hardening background jobs (autoTimeoutStuckTrips)
  // This function just logs that we're monitoring the trip
  
  const config = await loadHardeningSettings();
  const assignedTimeoutMins = config.auto_timeout_assigned_mins || 10;
  
  // Update trip with timeout deadline
  await rawDb.execute(rawSql`
    UPDATE trip_requests
    SET auto_timeout_at = NOW() + INTERVAL '${rawSql.raw(String(assignedTimeoutMins))} minutes'
    WHERE id=${tripId}::uuid
  `).catch(() => {});
  
  await logInfo('TIMEOUT-SETUP', `Trip timeout handlers configured`, {
    tripId: tripId.toString().slice(0, 8),
    timeoutMinutes: assignedTimeoutMins,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRIP COMPLETION INTEGRATION (After complete-trip settlement)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Post-completion: Check if actual fare differs significantly from estimate
 * and handle refund if driver over-charged
 */
export async function validateFareAccuracy(
  tripId: string,
  estimatedFare: number,
  actualFare: number,
  customerId: string
): Promise<{ valid: boolean; refundRequired: boolean; refundAmount: number }> {
  const maxFareMultiplier = 1.5; // Driver can charge max 1.5x estimated
  const hardCap = 10000; // ₹10,000 absolute maximum
  
  const cappedFare = Math.min(actualFare, estimatedFare * maxFareMultiplier, hardCap);
  
  if (actualFare > cappedFare) {
    const refundAmount = actualFare - cappedFare;
    
    // Refund customer
    await applyWalletChange({
      userId: customerId,
      amount: refundAmount,
      type: "CREDIT",
      reason: "fare_cap_refund",
      refId: tripId,
    }).catch(() => {});
    
    await logWarn('FARE-VALIDATION', `Fare capped - customer refunded`, {
      tripId: tripId.toString().slice(0, 8),
      estimatedFare,
      requestedFare: actualFare,
      cappedFare,
      refundAmount,
    });
    
    return { valid: true, refundRequired: true, refundAmount };
  }
  
  return { valid: true, refundRequired: false, refundAmount: 0 };
}

/**
 * Post-completion: Notify customer of trip end with receipt
 */
export async function notifyTripCompletion(
  customerId: string,
  tripId: string,
  totalFare: number,
  paymentMethod: string,
  driverName: string
) {
  const customerDevices = await rawDb.execute(rawSql`
    SELECT fcm_token, phone FROM user_devices
    WHERE user_id=${customerId}::uuid AND fcm_token IS NOT NULL
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  
  const device = customerDevices.rows[0] as any;
  
  const paymentText = paymentMethod === 'cash' ? `Cash payment: ₹${totalFare}` : `Charged ₹${totalFare}`;
  
  await sendNotificationWithFailsafe({
    recipientId: customerId.toString(),
    fcmToken: device?.fcm_token,
    phoneNumber: device?.phone,
    title: '✅ Trip Completed',
    body: `${paymentText} to ${driverName}. Rate the trip!`,
    data: {
      tripId,
      action: 'trip:completed',
      totalFare: String(totalFare),
    },
    type: 'trip_completed',
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRIP CANCELLATION INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Driver cancellation: Track for no-show penalty
 * Called when driver cancels after accepting
 */
export async function recordDriverCancellation(
  tripId: string,
  driverId: string,
  customerId: string,
  reason: string
): Promise<boolean> {
  // Check if this is a legitimate cancel (emergency, etc.) or driver abandonment
  const isAbandonmentReason = [
    'no longer available',
    'took another trip',
    'offline',
    'changed mind',
  ].some(r => reason.toLowerCase().includes(r));
  
  if (isAbandonmentReason) {
    // Treat as no-show
    await recordNoShow(driverId, tripId, 'not_arrived');
    
    await logWarn('DRIVER-ABANDON', `Driver cancelled after accepting (counted as no-show)`, {
      driverId: driverId.toString().slice(0, 8),
      tripId: tripId.toString().slice(0, 8),
      reason,
    });
    
    return true;
  }
  
  return false;
}

/**
 * Customer cancellation: Check for excessive cancellations
 * and apply penalties if needed
 */
export async function recordCustomerCancellation(
  tripId: string,
  customerId: string,
  reason: string
): Promise<{ penaltyApplied: boolean; penaltyAmount: number }> {
  const cancelsIn24h = await rawDb.execute(rawSql`
    SELECT COUNT(*) as cnt FROM trip_requests
    WHERE customer_id=${customerId}::uuid
      AND current_status='cancelled'
      AND created_at > NOW() - INTERVAL '24 hours'
  `).catch(() => ({ rows: [{ cnt: 0 }] }));
  
  const count = (cancelsIn24h.rows[0] as any)?.cnt || 0;
  
  // Penalty: ₹10 after 3 cancels/24h
  const penaltyThreshold = 3;
  const penaltyAmount = 10;
  
  if (count >= penaltyThreshold) {
    const walletR = await rawDb.execute(rawSql`
      SELECT wallet_balance FROM users WHERE id=${customerId}::uuid LIMIT 1
    `).catch(() => ({ rows: [] as any[] }));
    const walletBalance = parseFloat((walletR.rows[0] as any)?.wallet_balance || "0");
    if (!canWalletCoverCharge(walletBalance, penaltyAmount)) {
      return { penaltyApplied: false, penaltyAmount: 0 };
    }

    await applyWalletChange({
      userId: customerId,
      amount: penaltyAmount,
      type: "DEBIT",
      reason: "customer_cancel_penalty",
      refId: tripId,
    }).catch(() => {});
    
    await logWarn('CANCEL-PENALTY', `Customer cancel penalty applied`, {
      customerId: customerId.toString().slice(0, 8),
      cancelsIn24h: count,
      penaltyAmount,
    });
    
    return { penaltyApplied: true, penaltyAmount };
  }
  
  return { penaltyApplied: false, penaltyAmount: 0 };
}

/**
 * Post-cancellation: Notify customer and driver
 */
export async function notifyTripCancellation(
  customerId: string,
  driverId: string | null,
  tripId: string,
  cancelledBy: 'customer' | 'driver',
  reason: string
) {
  // Notify customer
  const customerDevices = await rawDb.execute(rawSql`
    SELECT fcm_token, phone FROM user_devices
    WHERE user_id=${customerId}::uuid AND fcm_token IS NOT NULL
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  
  const customerDevice = customerDevices.rows[0] as any;
  
  await sendNotificationWithFailsafe({
    recipientId: customerId.toString(),
    fcmToken: customerDevice?.fcm_token,
    phoneNumber: customerDevice?.phone,
    title: '❌ Trip Cancelled',
    body: cancelledBy === 'driver' ? 'Driver cancelled the trip. Refund processed.' : reason || 'Trip cancelled',
    data: {
      tripId,
      action: 'trip:cancelled',
      cancelledBy,
    },
    type: 'trip_cancelled',
  });
  
  // Notify driver if they didn't cancel
  if (driverId && cancelledBy === 'customer') {
    const driverDevices = await rawDb.execute(rawSql`
      SELECT fcm_token FROM user_devices
      WHERE user_id=${driverId}::uuid AND fcm_token IS NOT NULL
      LIMIT 1
    `).catch(() => ({ rows: [] as any[] }));
    
    const driverDevice = driverDevices.rows[0] as any;
    
    if (driverDevice?.fcm_token) {
      await sendNotificationWithFailsafe({
        recipientId: driverId.toString(),
        fcmToken: driverDevice.fcm_token,
        title: '❌ Trip Cancelled',
        body: 'Customer cancelled the trip',
        data: {
          tripId,
          action: 'trip:cancelled',
        },
        type: 'trip_cancelled',
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REAL-TIME STATUS UPDATES (via Socket.IO)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get current trip status for customer visibility
 */
export async function getTripStatusForCustomer(tripId: string): Promise<{
  status: string;
  driverName?: string;
  driverRating?: number;
  driverPhone?: string;
  estimatedArrival?: string;
  driverLat?: number;
  driverLng?: number;
  message: string;
}> {
  const trip = await rawDb.execute(rawSql`
    SELECT t.*, 
           d.full_name as driver_name, 
           dd.avg_rating,
           d.phone as driver_phone,
           dl.lat as driver_lat,
           dl.lng as driver_lng
    FROM trip_requests t
    LEFT JOIN users d ON d.id = t.driver_id
    LEFT JOIN driver_details dd ON dd.user_id = t.driver_id
    LEFT JOIN driver_locations dl ON dl.driver_id = t.driver_id
    WHERE t.id=${tripId}::uuid
  `).catch(() => ({ rows: [] as any[] }));
  
  if (!trip.rows.length) {
    return { status: 'not_found', message: 'Trip not found' };
  }
  
  const t = trip.rows[0] as any;
  
  // Map status to customer-friendly display
  const statusMap: Record<string, string> = {
    'searching': '🔍 Searching for driver...',
    'driver_assigned': '✅ Driver assigned',
    'driver_arriving': '🚖 Driver arriving soon',
    'trip_started': '🚗 Trip started',
    'trip_in_progress': '🛣️ On the way',
    'completed': '✅ Trip completed',
    'cancelled': '❌ Trip cancelled',
  };
  
  return {
    status: t.current_status,
    driverName: t.driver_name,
    driverRating: t.avg_rating,
    driverPhone: t.driver_phone,
    driverLat: t.driver_lat,
    driverLng: t.driver_lng,
    message: statusMap[t.current_status] || 'Loading...',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOOST FARE FEATURE (Customer retry option after search timeout)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Allow customer to boost fare (increase offered amount) to attract drivers
 * Used when initial search times out
 */
export async function boostrFareOffer(
  tripId: string,
  customerId: string,
  boostPercentage: number // 0.1 = 10% increase
): Promise<{ success: boolean; newFare: number; error?: string }> {
  // Get current trip
  const tripR = await rawDb.execute(rawSql`
    SELECT id, estimated_fare, current_status FROM trip_requests
    WHERE id=${tripId}::uuid AND customer_id=${customerId}::uuid
  `).catch(() => ({ rows: [] as any[] }));
  
  if (!tripR.rows.length) {
    return { success: false, newFare: 0, error: 'Trip not found' };
  }
  
  const trip = tripR.rows[0] as any;
  
  // Only allow boost if still searching (not already assigned/completed)
  if (trip.current_status !== 'searching') {
    return { success: false, newFare: 0, error: `Cannot boost fare when trip is ${trip.current_status}` };
  }
  
  const newFare = Math.ceil(trip.estimated_fare * (1 + boostPercentage));
  const boostAmount = newFare - trip.estimated_fare;
  
  // Charge customer the boost amount immediately
  const walletR = await rawDb.execute(rawSql`
    SELECT wallet_balance FROM users WHERE id=${customerId}::uuid LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const currentBalance = parseFloat((walletR.rows[0] as any)?.wallet_balance || "0");
  if (!canWalletCoverCharge(currentBalance, boostAmount)) {
    return { success: false, newFare: 0, error: 'Insufficient wallet balance' };
  }
  await applyWalletChange({
    userId: customerId,
    amount: boostAmount,
    type: "DEBIT",
    reason: "fare_boost",
    refId: tripId,
  });
  
  // Update trip fare
  await rawDb.execute(rawSql`
    UPDATE trip_requests
    SET estimated_fare=${newFare}, updated_at=NOW()
    WHERE id=${tripId}::uuid
  `).catch(() => {});
  
  await logInfo('FARE-BOOST', `Customer boosted fare to attract drivers`, {
    customerId: customerId.toString().slice(0, 8),
    tripId: tripId.toString().slice(0, 8),
    originalFare: trip.estimated_fare,
    newFare,
    boostAmount,
  });
  
  return { success: true, newFare };
}
