import { describe, expect, it } from "vitest";
import {
  buildActiveParcelResponse,
  buildCancelledParcelResponse,
  isActiveTripUniqueViolation,
  isQaSeedingEnabledForEnv,
  normalizeRideBookingState,
} from "../../server/bug-fix-helpers";

describe("qa bug regressions", () => {
  it("normalizes scheduled ride bookings consistently", () => {
    expect(
      normalizeRideBookingState({
        tripType: "scheduled",
        isScheduled: false,
        scheduledAt: "2026-06-10T10:30:00.000Z",
      }),
    ).toEqual({
      tripType: "normal",
      isScheduled: true,
      currentStatus: "scheduled",
    });
  });

  it("detects the active-trip unique violation that must map to a 409", () => {
    expect(
      isActiveTripUniqueViolation({
        code: "23505",
        message: 'duplicate key value violates unique constraint "idx_one_active_trip_per_customer"',
      }),
    ).toBe(true);

    expect(
      isActiveTripUniqueViolation({
        code: "23505",
        message: "some other unique violation",
      }),
    ).toBe(false);
  });

  it("keeps QA seeding disabled for production unless an explicit staging-safe flag is set", () => {
    expect(
      isQaSeedingEnabledForEnv({
        nodeEnv: "production",
        appEnv: "production",
        allowQaTestSeeding: "true",
        appBaseUrl: "https://jagopro.org",
      }),
    ).toBe(false);

    expect(
      isQaSeedingEnabledForEnv({
        nodeEnv: "production",
        appEnv: "staging",
        allowQaTestSeeding: "true",
        appBaseUrl: "https://sea-lion-app-h5luj.ondigitalocean.app",
      }),
    ).toBe(true);
  });

  it("returns deterministic idempotent parcel responses", () => {
    expect(buildActiveParcelResponse("order-1")).toEqual({
      success: true,
      idempotent: true,
      code: "PARCEL_ACTIVE_ORDER_EXISTS",
      message: "You already have an active parcel delivery in progress.",
      orderId: "order-1",
    });

    expect(buildCancelledParcelResponse("order-2")).toEqual({
      success: true,
      idempotent: true,
      alreadyCancelled: true,
      orderId: "order-2",
      message: "Parcel order already cancelled",
    });
  });
});
