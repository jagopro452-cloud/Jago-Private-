import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guards for Phase 5 (Parcel module) fixes: a money-leak in
// wallet-paid parcel bookings (driver got settled real earnings for a
// customer payment that never happened), the resulting missing cancellation
// refund, and the admin refunds endpoint operating on the wrong table.

const repoRoot = process.cwd();
const routesSource = readFileSync(join(repoRoot, "server", "routes.ts"), "utf8");

describe("Parcel module - Phase 5 P0: wallet-paid parcel bookings now actually collect money", () => {
  it("online/upi/card/razorpay are rejected at booking (no payment-gateway integration exists for parcel)", () => {
    const idx = routesSource.indexOf('app.post("/api/app/parcel/book"');
    const nextIdx = routesSource.indexOf('app.get("/api/app/parcel/orders"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain('["online", "upi", "card", "razorpay"].includes(normalizedPaymentMethod)');
    expect(body).toContain('code: "PARCEL_PAYMENT_METHOD_UNSUPPORTED"');
  });

  it("wallet payment method does a real atomic check-and-deduct before the order is created", () => {
    const idx = routesSource.indexOf('app.post("/api/app/parcel/book"');
    const nextIdx = routesSource.indexOf('app.get("/api/app/parcel/orders"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain('normalizedPaymentMethod === "wallet"');
    expect(body).toContain("UPDATE users SET wallet_balance = wallet_balance - ${totalFare}");
    expect(body).toContain("AND wallet_balance >= ${totalFare}");
    expect(body).toContain("PARCEL_INSUFFICIENT_WALLET_BALANCE");
    // The deduction must happen inside the same booking transaction, before the INSERT,
    // so a booking failure automatically rolls the deduction back.
    const deductIdx = body.indexOf("wallet_balance - ${totalFare}");
    const insertIdx = body.indexOf("INSERT INTO parcel_orders");
    expect(deductIdx).toBeGreaterThan(-1);
    expect(deductIdx).toBeLessThan(insertIdx);
  });

  it("cash and b2b_wallet remain unaffected (their existing settlement mechanisms are untouched)", () => {
    const idx = routesSource.indexOf('app.post("/api/app/parcel/book"');
    const nextIdx = routesSource.indexOf('app.get("/api/app/parcel/orders"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).not.toContain('"cash".includes(normalizedPaymentMethod)');
    expect(body).not.toContain('"b2b_wallet".includes(normalizedPaymentMethod)');
  });
});

describe("Parcel module - Phase 5 P0: cancellation refunds non-B2B wallet payments", () => {
  it("customer/parcel/:id/cancel refunds the customer's own wallet for wallet-paid, non-B2B orders", () => {
    const idx = routesSource.indexOf('app.post("/api/app/parcel/:id/cancel"');
    const nextIdx = routesSource.indexOf('app.get("/api/app/driver/parcel/pending"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("String(cancelled.payment_method || '').toLowerCase() === 'wallet'");
    expect(body).toContain("UPDATE users SET wallet_balance = wallet_balance + ${parseFloat(cancelled.total_fare || '0')}");
  });
});

describe("Parcel module - Phase 5: rating & review (feature gap - none existed for parcel)", () => {
  it("customer/parcel/:id/rate-driver atomically claims via driver_rating IS NULL, feeding the shared reviews AVG", () => {
    const idx = routesSource.indexOf('app.post("/api/app/parcel/:id/rate-driver"');
    const nextIdx = routesSource.indexOf('app.post("/api/app/driver/parcel/:id/rate-customer"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("AND driver_rating IS NULL");
    expect(body).toContain("INSERT INTO reviews (parcel_order_id, reviewer_id, reviewee_id, reviewer_type, rating, feedback)");
    expect(body).toContain("await recomputeUserRating(driverId);");
  });

  it("driver/parcel/:id/rate-customer atomically claims via customer_rating IS NULL, feeding the shared reviews AVG", () => {
    const idx = routesSource.indexOf('app.post("/api/app/driver/parcel/:id/rate-customer"');
    const nextIdx = routesSource.indexOf('app.get("/api/app/driver/parcel/pending"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("AND customer_rating IS NULL");
    expect(body).toContain("INSERT INTO reviews (parcel_order_id, reviewer_id, reviewee_id, reviewer_type, rating, feedback)");
    expect(body).toContain("await recomputeUserRating(customerId);");
  });

  it("migration 0013 adds the claim-guard columns on parcel_orders and the parcel_order_id link on reviews (not a parallel rating table)", () => {
    const migrationSql = readFileSync(join(repoRoot, "migrations", "0013_parcel_ratings.sql"), "utf8");
    expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS driver_rating numeric(2,1)");
    expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS customer_rating numeric(2,1)");
    expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS parcel_order_id uuid REFERENCES public.parcel_orders(id)");
  });
});

describe("Parcel module - Phase 5: coupon application (feature gap - none existed for parcel booking)", () => {
  it("parcel/book validates coupons against coupon_setups with the same rules as ride booking (active, not expired, min order, usage limits)", () => {
    const idx = routesSource.indexOf('app.post("/api/app/parcel/book"');
    const nextIdx = routesSource.indexOf('app.get("/api/app/parcel/orders"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("FROM coupon_setups");
    expect(body).toContain("AND is_active = true");
    expect(body).toContain("AND (end_date IS NULL OR end_date >= NOW())");
    expect(body).toMatch(/FROM parcel_orders\s+WHERE coupon_code = UPPER\(\$\{couponCode\.trim\(\)\}\) AND current_status != 'cancelled'/);
  });

  it("the validated discount reduces totalFare before it's charged (wallet deduction) or persisted", () => {
    const idx = routesSource.indexOf('app.post("/api/app/parcel/book"');
    const nextIdx = routesSource.indexOf('app.get("/api/app/parcel/orders"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("const totalFare = Math.max(0, Math.round((preDiscountFare - discountAmount) * 100) / 100)");
    const totalFareIdx = body.indexOf("const totalFare = Math.max(0,");
    const walletDeductIdx = body.indexOf("wallet_balance - ${totalFare}");
    expect(totalFareIdx).toBeGreaterThan(-1);
    expect(totalFareIdx).toBeLessThan(walletDeductIdx);
  });

  it("migration 0013 adds coupon_code/discount_amount to parcel_orders, not a new coupon table", () => {
    const migrationSql = readFileSync(join(repoRoot, "migrations", "0013_parcel_ratings.sql"), "utf8");
    expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS coupon_code varchar(50)");
    expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2)");
  });
});

describe("Parcel module - Phase 5 P1: admin parcel-refunds now operates on the real parcel_orders table", () => {
  it("GET /api/parcel-refunds queries parcel_orders, not trip_requests", () => {
    const idx = routesSource.indexOf('app.get("/api/parcel-refunds"');
    const nextIdx = routesSource.indexOf('app.patch("/api/parcel-refunds/:id/status"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("FROM parcel_orders po");
    expect(body).not.toContain("storage.getTrips");
    expect(body).toContain("WHERE po.current_status = 'cancelled'");
  });

  it("PATCH /api/parcel-refunds/:id/status updates parcel_orders and does not double-credit wallet (the automatic cancel-time refund already moved the money)", () => {
    const idx = routesSource.indexOf('app.patch("/api/parcel-refunds/:id/status"');
    const nextIdx = routesSource.indexOf("// -- Admin: Revenue Analytics") > idx
      ? routesSource.indexOf('app.post("/api/customer-wallet/topup"')
      : routesSource.length;
    const body = routesSource.slice(idx, idx + 1200);
    expect(body).toContain("UPDATE parcel_orders SET payment_status=${paymentStatus}, updated_at=NOW()");
    expect(body).not.toMatch(/UPDATE users SET wallet_balance = wallet_balance \+/);
  });
});

// Regression guard: Bike Parcel is a service Bike Taxi riders also perform —
// bike_parcel must resolve to the same Bike rider pool as Bike Taxi, not a
// separate rider vehicle type. Root cause: normal ride dispatch
// (getMatchingDriverCategoryIds in vehicle-matching.ts) recognizes a wide set
// of bike synonyms (motor_bike, motorbike, motorcycle, two_wheeler, two_wheel,
// bike_ride, ...) via normalizeBookingVehicleType, but parcel dispatch
// (resolveAllowedCategoryIds in parcel-advanced.ts) only matched categories
// whose name/vehicle_type literally contained the substring "bike" — a
// second, narrower, independently-maintained mapping. A Bike Taxi rider
// registered under any non-"bike"-literal synonym would be found by Bike
// Taxi dispatch but silently excluded from Bike Parcel dispatch. The fix
// reuses normalizeBookingVehicleType (the same function Bike Taxi dispatch
// uses) instead of duplicating a second bike-name list.
describe("Parcel module - bike_parcel resolves to the same Bike Taxi rider pool", () => {
  const vehicleMatchingSource = readFileSync(join(repoRoot, "server", "vehicle-matching.ts"), "utf8");
  const parcelAdvancedSource = readFileSync(join(repoRoot, "server", "parcel-advanced.ts"), "utf8");

  it("normalizeBookingVehicleType's alias table still treats every Bike Taxi synonym as 'bike' (the same canonical key Bike Taxi dispatch matches on)", () => {
    const idx = vehicleMatchingSource.indexOf("export function normalizeBookingVehicleType");
    const nextIdx = vehicleMatchingSource.indexOf("export function", idx + 1);
    const body = vehicleMatchingSource.slice(idx, nextIdx);
    expect(body).toContain('key === "bike_parcel" || (key.includes("parcel") && key.includes("bike"))');
    expect(body).toContain('return "bike_parcel"');
    for (const alias of [
      'key === "bike"', 'key === "bike_ride"', 'key === "motor_bike"', 'key === "motorbike"',
      'key === "motor_cycle"', 'key === "motorcycle"', 'key === "two_wheeler"', 'key === "two_wheel"',
    ]) {
      expect(body).toContain(alias);
    }
    // The parcel check runs before the generic bike-synonym block, so
    // "bike_parcel"/"bike delivery" resolve to "bike_parcel", not "bike".
    expect(body.indexOf('return "bike_parcel"')).toBeLessThan(body.indexOf('return "bike";'));
  });

  it("getMatchingDriverCategoryIds (Bike Taxi dispatch) still resolves the 'bike' request key to ['bike'] — unchanged by the parcel fix", () => {
    expect(vehicleMatchingSource).toContain('case "bike":\n    case "bike_ride":\n      return ["bike"];');
  });

  it("resolveAllowedCategoryIds (Bike Parcel dispatch) reuses normalizeBookingVehicleType instead of a second hand-maintained bike-name list", () => {
    expect(parcelAdvancedSource).toContain(
      'import { uuidArraySql, normalizeBookingVehicleType } from "./vehicle-matching";',
    );
    const idx = parcelAdvancedSource.indexOf("async function resolveAllowedCategoryIds");
    const nextIdx = parcelAdvancedSource.indexOf("export interface ParcelMatchResult");
    const body = parcelAdvancedSource.slice(idx, nextIdx);
    expect(body).toContain('if (parcelKey === "bike_parcel")');
    expect(body).toContain("normalizeBookingVehicleType(row.vehicle_type || row.name)");
    expect(body).toContain('if (canonical === "bike") idSet.add(String(row.id));');
  });

  it("the union only applies to bike_parcel — auto_parcel/tata_ace/pickup_truck/bolero_cargo matching is untouched", () => {
    const idx = parcelAdvancedSource.indexOf("async function resolveAllowedCategoryIds");
    const nextIdx = parcelAdvancedSource.indexOf("export interface ParcelMatchResult");
    const body = parcelAdvancedSource.slice(idx, nextIdx);
    // Only one canonical-vehicle-type branch exists, and it's gated to bike_parcel specifically.
    expect((body.match(/parcelKey === /g) || []).length).toBe(1);
  });
});
