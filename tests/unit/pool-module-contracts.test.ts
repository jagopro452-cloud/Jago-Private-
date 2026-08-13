import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guards for Phase 6 (Local Pool / Outstation Pool / Car Sharing)
// fixes: the same total_ratings phantom-column defect class already found
// and fixed in Ride (Phase 4) and Parcel (Phase 5), plus the previously
// entirely-missing Car Sharing rating feature.

const repoRoot = process.cwd();
const outstationSource = readFileSync(join(repoRoot, "server", "outstation-pool-v2.ts"), "utf8");
const rollingPoolSource = readFileSync(join(repoRoot, "server", "rolling-pool.ts"), "utf8");
const routesSource = readFileSync(join(repoRoot, "server", "routes.ts"), "utf8");
const ratingsSource = readFileSync(join(repoRoot, "server", "ratings.ts"), "utf8");

describe("Pool module - Phase 6 P0: outstation/local pool ratings no longer reference the nonexistent total_ratings column", () => {
  it("outstation-pool-v2.ts no longer writes users.total_ratings anywhere", () => {
    expect(outstationSource).not.toMatch(/COALESCE\(total_ratings/);
    expect(outstationSource).not.toMatch(/total_ratings\s*=\s*COALESCE/);
  });

  it("rolling-pool.ts no longer writes users.total_ratings anywhere", () => {
    expect(rollingPoolSource).not.toMatch(/COALESCE\(total_ratings/);
    expect(rollingPoolSource).not.toMatch(/total_ratings\s*=\s*COALESCE/);
  });

  it("both modules use the shared recomputeUserRating() helper instead of a duplicated formula", () => {
    expect(outstationSource).toContain('import { recomputeUserRating } from "./ratings"');
    expect(rollingPoolSource).toContain('import { recomputeUserRating } from "./ratings"');
    const outstationCalls = (outstationSource.match(/await recomputeUserRating\(/g) || []).length;
    const rollingPoolCalls = (rollingPoolSource.match(/await recomputeUserRating\(/g) || []).length;
    // rate-driver and rate-passenger, each module
    expect(outstationCalls).toBe(2);
    expect(rollingPoolCalls).toBe(2);
  });
});

describe("Pool module - Phase 6: single shared rating source of truth (server/ratings.ts)", () => {
  it("recomputeUserRating combines reviews (rides/parcel) and pool_ratings (pool/outstation/car-sharing), not a parallel formula", () => {
    expect(ratingsSource).toContain("FROM reviews WHERE reviewee_id");
    expect(ratingsSource).toContain("FROM pool_ratings WHERE to_user_id");
    expect(ratingsSource).toContain("UNION ALL");
  });

  it("routes.ts (ride + parcel ratings) now calls the same shared helper instead of its own inline AVG formula", () => {
    expect(routesSource).toContain('import { recomputeUserRating } from "./ratings";');
    const calls = (routesSource.match(/await recomputeUserRating\(/g) || []).length;
    // customer/rate-driver, driver/rate-customer (ride), parcel rate-driver, parcel rate-customer,
    // car-sharing rate-driver, car-sharing rate-customer
    expect(calls).toBe(6);
    expect(routesSource).not.toMatch(/UPDATE users SET rating = \(SELECT COALESCE\(AVG\(rating\), 0\) FROM reviews/);
  });
});

describe("Pool module - Phase 6: Car Sharing ratings (feature gap - none existed)", () => {
  it("customer/car-sharing rate-driver only allows rating a completed ride the customer actually booked", () => {
    const idx = routesSource.indexOf("app.post('/api/app/customer/car-sharing/bookings/:bookingId/rate-driver'");
    const nextIdx = routesSource.indexOf("app.post('/api/app/driver/car-sharing/bookings/:bookingId/rate-customer'");
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("b.customer_id = ${customer.id}::uuid");
    expect(body).toContain("r.status = 'completed'");
    expect(body).toContain("INSERT INTO pool_ratings");
    expect(body).toContain("'car_sharing', 'booking'");
    expect(body).toContain("await recomputeUserRating(own.driver_id);");
  });

  it("driver/car-sharing rate-customer only allows rating a completed ride the driver actually drove", () => {
    const idx = routesSource.indexOf("app.post('/api/app/driver/car-sharing/bookings/:bookingId/rate-customer'");
    const nextIdx = routesSource.indexOf("app.get('/api/app/customer/car-sharing/bookings/:bookingId/driver-location'");
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("r.driver_id = ${driver.id}::uuid");
    expect(body).toContain("r.status = 'completed'");
    expect(body).toContain("INSERT INTO pool_ratings");
    expect(body).toContain("await recomputeUserRating(own.customer_id);");
  });

  it("both reuse pool_ratings' real unique constraint for duplicate protection, not a new mechanism", () => {
    const idx = routesSource.indexOf("app.post('/api/app/customer/car-sharing/bookings/:bookingId/rate-driver'");
    const nextIdx = routesSource.indexOf("app.get('/api/app/customer/car-sharing/bookings/:bookingId/driver-location'");
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("ON CONFLICT (reference_type, reference_id, from_user_id, rating_role) DO NOTHING");
    const conflictOccurrences = (body.match(/ON CONFLICT \(reference_type, reference_id, from_user_id, rating_role\) DO NOTHING/g) || []).length;
    expect(conflictOccurrences).toBe(2);
  });
});

describe("Pool module - Phase 6 P0: Car Sharing driver earnings are actually settled (were a money black hole)", () => {
  it("ride completion calls the shared revenue engine, not a raw SUM with no settlement", () => {
    const idx = routesSource.indexOf("app.post('/api/app/driver/car-sharing/rides/:rideId/complete'");
    const nextIdx = routesSource.indexOf("app.post('/api/app/driver/car-sharing/rides/:rideId/cancel'");
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain('calculateRevenueBreakdown(fare, "city_pool", driver.id)');
    expect(body).toContain("await settleRevenue({");
    expect(body).toContain('paymentMethod: "wallet"');
  });

  it("the completion claim (status update) happens atomically before settlement, preventing double-settlement on retry", () => {
    const idx = routesSource.indexOf("app.post('/api/app/driver/car-sharing/rides/:rideId/complete'");
    const nextIdx = routesSource.indexOf("app.post('/api/app/driver/car-sharing/rides/:rideId/cancel'");
    const body = routesSource.slice(idx, nextIdx);
    const claimIdx = body.indexOf("status IN ('active','started')");
    const settleIdx = body.indexOf("await settleRevenue({");
    expect(claimIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeLessThan(settleIdx);
  });
});

describe("Pool module - Phase 6 P0: Car Sharing and Local Pool enforce revenue policy and auto-lock", () => {
  it("car-sharing/create enforces the same subscription/credit-limit revenue policy as Outstation and Local Pool", () => {
    const idx = routesSource.indexOf("app.post('/api/app/driver/car-sharing/create'");
    const nextIdx = routesSource.indexOf("app.get('/api/app/driver/car-sharing/my-ride'") > idx
      ? routesSource.indexOf("app.get('/api/app/driver/car-sharing/my-ride'")
      : idx + 3000;
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain('await enforceDriverRevenuePolicy(driver.id, "carpool");');
  });

  it("local pool session start now checks is_locked before allowing a driver to go online", () => {
    const idx = rollingPoolSource.indexOf('app.post("/api/app/driver/pool/session/start"');
    const nextIdx = idx + 3500;
    const body = rollingPoolSource.slice(idx, nextIdx);
    expect(body).toContain("SELECT is_locked, lock_reason FROM users WHERE id=${driver.id}::uuid LIMIT 1");
    expect(body).toContain('"ACCOUNT_LOCKED"');
    const lockIdx = body.indexOf("is_locked, lock_reason");
    const policyIdx = body.indexOf('enforceDriverRevenuePolicy(driver.id, "carpool")');
    expect(lockIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeLessThan(policyIdx);
  });
});

describe("Pool module - Phase 6: driver-rates-passenger completeness (previously never updated the aggregate rating)", () => {
  it("outstation pool driver-rates-passenger now updates the customer's aggregate rating", () => {
    const idx = outstationSource.indexOf('app.post("/api/app/driver/outstation-pool/bookings/:id/rate-passenger"');
    const nextIdx = outstationSource.indexOf('app.get("/api/admin/pool/operations/overview"');
    const body = outstationSource.slice(idx, nextIdx);
    expect(body).toContain("recomputeUserRating(own.customer_id)");
  });

  it("local pool driver-rates-passenger now updates the customer's aggregate rating", () => {
    const idx = rollingPoolSource.indexOf('app.post("/api/app/driver/pool/requests/:requestId/rate-passenger"');
    const nextIdx = rollingPoolSource.indexOf('app.get("/api/app/customer/pool/history"');
    const body = rollingPoolSource.slice(idx, nextIdx);
    expect(body).toContain("recomputeUserRating(own.customer_id)");
  });
});
