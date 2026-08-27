import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guards for the driver_details onboarding gap: newly registered
// drivers could reach users.verification_status='approved' with no
// driver_details row at all (confirmed in production for two real drivers —
// "Satya"/AP39MQ9876 and a second "Vamsi"/AP36DE1234), because:
//   1. PATCH /api/app/driver/update-registration created driver_details
//      conditionally, non-transactionally, and swallowed DB errors via
//      .catch(dbCatch("db")) while still returning { success: true }.
//   2. PATCH /api/drivers/:id/verify (the endpoint the live admin UI calls)
//      only ever updated `users`/`driver_details.approval_state` and never
//      checked that a dispatch-usable vehicle mapping existed before
//      marking a driver "Approved".
// These tests assert the fix's shape directly against the route source,
// since exercising the real HTTP+DB path isn't available in this suite.

const repoRoot = process.cwd();
const routesSource = readFileSync(join(repoRoot, "server", "routes.ts"), "utf8");

function sliceHandler(startMarker: string, endMarker: string): string {
  const start = routesSource.indexOf(startMarker);
  const end = routesSource.indexOf(endMarker, start);
  expect(start, `could not find start marker: ${startMarker}`).toBeGreaterThan(-1);
  expect(end, `could not find end marker: ${endMarker}`).toBeGreaterThan(start);
  return routesSource.slice(start, end);
}

describe("PATCH /api/app/driver/update-registration — driver_details persistence is no longer optional/silent", () => {
  const body = sliceHandler(
    'app.patch("/api/app/driver/update-registration"',
    'app.get("/api/app/driver/verification-status"',
  );

  it("rejects an unresolvable vehicleType before touching the database (400, INVALID_VEHICLE_TYPE)", () => {
    expect(body).toContain('code: "INVALID_VEHICLE_TYPE"');
    expect(body).toContain("res.status(400)");
  });

  it("rejects a vehicleType with no active matching vehicle_categories row (409, VEHICLE_CATEGORY_NOT_CONFIGURED)", () => {
    expect(body).toContain('code: "VEHICLE_CATEGORY_NOT_CONFIGURED"');
    expect(body).toContain("res.status(409)");
  });

  it("persists the users update and driver_details upsert atomically inside a transaction", () => {
    expect(body).toContain("await rawDb.transaction(async (tx) => {");
    // both writes must be issued against the transaction handle, not the pool directly
    const txBody = body.slice(body.indexOf("await rawDb.transaction(async (tx) => {"));
    expect(txBody).toContain("await tx.execute(rawSql`");
    expect(txBody).toContain("UPDATE users SET");
    expect(txBody).toContain("INSERT INTO driver_details (");
    // both statements must run through tx, not the raw pool directly
    expect((txBody.match(/await tx\.execute\(/g) || []).length).toBe(2);
  });

  it("uses a single idempotent upsert (ON CONFLICT) instead of the old INSERT-if-missing + separate UPDATE pair", () => {
    expect(body).toContain("ON CONFLICT (user_id) DO UPDATE SET");
    // the old two-statement pattern must be gone
    expect(body).not.toContain("WHERE NOT EXISTS (\n            SELECT 1 FROM driver_details WHERE user_id");
  });

  it("no longer swallows driver_details persistence failures via .catch(dbCatch(...))", () => {
    // the vehicle-mapping insert/upsert block itself must not silently catch errors
    const vehicleBlockStart = body.indexOf("if (vehicleType) {");
    const vehicleBlockEnd = body.indexOf("res.json({ success: true, message: \"Profile updated\" });");
    const vehicleBlock = body.slice(vehicleBlockStart, vehicleBlockEnd);
    expect(vehicleBlock).not.toContain('.catch(dbCatch("db"))');
  });

  it("logs and still fails the request (via the outer catch) when persistence throws", () => {
    expect(body).toContain('console.error("[update-registration] failed:", formatDbError(e));');
    expect(body).toContain("res.status(500).json({ message: safeErrMsg(e) });");
  });
});

describe("PATCH /api/drivers/:id/verify — cannot approve a driver with an incomplete dispatch profile", () => {
  const body = sliceHandler(
    'app.patch("/api/drivers/:id/verify"',
    'app.patch("/api/drivers/:id/documents"',
  );

  it("checks driver_details + vehicle_categories completeness before allowing status='approved'", () => {
    expect(body).toContain('if (status === "approved") {');
    expect(body).toContain("FROM driver_details dd");
    expect(body).toContain("LEFT JOIN vehicle_categories vc ON vc.id = dd.vehicle_category_id");
    expect(body).toContain("!profile.vehicle_category_id");
    expect(body).toContain("profile.category_active !== true");
  });

  it("blocks approval with a clear, non-silent error when the profile is incomplete", () => {
    expect(body).toContain('code: "DRIVER_PROFILE_INCOMPLETE"');
    expect(body).toContain("res.status(409)");
  });

  it("still keeps driver_details.approval_state in sync with the verification decision (approved/rejected)", () => {
    expect(body).toContain('UPDATE driver_details SET approval_state=${status} WHERE user_id=${String(req.params.id)}::uuid');
  });

  it("does not gate rejection behind profile completeness — only approval requires it", () => {
    const approvalGateIdx = body.indexOf('if (status === "approved") {');
    const beforeGate = body.slice(0, approvalGateIdx);
    // the completeness SELECT must live inside the approved-only branch, not run unconditionally
    expect(beforeGate).not.toContain("LEFT JOIN vehicle_categories vc ON vc.id = dd.vehicle_category_id");
  });
});
