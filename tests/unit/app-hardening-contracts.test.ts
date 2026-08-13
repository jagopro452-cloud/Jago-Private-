import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guards for Phase 7 (Customer App / Driver App production
// review) findings: a client-fare-trust gap in book-ride, and the driver
// app never receiving real parcel driverEarnings (so it hardcoded a guess).

const repoRoot = process.cwd();
const routesSource = readFileSync(join(repoRoot, "server", "routes.ts"), "utf8");

describe("Phase 7 P0: book-ride no longer trusts client-supplied fare when vehicleCategoryId is missing", () => {
  it("the no-vehicle-category branch rejects the booking instead of falling back to client-supplied estimatedFare", () => {
    const idx = routesSource.indexOf('app.post("/api/app/customer/book-ride"');
    const nextIdx = routesSource.indexOf('app.get("/api/app/customer/track-trip/:tripId"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).not.toMatch(/computedFare = Number\(estimatedFare\)/);
    expect(body).toContain('res.status(400).json({ message: "vehicleCategoryId is required to book a ride" });');
  });
});

describe("Phase 7: parcel drop-otp now returns the real settled driverEarnings for the driver app to display", () => {
  it("the response includes driverEarnings/commissionAmt computed from the same breakdown used for settlement, not a separate guess", () => {
    const idx = routesSource.indexOf('app.post("/api/app/driver/parcel/:id/drop-otp"');
    const nextIdx = routesSource.indexOf('app.post("/api/app/parcel/optimize-route"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("parcelDriverEarnings = parcelBreakdown.driverEarnings;");
    expect(body).toContain("parcelCommissionAmt = parcelBreakdown.total;");
    expect(body).toContain("driverEarnings: allDelivered ? parcelDriverEarnings : undefined");
  });
});
