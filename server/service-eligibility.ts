/**
 * Centralized Ride-vs-Parcel booking eligibility rule.
 *
 * This is the single source of truth for the one cross-service exception in
 * the whole platform: a driver registered for normal Ride Service under the
 * Bike category also receives Parcel alerts (small parcels physically fit on
 * a bike-taxi run). No other Ride vehicle (Auto, Cab, Sedan, Mini, SUV/XL)
 * gets Parcel alerts, and no Parcel-registered vehicle (Bike Delivery, Auto
 * Parcel, Tata Ace, Bolero Pickup, Tempo 407, Pickup/Mini Truck) ever
 * receives normal Ride alerts.
 *
 * Pure functions — no DB access — so callers adapt their own driver-profile
 * shape into DriverEligibilityInput and get a deterministic answer. Used by:
 *   - server/routes.ts `/api/app/driver/parcel/:id/accept` (re-validates a
 *     driver's eligibility for the specific parcel order before letting them
 *     claim it — closing a gap where that endpoint previously did no
 *     service/vehicle check at all).
 *   - tests/unit/ride-parcel-service-separation.test.ts (exercises the full
 *     eligibility matrix from the business rule directly, with no DB).
 *
 * Real-time dispatch (server/dispatch-eligibility.ts for Ride,
 * server/parcel-advanced.ts for Parcel) has its own richer, already-DB-driven
 * filtering (subscription state, pool/outstation/intercity, city, gender
 * priority, exact vehicle-category matching, etc.) that these simple
 * functions intentionally do not replace — but both now derive the same
 * Ride-Bike-also-does-Parcel exception from here rather than maintaining it
 * as separate, drift-prone heuristics.
 */

// Deliberately NOT importing from ./vehicle-matching here, even though it
// already has a fuller normalizeBookingVehicleType(): that module (and
// everything importing from it, e.g. dispatch-eligibility.ts) pulls in
// ./db → @shared/schema, which this project's vitest config does not alias
// — every other test in tests/unit/ works around this by asserting against
// source text instead of importing server modules directly. Keeping this
// file free of that import chain lets its eligibility functions be
// exercised as real, executable unit tests (see
// tests/unit/ride-parcel-service-separation.test.ts) rather than only
// source-text contract checks. Only a "is this a bike" recognizer is needed
// here, so a small local synonym list — kept in sync with
// normalizeBookingVehicleType's bike branch — is enough.
const BIKE_VEHICLE_SYNONYMS = new Set([
  "bike",
  "bike_ride",
  "motor_bike",
  "motorbike",
  "motor_cycle",
  "motorcycle",
  "two_wheeler",
  "two_wheel",
]);

function normalizeVehicleKey(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isBikeVehicleType(value: string | null | undefined): boolean {
  return BIKE_VEHICLE_SYNONYMS.has(normalizeVehicleKey(value));
}

export interface DriverEligibilityInput {
  /** users.verification_status/driver_details.approval_state in ('approved','verified') */
  isApproved: boolean;
  /** driver_locations.is_online (or users.is_online) */
  isOnline: boolean;
  /** not locked, no active trip/order in progress */
  isAvailable: boolean;
  /** the driver's own registration — 'ride' or 'parcel' */
  serviceType: string;
  /** the driver's own registered vehicle_categories.vehicle_type/name, e.g. 'bike', 'auto', 'tempo_407' */
  vehicleType: string | null;
  /**
   * driver_details.parcel_eligibility, when already known (dispatch already
   * computes this column-backed flag). When omitted, it's derived from
   * serviceType/vehicleType using the same Ride-Bike exception below.
   */
  parcelEligibility?: boolean;
}

export interface BookingEligibilityInput {
  /** booking.service_type — 'ride' or 'parcel' */
  serviceType: string;
}

function baseGatesPass(driver: DriverEligibilityInput): boolean {
  return driver.isApproved && driver.isOnline && driver.isAvailable;
}

function normalizedServiceType(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

/** A normal Ride Bike is the only Ride vehicle that also carries parcels. */
function isRideBikeException(driver: DriverEligibilityInput): boolean {
  return (
    normalizedServiceType(driver.serviceType) === "ride" &&
    isBikeVehicleType(driver.vehicleType)
  );
}

export function canReceiveRideBooking(driver: DriverEligibilityInput): boolean {
  return baseGatesPass(driver) && normalizedServiceType(driver.serviceType) === "ride";
}

export function canReceiveParcelBooking(driver: DriverEligibilityInput): boolean {
  if (!baseGatesPass(driver)) return false;
  if (normalizedServiceType(driver.serviceType) === "parcel") return true;
  if (typeof driver.parcelEligibility === "boolean") return driver.parcelEligibility;
  return isRideBikeException(driver);
}

export function canDriverReceiveBooking(
  driver: DriverEligibilityInput,
  booking: BookingEligibilityInput,
): boolean {
  const bookingServiceType = normalizedServiceType(booking.serviceType);
  if (bookingServiceType === "ride") return canReceiveRideBooking(driver);
  if (bookingServiceType === "parcel") return canReceiveParcelBooking(driver);
  return false;
}
