import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guards for the online/availability desync bug: production data
// showed users.is_online=true while driver_details.is_online stayed false
// and driver_details.availability_status stayed 'offline', for BOTH the
// working driver (Vamsi) and the broken driver (Satya) — because
// PATCH /api/app/driver/online-status only ever wrote users.is_online and
// driver_locations.is_online, never driver_details. The main ride-dispatch
// query (findEligibleDriversForDispatch) gates on driver_locations.is_online,
// but the AI driver-matching endpoint (findBestDrivers) and local-pool
// dispatch both gate on driver_details.availability_status — so the stale
// field silently broke those two paths while leaving standard ride dispatch
// unaffected. These tests assert the fix's shape directly against source,
// since exercising the real HTTP+DB path isn't available in this suite.

const repoRoot = process.cwd();
const routesSource = readFileSync(join(repoRoot, "server", "routes.ts"), "utf8");
const dispatchEligibilitySource = readFileSync(join(repoRoot, "server", "dispatch-eligibility.ts"), "utf8");
const aiSource = readFileSync(join(repoRoot, "server", "ai.ts"), "utf8");
const localPoolDispatchSource = readFileSync(join(repoRoot, "server", "local-pool-dispatch.ts"), "utf8");

function sliceHandler(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start, `could not find start marker: ${startMarker}`).toBeGreaterThan(-1);
  expect(end, `could not find end marker: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("PATCH /api/app/driver/online-status — users/driver_locations/driver_details stay in sync", () => {
  const body = sliceHandler(
    routesSource,
    'app.patch("/api/app/driver/online-status"',
    'app.get("/api/app/driver/profile"',
  );

  it("1. going online writes is_online=true to users, driver_locations, AND driver_details, plus availability_status='online'", () => {
    expect(body).toContain("await rawDb.transaction(async (tx) => {");
    expect(body).toContain("UPDATE users SET is_online=${isOnline}");
    expect(body).toContain("INSERT INTO driver_locations (driver_id, lat, lng, is_online, updated_at)");
    expect(body).toContain("UPDATE driver_details");
    expect(body).toContain("SET is_online=${isOnline}, availability_status=${availabilityStatus}, updated_at=NOW()");
    expect(body).toContain("const availabilityStatus = isOnline ? 'online' : 'offline';");
  });

  it("2. going offline uses the same code path, so is_online=false/availability_status='offline' propagate identically", () => {
    // there is exactly one write site for driver_details.is_online/availability_status —
    // the same statement handles both online and offline via the isOnline variable,
    // not two separate branches that could drift.
    const matches = body.match(/UPDATE driver_details/g) || [];
    expect(matches.length).toBe(1);
  });

  it("3. going online can never create a driver_details row for a driver who doesn't have one (UPDATE-only, no upsert)", () => {
    const ddBlockStart = body.indexOf("UPDATE driver_details");
    const ddBlock = body.slice(ddBlockStart, ddBlockStart + 300);
    expect(ddBlock).not.toContain("INSERT INTO driver_details");
    expect(ddBlock).not.toContain("ON CONFLICT");
  });

  it("4. rejected/unapproved drivers are still blocked from going online before any writes happen", () => {
    const gateIdx = body.indexOf("DRIVER_NOT_APPROVED");
    const writeIdx = body.indexOf("await rawDb.transaction(async (tx) => {");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(writeIdx);
    expect(body).toContain("if (!['approved', 'verified'].includes(vs)) {");
  });

  it("all three writes (users, driver_locations, driver_details) run inside the same transaction handle (tx), not the raw pool", () => {
    const txStart = body.indexOf("await rawDb.transaction(async (tx) => {");
    const txBody = body.slice(txStart);
    expect((txBody.match(/await tx\.execute\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

describe("5. Standard ride-dispatch matching is unchanged by this fix", () => {
  it("findEligibleDriversForDispatch still gates on driver_locations.is_online and dd.vehicle_category_id, exactly as before", () => {
    expect(dispatchEligibilitySource).toContain("JOIN driver_locations dl ON dl.driver_id = u.id");
    expect(dispatchEligibilitySource).toContain("AND dl.is_online = true");
    expect(dispatchEligibilitySource).toContain("AND dd.vehicle_category_id = ${safeStrictCategoryIds[0]}::uuid");
  });

  it("vehicle-matching.ts / dispatch-eligibility.ts were not touched by this change (no driver_details.is_online reference added to the candidate query)", () => {
    const queryStart = dispatchEligibilitySource.indexOf("export async function findEligibleDriversForDispatch");
    const queryEnd = dispatchEligibilitySource.indexOf("ORDER BY distance_km ASC", queryStart);
    const queryBody = dispatchEligibilitySource.slice(queryStart, queryEnd);
    expect(queryBody).not.toContain("dd.is_online");
    expect(queryBody).not.toContain("dd.availability_status");
  });
});

describe("Secondary dispatch paths that DO depend on driver_details.availability_status now see a consistent value", () => {
  it("ai.ts findBestDrivers still gates on COALESCE(dd.availability_status, 'offline') = 'online'", () => {
    expect(aiSource).toContain("AND COALESCE(dd.availability_status, 'offline') = 'online'");
  });

  it("local-pool-dispatch.ts still gates on COALESCE(dd.availability_status, 'offline') = 'online'", () => {
    expect(localPoolDispatchSource).toContain("AND COALESCE(dd.availability_status, 'offline') = 'online'");
  });
});
