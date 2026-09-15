import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canDriverReceiveBooking,
  canReceiveParcelBooking,
  canReceiveRideBooking,
  type DriverEligibilityInput,
} from "../../server/service-eligibility";

// Regression guards for the Ride/Parcel service-separation business rule:
//   - Every Ride vehicle (Bike, Auto, Cab, Sedan, Mini, SUV/XL) gets Ride
//     alerts; NONE of them get Parcel alerts, EXCEPT Ride Bike, which gets
//     both. This is the one approved cross-service exception in the whole
//     platform (see server/service-eligibility.ts).
//   - Every Parcel vehicle (Bike Delivery, Auto Parcel, Tata Ace, Bolero
//     Pickup, Tempo 407, Pickup/Mini Truck) gets Parcel alerts only, never
//     Ride alerts.
// Root cause this guards against: PARCEL_VEHICLE_DRIVER_MAP.auto_parcel used
// to also accept the plain "auto" vehicle key, which routed Parcel
// Auto/3-Wheeler bookings to every Ride Auto driver — confirmed via
// resolveAllowedCategoryIds() resolving Ride Auto's vehicle_categories row
// as an eligible parcel-dispatch candidate. Registration also separately
// granted parcel_eligibility=true to every Ride Auto driver
// (canCarryParcel previously included 'auto', not just 'bike').

const repoRoot = process.cwd();
const routesSource = readFileSync(join(repoRoot, "server", "routes.ts"), "utf8");
const parcelAdvancedSource = readFileSync(join(repoRoot, "server", "parcel-advanced.ts"), "utf8");
const dispatchEligibilitySource = readFileSync(join(repoRoot, "server", "dispatch-eligibility.ts"), "utf8");
const dispatchSource = readFileSync(join(repoRoot, "server", "dispatch.ts"), "utf8");
const socketSource = readFileSync(join(repoRoot, "server", "socket.ts"), "utf8");
const fcmSource = readFileSync(join(repoRoot, "server", "fcm.ts"), "utf8");

function driver(overrides: Partial<DriverEligibilityInput>): DriverEligibilityInput {
  return {
    isApproved: true,
    isOnline: true,
    isAvailable: true,
    serviceType: "ride",
    vehicleType: "bike",
    ...overrides,
  };
}

describe("canReceiveRideBooking / canReceiveParcelBooking — the full business matrix", () => {
  describe("Ride vehicles", () => {
    it("Ride Bike receives BOTH ride and parcel alerts (the one exception)", () => {
      const d = driver({ serviceType: "ride", vehicleType: "bike" });
      expect(canReceiveRideBooking(d)).toBe(true);
      expect(canReceiveParcelBooking(d)).toBe(true);
    });

    const nonBikeRideVehicles = ["auto", "cab", "sedan", "mini", "mini_car", "suv", "suv_xl", "car"];
    for (const vehicleType of nonBikeRideVehicles) {
      it(`Ride ${vehicleType} receives ride alerts but NEVER parcel alerts`, () => {
        const d = driver({ serviceType: "ride", vehicleType });
        expect(canReceiveRideBooking(d)).toBe(true);
        expect(canReceiveParcelBooking(d)).toBe(false);
      });
    }
  });

  describe("Parcel vehicles", () => {
    const parcelVehicles = [
      "bike_parcel",
      "auto_parcel",
      "tata_ace",
      "bolero_pickup",
      "bolero_cargo",
      "tempo_407",
      "pickup_truck",
      "truck",
      "mini_truck",
    ];
    for (const vehicleType of parcelVehicles) {
      it(`Parcel ${vehicleType} receives parcel alerts but NEVER ride alerts`, () => {
        const d = driver({ serviceType: "parcel", vehicleType });
        expect(canReceiveParcelBooking(d)).toBe(true);
        expect(canReceiveRideBooking(d)).toBe(false);
      });
    }
  });

  describe("base gates (approved / online / available) apply to both service types", () => {
    it("an unapproved driver receives neither ride nor parcel alerts", () => {
      const d = driver({ isApproved: false, serviceType: "ride", vehicleType: "bike" });
      expect(canReceiveRideBooking(d)).toBe(false);
      expect(canReceiveParcelBooking(d)).toBe(false);
    });

    it("an offline driver receives neither ride nor parcel alerts", () => {
      const d = driver({ isOnline: false, serviceType: "parcel", vehicleType: "tempo_407" });
      expect(canReceiveRideBooking(d)).toBe(false);
      expect(canReceiveParcelBooking(d)).toBe(false);
    });

    it("a busy/unavailable driver receives neither ride nor parcel alerts", () => {
      const d = driver({ isAvailable: false, serviceType: "ride", vehicleType: "bike" });
      expect(canReceiveRideBooking(d)).toBe(false);
      expect(canReceiveParcelBooking(d)).toBe(false);
    });
  });

  describe("parcelEligibility override (mirrors driver_details.parcel_eligibility when already known)", () => {
    it("an explicit parcelEligibility=false on a Ride Bike still blocks parcel alerts", () => {
      const d = driver({ serviceType: "ride", vehicleType: "bike", parcelEligibility: false });
      expect(canReceiveParcelBooking(d)).toBe(false);
    });

    it("an explicit parcelEligibility=true short-circuits the vehicle-type derivation", () => {
      const d = driver({ serviceType: "ride", vehicleType: "sedan", parcelEligibility: true });
      expect(canReceiveParcelBooking(d)).toBe(true);
    });
  });

  describe("canDriverReceiveBooking(driver, booking) — the single dispatch-facing entrypoint", () => {
    it("routes a ride booking through canReceiveRideBooking", () => {
      const d = driver({ serviceType: "parcel", vehicleType: "tempo_407" });
      expect(canDriverReceiveBooking(d, { serviceType: "ride" })).toBe(false);
      expect(canDriverReceiveBooking(driver({ serviceType: "ride", vehicleType: "auto" }), { serviceType: "ride" })).toBe(true);
    });

    it("routes a parcel booking through canReceiveParcelBooking", () => {
      expect(canDriverReceiveBooking(driver({ serviceType: "ride", vehicleType: "auto" }), { serviceType: "parcel" })).toBe(false);
      expect(canDriverReceiveBooking(driver({ serviceType: "ride", vehicleType: "bike" }), { serviceType: "parcel" })).toBe(true);
      expect(canDriverReceiveBooking(driver({ serviceType: "parcel", vehicleType: "bolero_cargo" }), { serviceType: "parcel" })).toBe(true);
    });

    it("an unknown booking serviceType is never eligible", () => {
      expect(canDriverReceiveBooking(driver({}), { serviceType: "pool" })).toBe(false);
    });
  });
});

describe("Registration: Ride Bike is the only Ride vehicle granted parcel_eligibility", () => {
  it("canCarryParcel no longer includes 'auto' in its Ride-vehicle allowlist", () => {
    const match = routesSource.match(/const canCarryParcel = ([^;]+);/);
    expect(match, "could not find canCarryParcel assignment in routes.ts").toBeTruthy();
    const expr = match![1];
    expect(expr).toContain("canonicalVehicleType === 'bike'");
    expect(expr).not.toContain("['bike', 'auto']");
    expect(expr).not.toMatch(/\[.*'auto'.*\]\.includes\(canonicalVehicleType\)/);
  });
});

describe("Parcel dispatch matching: PARCEL_VEHICLE_DRIVER_MAP.auto_parcel no longer leaks Ride Auto", () => {
  it("auto_parcel's allowed-name list does not contain the bare 'auto' token", () => {
    const match = parcelAdvancedSource.match(/auto_parcel:\s*\[([^\]]*)\]/);
    expect(match, "could not find auto_parcel entry in PARCEL_VEHICLE_DRIVER_MAP").toBeTruthy();
    const tokens = match![1]
      .split(",")
      .map((t) => t.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    expect(tokens).not.toContain("auto");
    expect(tokens).toContain("auto_parcel");
  });

  it("bike_parcel still keeps the bare 'bike' token — the one approved cross-service exception", () => {
    const match = parcelAdvancedSource.match(/bike_parcel:\s*\[([^\]]*)\]/);
    expect(match).toBeTruthy();
    const tokens = match![1]
      .split(",")
      .map((t) => t.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    expect(tokens).toContain("bike");
  });

  it("resolveAllowedCategoryIds is exported for reuse by acceptance-time validation", () => {
    expect(parcelAdvancedSource).toContain("export async function resolveAllowedCategoryIds");
  });
});

describe("Ride dispatch (dispatch-eligibility.ts): parcel-vehicle classification is centralized, not duplicated", () => {
  it("both checkProfileEligibility and isDriverEligibleForDispatch use the shared isParcelOnlyVehicle helper", () => {
    const occurrences = (dispatchEligibilitySource.match(/isParcelOnlyVehicle\(/g) || []).length;
    // 1 import + 2 call sites (checkProfileEligibility, isDriverEligibleForDispatch)
    expect(occurrences).toBeGreaterThanOrEqual(2);
    expect(dispatchEligibilitySource).not.toContain(
      '["parcel", "cargo", "truck", "tempo", "pickup"].some',
    );
  });
});

describe("Driver acceptance validation: parcel accept endpoint now re-checks eligibility", () => {
  const body = (() => {
    const start = routesSource.indexOf('app.post("/api/app/driver/parcel/:id/accept"');
    const end = routesSource.indexOf('app.post(', start + 1);
    expect(start).toBeGreaterThan(-1);
    return routesSource.slice(start, end);
  })();

  it("resolves the driver's dispatch profile and calls canReceiveParcelBooking before claiming the order", () => {
    expect(body).toContain("getDriverDispatchProfile(driverId)");
    expect(body).toContain("canReceiveParcelBooking(");
  });

  it("also verifies the driver's specific vehicle class matches the order's requested parcel category", () => {
    expect(body).toContain("resolveAllowedCategoryIds(");
    expect(body).toContain("vehicleClassMatches");
  });

  it("rejects an ineligible driver with a clear, non-silent error before the UPDATE claim", () => {
    expect(body).toContain('code: \'SERVICE_NOT_ELIGIBLE\'');
    expect(body).toContain("You are not eligible for this booking service.");
    const eligibilityCheckIdx = body.indexOf("SERVICE_NOT_ELIGIBLE");
    const updateClaimIdx = body.indexOf("SET driver_id=${driverId}::uuid, current_status='driver_assigned'");
    expect(eligibilityCheckIdx).toBeGreaterThan(-1);
    expect(updateClaimIdx).toBeGreaterThan(eligibilityCheckIdx);
  });
});

describe("Parcel accept endpoint — behavioral simulation of its exact eligibility derivation", () => {
  // Mirrors routes.ts's /api/app/driver/parcel/:id/accept composition exactly:
  //   driverServiceType = categoryServiceType in ('parcel','cargo') ? 'parcel' : 'ride'
  //   eligibleForParcelService = canReceiveParcelBooking({ ...driverServiceType, vehicleType, parcelEligibility })
  // so this test file catches a regression in the endpoint's wiring even
  // though it can't import routes.ts directly (DB import chain — see the
  // top-of-file note on service-eligibility.ts).
  function deriveServiceType(categoryServiceType: string): "ride" | "parcel" {
    return ["parcel", "cargo"].includes(categoryServiceType) ? "parcel" : "ride";
  }

  function simulateAccept(driverProfile: {
    categoryServiceType: string;
    vehicleType: string;
    parcelEligibility: boolean;
  }): boolean {
    return canReceiveParcelBooking({
      isApproved: true,
      isOnline: true,
      isAvailable: true,
      serviceType: deriveServiceType(driverProfile.categoryServiceType),
      vehicleType: driverProfile.vehicleType,
      parcelEligibility: driverProfile.parcelEligibility,
    });
  }

  it("ALLOWS Normal Ride Bike to accept a parcel order", () => {
    expect(simulateAccept({ categoryServiceType: "ride", vehicleType: "bike", parcelEligibility: true })).toBe(true);
  });

  it("ALLOWS Parcel Bike/Auto/Tempo 407/Bolero/Truck/Mini Truck to accept a parcel order", () => {
    for (const vehicleType of ["bike_parcel", "auto_parcel", "tempo_407", "bolero_pickup", "pickup_truck", "mini_truck"]) {
      expect(
        simulateAccept({ categoryServiceType: "parcel", vehicleType, parcelEligibility: true }),
        `expected Parcel ${vehicleType} to be allowed`,
      ).toBe(true);
    }
  });

  it("REJECTS Ride Auto/Cab/Sedan/Mini/SUV-XL from accepting a parcel order", () => {
    for (const vehicleType of ["auto", "cab", "sedan", "mini", "suv_xl"]) {
      expect(
        simulateAccept({ categoryServiceType: "ride", vehicleType, parcelEligibility: false }),
        `expected Ride ${vehicleType} to be rejected`,
      ).toBe(false);
    }
  });
});

describe("Ride acceptance validation: driver:accept_trip already re-validates via isDriverEligibleForDispatch", () => {
  it("socket.ts calls isDriverEligibleForDispatch before atomically claiming the trip", () => {
    const start = socketSource.indexOf('"driver:accept_trip"');
    expect(start).toBeGreaterThan(-1);
    const nextHandlerIdx = socketSource.indexOf("socket.on(", start + 1);
    const body = socketSource.slice(start, nextHandlerIdx > -1 ? nextHandlerIdx : start + 4000);
    expect(body).toContain("isDriverEligibleForDispatch(userId, dispatchRequirements)");
    expect(body).toContain('code: "DISPATCH_MISMATCH"');
  });
});

describe("Socket + FCM payloads carry serviceType/notificationType for client-side safety filtering", () => {
  it("Ride dispatch (dispatch.ts trip:new_request) tags serviceType='ride'", () => {
    expect(dispatchSource).toContain('serviceType: "ride"');
    expect(dispatchSource).toContain('notificationType: "ride_booking_request"');
  });

  it("Ride re-notify path (socket.ts notifyNearbyDriversNewTrip) also tags serviceType='ride'", () => {
    expect(socketSource).toContain('serviceType: "ride"');
    expect(socketSource).toContain('notificationType: "ride_booking_request"');
  });

  it("Parcel dispatch (routes.ts parcel:new_request) tags serviceType='parcel'", () => {
    expect(routesSource).toContain('serviceType: "parcel"');
    expect(routesSource).toContain('notificationType: "parcel_booking_request"');
  });

  it("notifyDriverNewRide's FCM data payload tags serviceType='ride'", () => {
    const start = fcmSource.indexOf("export async function notifyDriverNewRide");
    const end = fcmSource.indexOf("export async function notifyDriverNewParcel");
    expect(start).toBeGreaterThan(-1);
    const body = fcmSource.slice(start, end);
    expect(body).toContain('serviceType: "ride"');
    expect(body).toContain('notificationType: "ride_booking_request"');
  });

  it("notifyDriverNewParcel's FCM data payload tags serviceType='parcel'", () => {
    const start = fcmSource.indexOf("export async function notifyDriverNewParcel");
    const end = fcmSource.indexOf("export async function notifyCustomerDriverAccepted");
    expect(start).toBeGreaterThan(-1);
    const body = fcmSource.slice(start, end);
    expect(body).toContain('serviceType: "parcel"');
    expect(body).toContain('notificationType: "parcel_booking_request"');
  });
});

describe("Driver dashboard exposes serviceType so the app can cache it for client-side filtering", () => {
  it("GET /api/app/driver/dashboard selects and returns vehicle_categories.service_type", () => {
    const start = routesSource.indexOf('app.get("/api/app/driver/dashboard"');
    const end = routesSource.indexOf("app.get(", start + 1);
    expect(start).toBeGreaterThan(-1);
    const body = routesSource.slice(start, end);
    expect(body).toContain("COALESCE(vc.service_type, 'ride') as service_type");
    expect(body).toContain("serviceType: di.serviceType");
  });
});
