import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const routesSource = readFileSync(join(repoRoot, "server", "routes.ts"), "utf8");
const hardeningRoutesSource = readFileSync(join(repoRoot, "server", "hardening-routes.ts"), "utf8");
const missingTablesMigrationSource = readFileSync(join(repoRoot, "migrations", "0005_missing_tables_audit_batch.sql"), "utf8");
const productionMigrationSource = readFileSync(join(repoRoot, "server", "migrations", "001_production_hardening.sql"), "utf8");

describe("route hardening contracts", () => {
  it("keeps critical admin endpoints behind admin auth", () => {
    const requiredSnippets = [
      'app.post("/api/admin/rides/:tripId/force-cancel", requireAdminAuth, requireAdminPermission("ops.write")',
      'app.get("/api/refund-requests", requireAdminAuth',
      'app.post("/api/refund-requests", requireAdminAuth',
      'app.patch("/api/refund-requests/:id", requireAdminAuth',
      'app.get("/api/admin/outstation-pool/bookings", requireAdminAuth',
      'app.get("/api/admin/outstation-pool/rides", requireAdminAuth',
      'app.patch("/api/admin/outstation-pool/settings", requireAdminAuth, requireAdminPermission("ops.write")',
      'app.get("/api/admin/revenue/settings", requireAdminAuth',
      'app.get("/api/admin/languages", requireAdminAuth',
      'app.get("/api/platform-services", requireAdminAuth',
      'app.patch("/api/platform-services/:key", requireAdminAuth, requireAdminRole(["admin", "superadmin"])',
      'app.post("/api/employees", requireAdminAuth, requireAdminPermission("admin.write")',
      'app.put("/api/employees/:id", requireAdminAuth, requireAdminPermission("admin.write")',
    ];

    for (const snippet of requiredSnippets) {
      expect(routesSource).toContain(snippet);
    }
  });

  it("prevents privilege escalation via employee create/edit (role field must not be settable by non-admin.write callers)", () => {
    // Regression guard for a confirmed vulnerability: these two routes accept
    // `role` directly from the request body and write it into admins.role,
    // the field the entire RBAC system trusts. Without requireAdminPermission
    // ("admin.write") gating them, any authenticated admin - including
    // low-privilege roles like support_agent/marketing_exec, neither of which
    // holds admin.write - could create or edit an account with
    // role="superadmin" and obtain full platform access. Verified live
    // against a running server + Postgres: a support_agent session got
    // HTTP 403 on both POST /api/employees and PUT /api/employees/:id with
    // role="superadmin" in the body, and the database was confirmed
    // unchanged (zero new rows, target employee's role unchanged).
    expect(routesSource).toContain('app.post("/api/employees", requireAdminAuth, requireAdminPermission("admin.write")');
    expect(routesSource).toContain('app.put("/api/employees/:id", requireAdminAuth, requireAdminPermission("admin.write")');
  });

  it("requires admin authentication on GET /api/employees (was completely unauthenticated)", () => {
    // Regression guard for a confirmed vulnerability: this route had no auth
    // middleware at all and isn't under the /api/admin/ prefix (so the global
    // admin-auth middleware didn't cover it either), returning every
    // employee's name/email/phone/role/zone to any unauthenticated caller.
    // Verified live: a request with no Authorization header got HTTP 401;
    // both a support_agent session and a superadmin session got HTTP 200,
    // matching the same requireAdminAuth-only convention already used by
    // sibling admin GET routes (e.g. /api/admin/revenue/settings,
    // /api/admin/languages, /api/platform-services above).
    expect(routesSource).toContain('app.get("/api/employees", requireAdminAuth');
  });

  it("requires finance.write permission on every real-money refund endpoint", () => {
    // Regression guard for a confirmed vulnerability: these 4 endpoints move
    // real money (wallet credits, Razorpay refunds) but were gated only by
    // requireAdminAuth (any authenticated admin), unlike every other
    // money-moving endpoint in this file (e.g. /api/customer-wallet/topup),
    // which correctly also requires requireFinanceWrite. A low-privilege
    // admin (e.g. support_agent, which holds no finance permission) could
    // approve refunds and trigger real Razorpay bank refunds. Verified live
    // against a running server + Postgres: support_agent got HTTP 403 on all
    // 4; finance_admin got normal business responses on all 4, including a
    // real wallet credit (100.00 -> 110.00, transactions row created) on the
    // approve path; superadmin behavior unchanged.
    expect(routesSource).toContain('app.patch("/api/parcel-refunds/:id/status", requireAdminAuth, requireFinanceWrite');
    expect(routesSource).toContain('app.post("/api/refund-requests", requireAdminAuth, requireFinanceWrite');
    expect(routesSource).toContain('app.patch("/api/refund-requests/:id", requireAdminAuth, requireFinanceWrite');
    expect(routesSource).toContain('app.post("/api/admin/razorpay-refund", requireAdminAuth, requireFinanceWrite');
  });

  it("wallet top-up endpoints never credit wallet_balance from a client-supplied amount without Razorpay verification", () => {
    // Regression guard for a confirmed CRITICAL vulnerability, verified live
    // against a running server + Postgres: POST /api/app/customer/wallet/topup
    // called topUpCustomerWallet(amount) with `amount` taken directly from
    // the request body and `paymentId` accepted as unverified free text (no
    // Razorpay signature check) - fabricating a status='completed' row in
    // customer_payments for any string the client sent. Two replayed calls
    // with a fabricated paymentId credited a test wallet from 0.00 to
    // 199998.00 with zero real payment. Fixed by disabling the route (410),
    // matching the identical prior fix already applied to the sibling
    // /api/app/customer/wallet/recharge endpoint - all top-ups must go
    // through the existing create-order -> Razorpay -> verify-payment flow,
    // which HMAC-verifies the signature before crediting anything.
    expect(routesSource).toContain('app.post("/api/app/customer/wallet/topup", authApp, async (_req, res) => {');
    expect(routesSource).toContain('return res.status(410).json({ message: "Please use the payment gateway to add money to your wallet." });');
    // The legitimate, signature-verified flow must remain untouched and live.
    expect(routesSource).toContain('app.post("/api/app/customer/wallet/create-order", authApp, requireCustomer, paymentOrderLimiter');
    expect(routesSource).toContain('app.post("/api/app/customer/wallet/verify-payment", authApp, requireCustomer');
    expect(routesSource).toContain('crypto.createHmac("sha256", keySecret)');
  });

  it("guards customer cancel flow with pre-cancel state and safe refunds", () => {
    expect(routesSource).toContain("const effectiveTripId = tripId || await rawDb.execute");
    expect(routesSource).toContain("existingTrip.payment_status === 'paid_online'");
    expect(routesSource).toContain("const rzpPaymentId = existingTrip.razorpay_payment_id || null;");
    expect(routesSource).toContain("shouldApplyCustomerLateCancelFee(previousStatus, existingTrip.driver_id)");
    expect(routesSource).toContain("UPDATE users SET wallet_balance = wallet_balance - ${cancelFee}");
    expect(routesSource).toContain("Previously this fee was skipped entirely");
    expect(routesSource).toContain('io.to(`user:${trip.driver_id}`).emit("trip:cancelled", { tripId: effectiveTripId');
    expect(routesSource).toContain('io.to(`user:${customer.id}`).emit("trip:cancelled", {');
  });

  it("keeps outstation pool booking atomic and bounded", () => {
    expect(routesSource).toContain("const seats = clampSeatRequest(seatsBooked);");
    expect(routesSource).toContain("AND available_seats >= ${seats}");
    expect(routesSource).toContain("INSERT INTO outstation_pool_bookings");
    expect(routesSource).toContain('return res.status(409).json({ message: "Not enough seats available"');
  });

  it("prevents duplicate outstation completion settlement", () => {
    expect(routesSource).toContain("AND status NOT IN ('completed', 'completing')");
    expect(routesSource).toContain("SET status='completing', updated_at=NOW()");
    expect(routesSource).toContain("status='completing'");
    expect(routesSource).toContain('return res.status(409).json({ message: existing.status === "completed" ? "Ride already completed" : "Ride completion is already in progress" });');
  });

  it("keeps cancellation penalties and notifications non-destructive", () => {
    expect(hardeningRoutesSource).toContain("if (!canWalletCoverCharge(walletBalance, penaltyAmount))");
    expect(hardeningRoutesSource).toContain("SELECT wallet_balance FROM users WHERE id=${customerId}::uuid LIMIT 1");
    expect(hardeningRoutesSource).toContain("applyWalletChange({");
    expect(hardeningRoutesSource).toContain('reason: "customer_cancel_penalty"');
    expect(hardeningRoutesSource).toContain("action: 'trip:cancelled'");
    expect(hardeningRoutesSource).toContain("type: 'trip_cancelled'");
  });

  it("queues trip completion notifications through the outbox processor", () => {
    expect(routesSource).toContain("processOutboxBatch(io, 5).catch(dbCatch(\"db\"));");
    expect(missingTablesMigrationSource).toContain("CREATE TABLE IF NOT EXISTS public.outbox_events");
    expect(productionMigrationSource).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_trip_per_driver");
    expect(productionMigrationSource).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_trip_per_customer");
  });
});
