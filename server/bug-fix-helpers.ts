export const ACTIVE_TRIP_STATUSES = [
  "searching",
  "scheduled",
  "driver_assigned",
  "accepted",
  "arrived",
  "on_the_way",
] as const;

export const ACTIVE_PARCEL_STATUSES = [
  "searching",
  "driver_assigned",
  "accepted",
  "picked_up",
  "in_transit",
] as const;

export const VERIFIED_RAZORPAY_RIDE_PAYMENT_METHODS = [
  "online",
  "upi",
  "razorpay",
] as const;

export function isVerifiedRazorpayRidePayment(
  paymentMethod: string | null | undefined,
  razorpayPaymentId: unknown,
) {
  const method = String(paymentMethod || "").trim().toLowerCase();
  const paymentId = String(razorpayPaymentId || "").trim();
  return (
    Boolean(paymentId) &&
    (VERIFIED_RAZORPAY_RIDE_PAYMENT_METHODS as readonly string[]).includes(method)
  );
}

export function buildBookingPaymentRecoveryResponse(input: {
  bookingIntentId: string;
  razorpayPaymentId: string;
}) {
  return {
    success: false,
    recoverable: true,
    code: "BOOKING_FAILED_PAYMENT_RECEIVED",
    message: "Payment received. Booking could not be completed. Please retry.",
    bookingIntentId: input.bookingIntentId,
    razorpayPaymentId: input.razorpayPaymentId,
  };
}

type NormalizeRideBookingStateInput = {
  tripType?: string | null;
  isScheduled?: boolean | null;
  scheduledAt?: string | Date | null;
};

export function normalizeRideBookingState(input: NormalizeRideBookingStateInput) {
  const rawTripType = String(input.tripType || "normal").trim().toLowerCase() || "normal";
  const hasScheduledAt = Boolean(input.scheduledAt);
  const isScheduled = input.isScheduled === true || rawTripType === "scheduled" || hasScheduledAt;
  const tripType = rawTripType === "scheduled" ? "normal" : rawTripType;

  return {
    tripType,
    isScheduled,
    currentStatus: isScheduled ? "scheduled" : "searching",
  } as const;
}

export function isActiveTripUniqueViolation(error: unknown) {
  const code = String((error as any)?.code || "").trim();
  const message = String((error as any)?.message || "").toLowerCase();
  return (
    code === "23505" &&
    (
      message.includes("idx_one_active_trip_per_customer") ||
      message.includes("trip_requests_customer_id")
    )
  );
}

export function isActiveParcelUniqueViolation(error: unknown) {
  const code = String((error as any)?.code || "").trim();
  const message = String((error as any)?.message || "").toLowerCase();
  return (
    code === "23505" &&
    (
      message.includes("idx_one_active_parcel_per_customer") ||
      message.includes("idx_parcel_book_idempotency_key")
    )
  );
}

export function isQaSeedingEnabledForEnv(input: {
  nodeEnv?: string | null;
  appEnv?: string | null;
  allowQaTestSeeding?: string | null;
  appBaseUrl?: string | null;
}) {
  const nodeEnv = String(input.nodeEnv || "").trim().toLowerCase();
  const appEnv = String(input.appEnv || "").trim().toLowerCase();
  const appBaseUrl = String(input.appBaseUrl || "").trim().toLowerCase();
  const allowFlag = String(input.allowQaTestSeeding || "").trim().toLowerCase() === "true";

  if (nodeEnv !== "production") return true;
  if (!allowFlag) return false;
  if (["staging", "qa", "test", "uat"].includes(appEnv)) return true;

  if (!appBaseUrl) return false;
  const looksLikeProdHost = appBaseUrl.includes("jagopro.org");
  const looksLikeQaHost = /staging|qa|uat|test|ondigitalocean\.app/.test(appBaseUrl);
  return looksLikeQaHost && !looksLikeProdHost;
}

export function buildActiveParcelResponse(orderId: string) {
  return {
    success: true,
    idempotent: true,
    code: "PARCEL_ACTIVE_ORDER_EXISTS",
    message: "You already have an active parcel delivery in progress.",
    orderId,
  };
}

export function buildCancelledParcelResponse(orderId: string) {
  return {
    success: true,
    idempotent: true,
    alreadyCancelled: true,
    orderId,
    message: "Parcel order already cancelled",
  };
}
