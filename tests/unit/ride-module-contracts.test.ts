import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guards for Phase 4 (Ride module) fixes found during a targeted
// audit: duplicate-submission ratings bug and dead unreachable reassignment
// code in driver-cancel.

const repoRoot = process.cwd();
const routesSource = readFileSync(join(repoRoot, "server", "routes.ts"), "utf8");

describe("Ride module - Phase 4: rating endpoints reject duplicate submissions", () => {
  it("customer/rate-driver atomically claims via driver_rating IS NULL before touching the average", () => {
    const idx = routesSource.indexOf('app.post("/api/app/customer/rate-driver"');
    const nextIdx = routesSource.indexOf('app.get("/api/app/customer/trips"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("AND driver_rating IS NULL");
    expect(body).toContain('res.status(409).json({ message: "You have already rated this trip" })');
    const claimIdx = body.indexOf("driver_rating IS NULL");
    const avgIdx = body.indexOf("recomputeUserRating(");
    expect(claimIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeLessThan(avgIdx);
  });

  it("driver/rate-customer atomically claims via customer_rating IS NULL before touching the average", () => {
    const idx = routesSource.indexOf('app.post("/api/app/driver/rate-customer"');
    const nextIdx = routesSource.indexOf('app.get("/api/app/driver/wallet"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("AND customer_rating IS NULL");
    expect(body).toContain('res.status(409).json({ message: "You have already rated this trip" })');
    const claimIdx = body.indexOf("customer_rating IS NULL");
    const avgIdx = body.indexOf("recomputeUserRating(");
    expect(claimIdx).toBeGreaterThan(-1);
    expect(claimIdx).toBeLessThan(avgIdx);
  });
});

describe("Ride module - Phase 4 P0: rating endpoints no longer crash on nonexistent users.total_ratings", () => {
  it("neither rating endpoint references the nonexistent total_ratings column anymore", () => {
    const rateDriverIdx = routesSource.indexOf('app.post("/api/app/customer/rate-driver"');
    const tripsIdx = routesSource.indexOf('app.get("/api/app/customer/trips"');
    const rateDriverBody = routesSource.slice(rateDriverIdx, tripsIdx);
    expect(rateDriverBody).not.toMatch(/[,\s]total_ratings\s*[,=]/);

    const rateCustomerIdx = routesSource.indexOf('app.post("/api/app/driver/rate-customer"');
    const walletIdx = routesSource.indexOf('app.get("/api/app/driver/wallet"');
    const rateCustomerBody = routesSource.slice(rateCustomerIdx, walletIdx);
    expect(rateCustomerBody).not.toMatch(/[,\s]total_ratings\s*[,=]/);
  });

  it("both endpoints insert into reviews using its real columns (reviewer_type/feedback), not the nonexistent comment/review_type", () => {
    const rateDriverIdx = routesSource.indexOf('app.post("/api/app/customer/rate-driver"');
    const tripsIdx = routesSource.indexOf('app.get("/api/app/customer/trips"');
    const rateDriverBody = routesSource.slice(rateDriverIdx, tripsIdx);
    expect(rateDriverBody).toContain("INSERT INTO reviews (trip_id, reviewer_id, reviewee_id, reviewer_type, rating, feedback)");
    expect(rateDriverBody).not.toMatch(/INSERT INTO reviews[^)]*,\s*comment\s*,/);

    const rateCustomerIdx = routesSource.indexOf('app.post("/api/app/driver/rate-customer"');
    const walletIdx = routesSource.indexOf('app.get("/api/app/driver/wallet"');
    const rateCustomerBody = routesSource.slice(rateCustomerIdx, walletIdx);
    expect(rateCustomerBody).toContain("INSERT INTO reviews (trip_id, reviewer_id, reviewee_id, reviewer_type, rating, feedback)");
  });

  it("rating is recomputed via the shared recomputeUserRating() helper (Phase 6: single source of truth across reviews + pool_ratings), not an incremental formula that can drift", () => {
    const rateDriverIdx = routesSource.indexOf('app.post("/api/app/customer/rate-driver"');
    const tripsIdx = routesSource.indexOf('app.get("/api/app/customer/trips"');
    expect(routesSource.slice(rateDriverIdx, tripsIdx)).toContain("await recomputeUserRating(driverId);");

    const rateCustomerIdx = routesSource.indexOf('app.post("/api/app/driver/rate-customer"');
    const walletIdx = routesSource.indexOf('app.get("/api/app/driver/wallet"');
    expect(routesSource.slice(rateCustomerIdx, walletIdx)).toContain("await recomputeUserRating(customerId);");
  });

  it("migration 0012 adds the trip_requests.driver_rating/customer_rating columns that both rating endpoints and driver/performance depend on", () => {
    const migrationSql = readFileSync(join(repoRoot, "migrations", "0012_trip_requests_rating_columns.sql"), "utf8");
    expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS driver_rating numeric(2,1)");
    expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS customer_rating numeric(2,1)");
  });

  it("driver/performance's monthly rating average depends on trip_requests.driver_rating and is documented as previously broken by the same root cause", () => {
    const idx = routesSource.indexOf('app.get("/api/app/driver/performance"');
    const body = routesSource.slice(idx, idx + 1200);
    expect(body).toContain("AVG(driver_rating)");
  });
});

describe("Ride module - Phase 4: dead reassignment code removed from driver-cancel", () => {
  it("driver-cancel no longer contains unreachable AI-reassignment code after its early return", () => {
    const idx = routesSource.indexOf("await restartDispatchForTrip(tripId, [driver.id]);");
    const body = routesSource.slice(idx, idx + 400);
    expect(body).toContain('return res.json({ success: true, reassigned: true });');
    expect(body).not.toContain("AI-scored reassignment after driver cancellation");
    expect(body).not.toContain("cancelNextBest");
  });
});
