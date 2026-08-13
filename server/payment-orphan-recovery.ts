import { db } from "./db";
import { sql } from "drizzle-orm";
import {
  ACTIVE_TRIP_STATUSES,
  isActiveTripUniqueViolation,
  normalizeRideBookingState,
} from "./bug-fix-helpers";
import {
  startDispatch,
  resolveServiceType,
  type TripMeta,
} from "./dispatch";
import { notifyNearbyDriversNewTrip } from "./socket";
import { appendTripStatus, logRideLifecycleEvent } from "./realtime-ops";

const rawDb = db;
const rawSql = sql;

export const ORPHAN_RECOVERY_GRACE_SEC = parseInt(
  process.env.ORPHAN_RECOVERY_GRACE_SEC || "60",
  10,
);
export const ORPHAN_RECOVERY_MAX_ATTEMPTS = parseInt(
  process.env.ORPHAN_RECOVERY_MAX_ATTEMPTS || "5",
  10,
);
export const ORPHAN_RECOVERY_BATCH_SIZE = parseInt(
  process.env.ORPHAN_RECOVERY_BATCH_SIZE || "20",
  10,
);

const RECOVERABLE_INTENT_STATUSES = [
  "payment_verified",
  "booking_in_progress",
  "recovery_failed",
] as const;

function validateLatLng(lat: unknown, lng: unknown): { lat: number; lng: number } {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return { lat: 0, lng: 0 };
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return { lat: 0, lng: 0 };
  return { lat: la, lng: ln };
}

function shortLocationName(value: unknown): string {
  const s = String(value || "").trim();
  if (!s) return "";
  const parts = s.split(",");
  return parts[0]?.trim() || s.slice(0, 40);
}

async function detectZoneId(lat: number, lng: number): Promise<string | null> {
  try {
    if (!lat || !lng) return null;
    const r = await rawDb.execute(rawSql`
      SELECT id FROM zones
      WHERE is_active = true
        AND ST_Contains(boundary, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
      LIMIT 1
    `);
    return (r.rows[0] as { id?: string } | undefined)?.id || null;
  } catch {
    return null;
  }
}

export type OrphanPaymentCandidate = {
  paymentId: string;
  razorpayPaymentId: string | null;
  bookingIntentId: string;
  customerId: string;
  amount: number;
  intentStatus: string;
  payload: Record<string, unknown>;
  recoveryAttempts: number;
  createdAt: string;
  updatedAt: string;
};

export function parseBookingDraft(payload: unknown): Record<string, unknown> | null {
  const root = payload as { bookingDraft?: unknown } | null;
  const draft = root?.bookingDraft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return null;
  return draft as Record<string, unknown>;
}

export function validateBookingDraft(
  draft: Record<string, unknown>,
  customerId?: string,
): { ok: boolean; error?: string } {
  const pickup = draft.pickupAddress || draft.pickup;
  const dest = draft.destinationAddress || draft.destination;
  const vehicleType = draft.vehicleType || draft.vehicleCategoryName;
  const fare = Number(draft.estimatedFare);
  const paymentMethod = draft.paymentMethod;
  const draftCustomerId = draft.customerId || customerId;
  const tripType = draft.tripType || "normal";

  if (!pickup || !dest) return { ok: false, error: "missing_pickup_or_destination" };
  if (!vehicleType) return { ok: false, error: "missing_vehicle_type" };
  if (!fare || fare <= 0) return { ok: false, error: "missing_estimated_fare" };
  if (!paymentMethod) return { ok: false, error: "missing_payment_method" };
  if (!draftCustomerId) return { ok: false, error: "missing_customer_id" };
  if (!tripType) return { ok: false, error: "missing_trip_type" };

  const coords = validateLatLng(draft.pickupLat ?? draft.pickup_lat, draft.pickupLng ?? draft.pickup_lng);
  const destCoords = validateLatLng(
    draft.destinationLat ?? draft.destLat ?? draft.destination_lat,
    draft.destinationLng ?? draft.destLng ?? draft.destination_lng,
  );
  if (!coords.lat || !coords.lng || !destCoords.lat || !destCoords.lng) {
    return { ok: false, error: "missing_coordinates" };
  }
  return { ok: true };
}

export async function logPaymentRecoveryEvent(params: {
  bookingIntentId: string;
  customerPaymentId?: string | null;
  customerId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}) {
  await rawDb.execute(rawSql`
    INSERT INTO payment_recovery_events (
      booking_intent_id, customer_payment_id, customer_id, event_type, payload
    ) VALUES (
      ${params.bookingIntentId}::uuid,
      ${params.customerPaymentId || null}::uuid,
      ${params.customerId}::uuid,
      ${params.eventType},
      ${JSON.stringify(params.payload || {})}::jsonb
    )
  `).catch(() => null);
}

export async function findRecoverableOrphanPayments(options?: {
  graceSeconds?: number;
  maxAttempts?: number;
  batchSize?: number;
}): Promise<OrphanPaymentCandidate[]> {
  const graceSeconds = options?.graceSeconds ?? ORPHAN_RECOVERY_GRACE_SEC;
  const maxAttempts = options?.maxAttempts ?? ORPHAN_RECOVERY_MAX_ATTEMPTS;
  const batchSize = options?.batchSize ?? ORPHAN_RECOVERY_BATCH_SIZE;

  const r = await rawDb.execute(rawSql`
    SELECT
      cp.id AS payment_id,
      cp.razorpay_payment_id,
      cp.booking_intent_id,
      cp.customer_id,
      cp.amount,
      bi.status AS intent_status,
      bi.payload,
      bi.recovery_attempts,
      bi.created_at,
      bi.updated_at
    FROM customer_payments cp
    JOIN booking_intents bi ON bi.id = cp.booking_intent_id
    WHERE cp.payment_type = 'ride_payment'
      AND cp.status = 'completed'
      AND cp.trip_id IS NULL
      AND bi.trip_id IS NULL
      AND bi.status IN (${rawSql.join(RECOVERABLE_INTENT_STATUSES.map((s) => rawSql`${s}`), rawSql`, `)})
      AND bi.updated_at < NOW() - (${graceSeconds} * INTERVAL '1 second')
      AND bi.recovery_attempts < ${maxAttempts}
    ORDER BY bi.updated_at ASC
    LIMIT ${batchSize}
  `);

  return (r.rows as Record<string, unknown>[]).map((row) => ({
    paymentId: String(row.payment_id),
    razorpayPaymentId: (row.razorpay_payment_id as string | null) || null,
    bookingIntentId: String(row.booking_intent_id),
    customerId: String(row.customer_id),
    amount: Number(row.amount) || 0,
    intentStatus: String(row.intent_status),
    payload: (row.payload as Record<string, unknown>) || {},
    recoveryAttempts: Number(row.recovery_attempts) || 0,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

export type RecoveryOutcome =
  | { status: "recovered"; tripId: string }
  | { status: "already_exists"; tripId: string; code: "BOOKING_ALREADY_EXISTS" }
  | {
      status: "active_trip_exists";
      tripId?: string;
      code: "ACTIVE_TRIP_EXISTS";
      message: string;
    }
  | { status: "missing_draft"; code: "MISSING_BOOKING_DRAFT"; message: string }
  | { status: "failed"; code: string; message: string };

type DispatchArgs = {
  tripId: string;
  customerId: string;
  pickupLat: number;
  pickupLng: number;
  vehicleCategoryId?: string;
  serviceType: string;
  dispatchMeta: TripMeta;
  paymentId?: string;
};

export async function recoverBookingFromIntent(params: {
  bookingIntentId: string;
  customerId?: string;
  source: "worker" | "customer" | "api";
  claimIntent?: boolean;
}): Promise<RecoveryOutcome> {
  const bookingIntentId = String(params.bookingIntentId || "").trim();
  if (!bookingIntentId) {
    return { status: "failed", code: "INVALID_INTENT", message: "bookingIntentId required" };
  }

  try {
    const outcome = await rawDb.transaction(async (tx) => {
      let dispatch: DispatchArgs | null = null;
      const intentLock = await tx.execute(rawSql`
        SELECT *
        FROM booking_intents
        WHERE id = ${bookingIntentId}::uuid
          ${params.customerId ? rawSql`AND customer_id = ${params.customerId}::uuid` : rawSql``}
        FOR UPDATE
      `);
      if (!intentLock.rows.length) {
        return { status: "failed" as const, code: "INTENT_NOT_FOUND", message: "Booking intent not found" };
      }

      const intent = intentLock.rows[0] as Record<string, unknown>;
      const customerId = String(intent.customer_id);

      if (intent.trip_id) {
        return {
          status: "already_exists" as const,
          tripId: String(intent.trip_id),
          code: "BOOKING_ALREADY_EXISTS" as const,
        };
      }

      const intentStatus = String(intent.status || "");
      if (
        !["payment_verified", "booking_in_progress", "recovery_failed", "recovery_pending"].includes(
          intentStatus,
        )
      ) {
        return {
          status: "failed" as const,
          code: "NOT_RECOVERABLE",
          message: `Intent status ${intentStatus} is not recoverable`,
        };
      }

      const paymentLookup = await tx.execute(rawSql`
        SELECT id, status, razorpay_payment_id
        FROM customer_payments
        WHERE booking_intent_id = ${bookingIntentId}::uuid
          AND payment_type = 'ride_payment'
          AND status = 'completed'
        ORDER BY verified_at DESC NULLS LAST, created_at DESC
        LIMIT 1
      `);
      if (!paymentLookup.rows.length) {
        return {
          status: "failed" as const,
          code: "PAYMENT_NOT_COMPLETED",
          message: "Completed ride payment not found",
        };
      }
      const payment = paymentLookup.rows[0] as Record<string, unknown>;
      const paymentId = String(payment.id);

      const draft = parseBookingDraft(intent.payload);
      const draftValidation = draft
        ? validateBookingDraft(draft, customerId)
        : { ok: false as const, error: "missing_draft" };
      if (!draftValidation.ok) {
        await tx.execute(rawSql`
          UPDATE booking_intents
          SET status='recovery_failed',
              recovery_error=${draftValidation.error || "missing_booking_draft"},
              last_recovery_at=NOW(),
              updated_at=NOW()
          WHERE id=${bookingIntentId}::uuid
            AND trip_id IS NULL
        `);
        return {
          status: "missing_draft" as const,
          code: "MISSING_BOOKING_DRAFT" as const,
          message: "Booking draft missing or invalid; recovery failed",
        };
      }

      if (params.claimIntent !== false) {
        await tx.execute(rawSql`
          UPDATE booking_intents
          SET status='recovery_pending',
              last_recovery_at=NOW(),
              updated_at=NOW()
          WHERE id=${bookingIntentId}::uuid
            AND trip_id IS NULL
        `);
      }

      await tx.execute(rawSql`
        SELECT id FROM users WHERE id=${customerId}::uuid FOR UPDATE
      `);

      const active = await tx.execute(rawSql`
        SELECT id, current_status
        FROM trip_requests
        WHERE customer_id=${customerId}::uuid
          AND current_status IN (${rawSql.join(ACTIVE_TRIP_STATUSES.map((s) => rawSql`${s}`), rawSql`, `)})
        ORDER BY created_at DESC
        LIMIT 1
      `);
      if (active.rows.length) {
        const activeTrip = active.rows[0] as Record<string, unknown>;
        await tx.execute(rawSql`
          UPDATE booking_intents
          SET status='payment_verified',
              recovery_error='active_trip_exists',
              updated_at=NOW()
          WHERE id=${bookingIntentId}::uuid
            AND trip_id IS NULL
            AND status='recovery_pending'
        `);
        return {
          status: "active_trip_exists" as const,
          tripId: String(activeTrip.id),
          code: "ACTIVE_TRIP_EXISTS" as const,
          message: "Customer already has an active trip",
        };
      }

      const pickupAddress = String(draft!.pickupAddress || draft!.pickup || "");
      const destinationAddress = String(draft!.destinationAddress || draft!.destination || "");
      const validPickup = validateLatLng(draft!.pickupLat, draft!.pickupLng);
      const validDest = validateLatLng(
        draft!.destinationLat ?? draft!.destLat,
        draft!.destinationLng ?? draft!.destLng,
      );
      const vehicleCategoryId = draft!.vehicleCategoryId
        ? String(draft!.vehicleCategoryId)
        : null;
      const finalPayment = String(draft!.paymentMethod || intent.payment_method || "online");
      const finalFare = Number(draft!.estimatedFare) || Number(intent.quoted_amount) || 0;
      const finalDistance = Number(draft!.estimatedDistance || draft!.distanceKm) || 0;
      const tripType = String(draft!.tripType || intent.trip_type || "normal");
      const normalized = normalizeRideBookingState({ tripType });
      const detectedZoneId = await detectZoneId(validPickup.lat, validPickup.lng);
      const refId = "TRP" + Date.now().toString().slice(-8).toUpperCase();
      const razorpayPaymentId = payment.razorpay_payment_id
        ? String(payment.razorpay_payment_id)
        : intent.razorpay_payment_id
          ? String(intent.razorpay_payment_id)
          : null;

      const tripResult = await tx.execute(rawSql`
        INSERT INTO trip_requests (
          ref_id, customer_id, driver_id, vehicle_category_id, zone_id,
          pickup_address, pickup_lat, pickup_lng,
          destination_address, destination_lat, destination_lng,
          estimated_fare, estimated_distance, payment_method,
          trip_type, current_status, is_scheduled, scheduled_at,
          booking_intent_id, payment_status, razorpay_payment_id
        ) VALUES (
          ${refId}, ${customerId}::uuid,
          NULL,
          ${vehicleCategoryId ? rawSql`${vehicleCategoryId}::uuid` : rawSql`NULL`},
          ${detectedZoneId ? rawSql`${detectedZoneId}::uuid` : rawSql`NULL`},
          ${pickupAddress}, ${validPickup.lat}, ${validPickup.lng},
          ${destinationAddress}, ${validDest.lat}, ${validDest.lng},
          ${finalFare}, ${finalDistance}, ${finalPayment},
          ${normalized.tripType}, ${normalized.currentStatus}, false, null,
          ${bookingIntentId}::uuid,
          'paid_online',
          ${razorpayPaymentId}
        ) RETURNING *
      `);

      const newTripId = String((tripResult.rows[0] as Record<string, unknown>).id);

      await tx.execute(rawSql`
        UPDATE customer_payments
        SET trip_id=${newTripId}::uuid,
            payment_context=COALESCE(payment_context, '{}'::jsonb) || jsonb_build_object(
              'linkedTripId', ${newTripId}::uuid,
              'recoveredBy', ${params.source}
            )
        WHERE id=${paymentId}::uuid
          AND trip_id IS NULL
      `);

      await tx.execute(rawSql`
        UPDATE booking_intents
        SET status='recovered',
            trip_id=${newTripId}::uuid,
            recovered_at=NOW(),
            recovery_error=NULL,
            updated_at=NOW()
        WHERE id=${bookingIntentId}::uuid
      `);

      const pickupShort = String(draft!.pickupShortName || shortLocationName(pickupAddress));
      const destShort = String(draft!.destinationShortName || shortLocationName(destinationAddress));
      await tx.execute(rawSql`
        UPDATE trip_requests SET
          pickup_short_name = ${pickupShort || null},
          destination_short_name = ${destShort || null}
        WHERE id = ${newTripId}::uuid
      `).catch(() => null);

      let vcName = String(draft!.vehicleCategoryName || draft!.vehicleType || "");
      if (!vcName && vehicleCategoryId) {
        const vcR = await tx.execute(rawSql`
          SELECT name FROM vehicle_categories WHERE id=${vehicleCategoryId}::uuid LIMIT 1
        `);
        vcName = String((vcR.rows[0] as { name?: string } | undefined)?.name || "");
      }

      dispatch = {
        tripId: newTripId,
        customerId,
        pickupLat: validPickup.lat,
        pickupLng: validPickup.lng,
        vehicleCategoryId: vehicleCategoryId || undefined,
        serviceType: resolveServiceType(normalized.tripType, vcName),
        paymentId,
        dispatchMeta: {
          refId,
          customerName: "Customer",
          pickupAddress,
          destinationAddress,
          pickupShortName: pickupShort,
          destinationShortName: destShort,
          pickupLat: validPickup.lat,
          pickupLng: validPickup.lng,
          estimatedFare: finalFare,
          estimatedDistance: finalDistance,
          paymentMethod: finalPayment,
          tripType: normalized.tripType,
          vehicleCategoryName: vcName || undefined,
        },
      };

      return { status: "recovered" as const, tripId: newTripId, dispatch };
    });

    if (outcome.status === "recovered" && outcome.dispatch) {
      const dispatchArgs = outcome.dispatch;
      const customerRow = await rawDb.execute(rawSql`
        SELECT full_name FROM users WHERE id=${dispatchArgs.customerId}::uuid LIMIT 1
      `).catch(() => ({ rows: [] as Record<string, unknown>[] }));
      dispatchArgs.dispatchMeta.customerName =
        String((customerRow.rows[0] as { full_name?: string } | undefined)?.full_name || "Customer");

      await appendTripStatus(
        dispatchArgs.tripId,
        "requested",
        "system",
        "Orphan payment recovery created booking",
      );
      await logRideLifecycleEvent(
        dispatchArgs.tripId,
        "ride_recovered",
        dispatchArgs.customerId,
        "system",
        { bookingIntentId, source: params.source },
      );

      startDispatch(
        dispatchArgs.tripId,
        dispatchArgs.customerId,
        dispatchArgs.pickupLat,
        dispatchArgs.pickupLng,
        dispatchArgs.vehicleCategoryId,
        dispatchArgs.serviceType,
        dispatchArgs.dispatchMeta,
      ).catch((err: Error) => {
        notifyNearbyDriversNewTrip(
          dispatchArgs.tripId,
          dispatchArgs.pickupLat,
          dispatchArgs.pickupLng,
          dispatchArgs.vehicleCategoryId,
        ).catch(() => null);
        console.error("[ORPHAN-RECOVERY] startDispatch error:", err?.message);
      });

      await logPaymentRecoveryEvent({
        bookingIntentId,
        customerPaymentId: dispatchArgs.paymentId,
        customerId: dispatchArgs.customerId,
        eventType: "recovered",
        payload: { tripId: dispatchArgs.tripId, source: params.source },
      });
    } else if (outcome.status === "missing_draft") {
      const customerId =
        params.customerId ||
        (
          await rawDb.execute(rawSql`
            SELECT customer_id FROM booking_intents WHERE id=${bookingIntentId}::uuid LIMIT 1
          `).catch(() => ({ rows: [] as Record<string, unknown>[] }))
        ).rows[0]?.customer_id?.toString() ||
        "";
      if (customerId) {
        await logPaymentRecoveryEvent({
          bookingIntentId,
          customerId,
          eventType: "recovery_failed",
          payload: { reason: "missing_booking_draft", source: params.source },
        });
      }
    }

    return outcome;
  } catch (err: unknown) {
    if (isActiveTripUniqueViolation(err)) {
      return {
        status: "active_trip_exists",
        code: "ACTIVE_TRIP_EXISTS",
        message: "Customer already has an active trip",
      };
    }
    throw err;
  }
}

export async function markRecoveryFailure(params: {
  bookingIntentId: string;
  customerId: string;
  customerPaymentId?: string;
  error: string;
}) {
  const result = await rawDb.execute(rawSql`
    UPDATE booking_intents
    SET recovery_attempts = recovery_attempts + 1,
        last_recovery_at = NOW(),
        recovery_error = ${params.error},
        status = CASE
          WHEN recovery_attempts + 1 >= ${ORPHAN_RECOVERY_MAX_ATTEMPTS} THEN 'recovery_failed'
          ELSE 'payment_verified'
        END,
        updated_at = NOW()
    WHERE id = ${params.bookingIntentId}::uuid
      AND trip_id IS NULL
    RETURNING recovery_attempts, status
  `);
  const row = result.rows[0] as { recovery_attempts?: number; status?: string } | undefined;
  await logPaymentRecoveryEvent({
    bookingIntentId: params.bookingIntentId,
    customerPaymentId: params.customerPaymentId,
    customerId: params.customerId,
    eventType: row?.status === "recovery_failed" ? "recovery_failed" : "recovery_retry",
    payload: { error: params.error, recoveryAttempts: row?.recovery_attempts },
  });
  return row;
}

export async function runOrphanRecoveryWorker(): Promise<{
  detected: number;
  recovered: number;
  failed: number;
  skipped: number;
}> {
  const stats = { detected: 0, recovered: 0, failed: 0, skipped: 0 };
  const orphans = await findRecoverableOrphanPayments();
  stats.detected = orphans.length;

  for (const orphan of orphans) {
    try {
      await logPaymentRecoveryEvent({
        bookingIntentId: orphan.bookingIntentId,
        customerPaymentId: orphan.paymentId,
        customerId: orphan.customerId,
        eventType: "detected",
        payload: {
          intentStatus: orphan.intentStatus,
          recoveryAttempts: orphan.recoveryAttempts,
        },
      });

      const draft = parseBookingDraft(orphan.payload);
      if (!draft || !validateBookingDraft(draft, orphan.customerId).ok) {
        await rawDb.execute(rawSql`
          UPDATE booking_intents
          SET status='recovery_failed',
              recovery_error='missing_booking_draft',
              last_recovery_at=NOW(),
              updated_at=NOW()
          WHERE id=${orphan.bookingIntentId}::uuid
            AND trip_id IS NULL
        `);
        await logPaymentRecoveryEvent({
          bookingIntentId: orphan.bookingIntentId,
          customerPaymentId: orphan.paymentId,
          customerId: orphan.customerId,
          eventType: "recovery_failed",
          payload: { reason: "missing_booking_draft" },
        });
        stats.failed++;
        continue;
      }

      const result = await recoverBookingFromIntent({
        bookingIntentId: orphan.bookingIntentId,
        customerId: orphan.customerId,
        source: "worker",
        claimIntent: true,
      });

      if (result.status === "recovered" || result.status === "already_exists") {
        stats.recovered++;
      } else if (result.status === "active_trip_exists") {
        stats.skipped++;
      } else if (result.status === "missing_draft") {
        stats.failed++;
      } else {
        await markRecoveryFailure({
          bookingIntentId: orphan.bookingIntentId,
          customerId: orphan.customerId,
          customerPaymentId: orphan.paymentId,
          error: result.message || result.code,
        });
        stats.failed++;
      }
    } catch (err: unknown) {
      await markRecoveryFailure({
        bookingIntentId: orphan.bookingIntentId,
        customerId: orphan.customerId,
        customerPaymentId: orphan.paymentId,
        error: String((err as Error)?.message || err).slice(0, 500),
      }).catch(() => null);
      stats.failed++;
    }
  }

  return stats;
}

export async function findCustomerPendingRecovery(customerId: string) {
  const r = await rawDb.execute(rawSql`
    SELECT
      cp.id AS payment_id,
      cp.razorpay_payment_id,
      cp.booking_intent_id,
      bi.status,
      bi.recovery_attempts,
      bi.recovery_error,
      bi.created_at,
      bi.updated_at
    FROM customer_payments cp
    JOIN booking_intents bi ON bi.id = cp.booking_intent_id
    WHERE cp.customer_id = ${customerId}::uuid
      AND cp.payment_type = 'ride_payment'
      AND cp.status = 'completed'
      AND cp.trip_id IS NULL
      AND bi.trip_id IS NULL
      AND bi.status IN (
        'payment_verified',
        'booking_in_progress',
        'recovery_failed',
        'recovery_pending'
      )
    ORDER BY bi.updated_at DESC
    LIMIT 1
  `);
  return (r.rows[0] as Record<string, unknown> | undefined) || null;
}

export async function listAdminOrphanPayments(limit = 100) {
  const r = await rawDb.execute(rawSql`
    SELECT
      cp.id AS payment_id,
      cp.booking_intent_id,
      cp.customer_id,
      bi.status,
      bi.recovery_attempts,
      bi.created_at,
      bi.updated_at
    FROM customer_payments cp
    JOIN booking_intents bi ON bi.id = cp.booking_intent_id
    WHERE cp.payment_type = 'ride_payment'
      AND cp.status = 'completed'
      AND cp.trip_id IS NULL
      AND bi.trip_id IS NULL
      AND bi.status IN (
        'payment_verified',
        'booking_in_progress',
        'recovery_pending',
        'recovery_failed'
      )
    ORDER BY bi.updated_at DESC
    LIMIT ${limit}
  `);
  return (r.rows as Record<string, unknown>[]).map((row) => ({
    paymentId: row.payment_id,
    bookingIntentId: row.booking_intent_id,
    customerId: row.customer_id,
    status: row.status,
    recoveryAttempts: row.recovery_attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
