import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guards for the Outstanding Revenue Model (approved architecture,
// implemented phase by phase - see the approved architecture doc). This file
// exists so each phase's "extend, don't duplicate" constraint is enforced
// mechanically, not just by review.

const repoRoot = process.cwd();
const revenueEngineSource = readFileSync(join(repoRoot, "server", "revenue-engine.ts"), "utf8");
const paymentSettlementSource = readFileSync(join(repoRoot, "server", "payment-settlement.ts"), "utf8");
const routesSource = readFileSync(join(repoRoot, "server", "routes.ts"), "utf8");
const outstationMatcherSource = readFileSync(join(repoRoot, "server", "outstation-pool-matcher.ts"), "utf8");
const schemaFiles = [
  join(repoRoot, "migrations", "0000_baseline.sql"),
];
const allMigrationSql = [
  join(repoRoot, "migrations", "0000_baseline.sql"),
  join(repoRoot, "server", "migrations", "005_user_auth_schema_fix.sql"),
  join(repoRoot, "server", "migrations", "007_production_market_readiness.sql"),
].map((f) => readFileSync(f, "utf8")).join("\n");

describe("Outstanding Revenue Model - Phase 1 (CORRECTED): single source of truth", () => {
  // Original Phase 1 wrongly declared users.pending_payment_amount canonical.
  // Verified against the repo: that column does not exist on `users` in any
  // migration (only on trip_requests, a different table/concept). See the
  // corrected architecture report for full evidence. These tests assert the
  // corrected, schema-verified facts instead.

  it("users.pending_payment_amount does not exist - documented as broken, not silently fixed", () => {
    // No migration (root or server) ever adds pending_payment_amount to
    // `users`. If a future change adds it, this test should be revisited
    // deliberately, not left silently passing on stale assumptions.
    expect(allMigrationSql).not.toMatch(/ALTER TABLE\s+users\s+ADD COLUMN[^;]*pending_payment_amount/i);
    expect(allMigrationSql).not.toMatch(/CREATE TABLE[^;]*public\.users[^;]*pending_payment_amount/is);
    // The dead-code functions that reference it are documented, not fixed.
    expect(revenueEngineSource).toContain("NOT exist anywhere in the schema");
    expect(revenueEngineSource).toContain("unreachable dead code");
    expect(revenueEngineSource).toContain("zero callers anywhere in the repo");
  });

  it("wallet_balance, via applyWalletChange(), is what settleRevenue() actually reads to decide is_locked on every trip", () => {
    // This is the real, live, schema-backed single source of truth for
    // driver credit blocking - verified by reading settleRevenue() in full.
    expect(revenueEngineSource).toContain("if (newWalletBalance < -lockThresholdVal)");
    expect(revenueEngineSource).toContain("UPDATE users SET is_locked=true, lock_reason=${lockReason}, locked_at=NOW()");
  });

  it("total_pending_balance/pending_commission_balance/pending_gst_balance are never incremented by any live trip-completion path", () => {
    // Verified: settleRevenue() (the function invoked on every real trip
    // completion) does not reference these three columns at all. The only
    // code path that increments them (POST /api/driver-wallet/:id/deduct,
    // "legacy") is itself broken by the same missing pending_payment_amount
    // column bug. This test guards against a future settleRevenue() change
    // silently starting to write these fields without updating this
    // documented understanding - and against silently declaring this fixed
    // without revisiting the report's conclusion that they're vestigial.
    const settleRevenueBody = revenueEngineSource.split("export async function settleRevenue(")[1]
      .split("export async function applySettlement(")[0];
    expect(settleRevenueBody).not.toContain("total_pending_balance");
    expect(settleRevenueBody).not.toContain("pending_commission_balance");
    expect(settleRevenueBody).not.toContain("pending_gst_balance");
  });

  it("lock_threshold (per-driver column) has zero write sites - display-only, not the live enforcement value", () => {
    // Verified: only 2 read sites (driver dashboard display endpoints),
    // zero UPDATE statements anywhere. Enforcement actually compares against
    // resolveDriverCreditLimit() (vehicle_credit_limits + the global
    // auto_lock_threshold setting), not this column.
    expect(routesSource).not.toMatch(/SET[^;]*\block_threshold\s*=/i);
  });

  it("is_locked is legitimately written for two independent reasons - financial dues and driver verification/admin block", () => {
    // Not a duplication to merge: driver-state.ts's BLOCKED state (admin
    // rejects/blocks a driver during verification) and the financial
    // auto-lock in settleRevenue()/admin settlement endpoints are different
    // concerns that happen to share one boolean flag by design.
    const driverStateSource = readFileSync(join(repoRoot, "server", "driver-state.ts"), "utf8");
    expect(driverStateSource).toContain('case "BLOCKED":');
    expect(driverStateSource).toContain("is_locked=true");
  });

  it("no competing outstanding-balance column or table exists in the baseline schema", () => {
    for (const file of schemaFiles) {
      const sql = readFileSync(file, "utf8");
      const matches = sql.match(/outstanding/gi) || [];
      expect(matches, `${file} must not define any "outstanding"-named column/table`).toHaveLength(0);
    }
  });
});

describe("Outstanding Revenue Model - Phase 2: vehicle-wise credit limits", () => {
  it("every real auto-lock/unlock threshold comparison goes through resolveDriverCreditLimit()", () => {
    // Before Phase 2 there were 6 independent inline reads of the
    // auto_lock_threshold setting (3 in revenue-engine.ts, 2 in
    // payment-settlement.ts, 1 in the go-online gate in routes.ts), each a
    // duplicate of the same "is this driver's Outstanding past the limit"
    // check. This test locks in that they now all resolve through one
    // function instead of silently regressing back to inline duplicates.
    const revenueEngineCalls = (revenueEngineSource.match(/resolveDriverCreditLimit\(/g) || []).length;
    const paymentSettlementCalls = (paymentSettlementSource.match(/resolveDriverCreditLimit\(/g) || []).length;
    const routesCalls = (routesSource.match(/resolveDriverCreditLimit\(/g) || []).length;
    expect(revenueEngineCalls).toBe(4); // 1 definition + 3 call sites (settleRevenue, applyPendingBalanceDebit, applyPendingBalanceCredit)
    expect(paymentSettlementCalls).toBe(2); // settleDriverCommissionPayment + the wallet-topup/driver-payment settlement path
    expect(routesCalls).toBe(1); // the driver go-online gate

    // No comparison logic should read the raw setting directly anymore -
    // only resolveDriverCreditLimit's own implementation may.
    expect(paymentSettlementSource).not.toContain("key_name='auto_lock_threshold'");
  });

  it("vehicle-wise credit limit falls back to the global setting when unconfigured (backward compatible)", () => {
    expect(revenueEngineSource).toContain('const globalLimit = Math.abs(parseFloat(s.auto_lock_threshold || "-200"));');
    expect(revenueEngineSource).toContain("if (configured === undefined || configured === null) return globalLimit;");
  });

  it("credit limits are admin-configurable, gated by finance permission, not hardcoded", () => {
    expect(routesSource).toContain('app.get("/api/admin/revenue/credit-limits", requireAdminAuth, requireFinanceRead');
    expect(routesSource).toContain('app.put("/api/admin/revenue/credit-limits/:vehicleCategoryId", requireAdminAuth, requireFinanceWrite');
    expect(routesSource).toContain('app.delete("/api/admin/revenue/credit-limits/:vehicleCategoryId", requireAdminAuth, requireFinanceWrite');
  });

  it("does not touch subscription or commission calculation logic", () => {
    // Phase 2 must not change calculateRevenueBreakdown() or its
    // commission/subscription branches - only threshold resolution.
    expect(revenueEngineSource).toContain("export async function calculateRevenueBreakdown(");
    expect(revenueEngineSource).toContain("Commission model: commission% + GST + insurance");
    expect(revenueEngineSource).toContain("Subscription model: platform_fee + GST + insurance");
  });

  it("Outstation Pool's automated matcher still does not check is_locked (enforcement lives at ride-creation instead, see P1)", () => {
    // Confirmed gap when this test was written (Phase 2): reported, not
    // silently fixed. P1 later added the actual is_locked enforcement at the
    // driver-initiated ride-creation endpoint (outstation-pool-v2.ts) rather
    // than here, since Outstation Pool has no dispatch-matching query
    // equivalent to Ride/Parcel/Local Pool's - a locked driver simply never
    // gets to create a ride in the first place. This assertion about the
    // matcher file itself remains true and is kept as a guard against a
    // future change assuming the matcher is where the check belongs.
    expect(outstationMatcherSource).not.toContain("is_locked");
  });
});

describe("Outstanding Revenue Model - P0: driver wallet recharge rollback fixed", () => {
  it("settleDriverPaymentByOrder no longer writes the nonexistent pending_payment_amount column", () => {
    // Root cause: this write, inside the same transaction as the wallet
    // credit and auto-unlock, threw on every real wallet_topup payment
    // (users.pending_payment_amount does not exist), rolling back the whole
    // transaction - the driver's Razorpay payment was captured but never
    // applied. Live-verified fixed: real wallet_topup settlement now
    // commits, credits the wallet, and unlocks correctly.
    expect(paymentSettlementSource).not.toContain("pending_payment_amount=GREATEST(0, COALESCE(pending_payment_amount, 0) - ${toMoney(rec.amount)})");
  });

  it("wallet_balance and is_locked updates in settleDriverPaymentByOrder are untouched", () => {
    // Confirms this was a minimal, isolated removal - the real canonical
    // state updates (wallet credit, auto-unlock) are unchanged.
    expect(paymentSettlementSource).toContain("const autoUnlocked = walletChange.newBalance >= unlockThreshold && wasLocked;");
    expect(paymentSettlementSource).toContain("SET is_locked=false, lock_reason=NULL, locked_at=NULL, updated_at=NOW()");
  });

});

describe("Outstanding Revenue Model - Phase 1 (Phase 1, P0): driver commission-payment settlement no longer crashes", () => {
  it("settleDriverCommissionPayment no longer selects or writes the nonexistent pending_payment_amount column", () => {
    // Sibling of the wallet-recharge rollback bug, same root cause, same
    // real dispatcher (settleDriverPaymentByOrder), different payment_type
    // ('commission_payment'). Every real commission-dues Razorpay payment
    // crashed the whole settlement transaction before this fix.
    const fnIdx = paymentSettlementSource.indexOf("async function settleDriverCommissionPayment");
    const nextFnIdx = paymentSettlementSource.indexOf("async function settleDriverSubscription");
    const body = paymentSettlementSource.slice(fnIdx, nextFnIdx);
    // The old SELECT read the column; the old UPDATE wrote it via GREATEST(...).
    // Match only actual SQL usage, not the explanatory prose comment (which
    // necessarily mentions the column name to explain why it was removed).
    expect(body).not.toMatch(/SELECT[^`]*pending_payment_amount/);
    expect(body).not.toMatch(/pending_payment_amount\s*=\s*GREATEST/);
  });

  it("total_pending_balance/pending_commission_balance/pending_gst_balance and wallet_balance/is_locked updates are untouched", () => {
    const fnIdx = paymentSettlementSource.indexOf("async function settleDriverCommissionPayment");
    const nextFnIdx = paymentSettlementSource.indexOf("async function settleDriverSubscription");
    const body = paymentSettlementSource.slice(fnIdx, nextFnIdx);
    expect(body).toContain("pending_commission_balance=${newPendingCommission}");
    expect(body).toContain("pending_gst_balance=${newPendingGst}");
    expect(body).toContain("total_pending_balance=${newPendingBalance}");
    expect(body).toContain("applyWalletChange({");
    expect(body).toContain("is_locked=${autoUnlocked ? false : Boolean(userRow.is_locked)}");
  });

  it("migration 0010 adds the unique index commission_settlements' ON CONFLICT (razorpay_payment_id) requires", () => {
    // Second root cause in the same real statement, found live-verifying the
    // pending_payment_amount fix above: no unique index backed
    // ON CONFLICT (razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL
    // on commission_settlements (only the primary key existed) - same 42P10
    // failure mode as migration 0009 fixed for driver_subscriptions, on a
    // different table.
    const migrationSql = readFileSync(
      join(repoRoot, "migrations", "0010_commission_settlements_payment_idx.sql"),
      "utf8"
    );
    expect(migrationSql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_settlements_rzp_payment_id");
    expect(migrationSql).toContain("ON public.commission_settlements (razorpay_payment_id)");
    expect(migrationSql).toContain("WHERE razorpay_payment_id IS NOT NULL");
  });
});

describe("Outstanding Revenue Model - Phase 1, P0: tip-driver wallet minting closed", () => {
  it("tip-driver no longer credits driver wallet_balance from a client-supplied amount without a matching debit", () => {
    const idx = routesSource.indexOf('app.post("/api/app/tip-driver"');
    const nextRouteIdx = routesSource.indexOf('app.post("/api/app/lost-found"');
    const body = routesSource.slice(idx, nextRouteIdx);
    // The old unconditional mint - credit driver with zero debit anywhere.
    expect(body).not.toContain("UPDATE users SET wallet_balance = wallet_balance + ${amount} WHERE id=${trip.driver_id}::uuid");
    // Fixed: atomic check-and-deduct from the customer's own wallet first.
    expect(body).toContain("UPDATE users SET wallet_balance = wallet_balance - ${tipAmount}");
    expect(body).toContain("AND wallet_balance >= ${tipAmount}");
    expect(body).toContain("UPDATE users SET wallet_balance = wallet_balance + ${tipAmount}");
  });

  it("only the customer on the trip can tip - the driver can no longer authorize tipping themselves", () => {
    const idx = routesSource.indexOf('app.post("/api/app/tip-driver"');
    const nextRouteIdx = routesSource.indexOf('app.post("/api/app/lost-found"');
    const body = routesSource.slice(idx, nextRouteIdx);
    expect(body).not.toContain("if (trip.customer_id !== user.id && trip.driver_id !== user.id)");
    expect(body).toContain("if (trip.customer_id !== user.id) return res.status(403)");
  });

  it("tip amount is capped and the trip must be completed before tipping", () => {
    const idx = routesSource.indexOf('app.post("/api/app/tip-driver"');
    const nextRouteIdx = routesSource.indexOf('app.post("/api/app/lost-found"');
    const body = routesSource.slice(idx, nextRouteIdx);
    expect(body).toContain("Math.min(Math.max(0, parseFloat(amount) || 0), 500)");
    expect(body).toContain("if (trip.current_status !== 'completed')");
  });
});

describe("Outstanding Revenue Model - P1: is_locked enforcement added to Outstation Pool and Car Sharing", () => {
  const outstationV2Source = readFileSync(join(repoRoot, "server", "outstation-pool-v2.ts"), "utf8");

  it("Outstation Pool ride creation rejects a locked driver before any ride row is created", () => {
    expect(outstationV2Source).toContain('SELECT is_locked, lock_reason FROM users WHERE id=${driver.id}::uuid LIMIT 1');
    expect(outstationV2Source).toContain('code: "ACCOUNT_LOCKED"');
    // Placed after the existing subscription-policy check, before any
    // seat/ride creation logic - reusing the exact response shape
    // (message/code/isLocked) already used by the go-online gate
    // (routes.ts), not a new locking system.
    const policyIdx = outstationV2Source.indexOf("await enforceDriverRevenuePolicy(driver.id");
    const lockIdx = outstationV2Source.indexOf('code: "ACCOUNT_LOCKED"');
    const seatsIdx = outstationV2Source.indexOf("const requestedSeats");
    expect(policyIdx).toBeGreaterThan(-1);
    expect(policyIdx).toBeLessThan(lockIdx);
    expect(lockIdx).toBeLessThan(seatsIdx);
  });

  it("Car Sharing ride creation rejects a locked driver before any ride row is created", () => {
    expect(routesSource).toContain("app.post('/api/app/driver/car-sharing/create', authApp, requireDriver");
    const createIdx = routesSource.indexOf("app.post('/api/app/driver/car-sharing/create'");
    const nextRouteIdx = routesSource.indexOf("app.post('/api/app/driver/car-sharing/rides/:rideId/start'");
    const carSharingBody = routesSource.slice(createIdx, nextRouteIdx);
    expect(carSharingBody).toContain('SELECT is_locked, lock_reason FROM users WHERE id=${driver.id}::uuid LIMIT 1');
    expect(carSharingBody).toContain('code: "ACCOUNT_LOCKED"');
  });

  it("both new checks reuse the existing ACCOUNT_LOCKED response shape, not a new locking mechanism", () => {
    for (const source of [routesSource, outstationV2Source]) {
      expect(source).toContain('"Account locked. Please recharge wallet to continue."');
      expect(source).toContain('code: "ACCOUNT_LOCKED"');
      expect(source).toContain("isLocked: true");
    }
  });
});

describe("Outstanding Revenue Model - P2: malformed vehicle category ID returns 400, not a leaked SQL error", () => {
  it("PUT and DELETE credit-limits validate the ID format before querying the database", () => {
    const putIdx = routesSource.indexOf('app.put("/api/admin/revenue/credit-limits/:vehicleCategoryId"');
    const deleteIdx = routesSource.indexOf('app.delete("/api/admin/revenue/credit-limits/:vehicleCategoryId"');
    const putBody = routesSource.slice(putIdx, deleteIdx);
    const deleteBody = routesSource.slice(deleteIdx, deleteIdx + 600);
    for (const body of [putBody, deleteBody]) {
      expect(body).toContain("const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;");
      expect(body).toContain('res.status(400).json({ message: "Invalid vehicle category ID" })');
    }
    // Validation must come before the first DB query in each handler.
    const putQueryIdx = putBody.indexOf("SELECT id FROM vehicle_categories");
    const putValidationIdx = putBody.indexOf("uuidRe.test");
    expect(putValidationIdx).toBeGreaterThan(-1);
    expect(putValidationIdx).toBeLessThan(putQueryIdx);
  });
});

describe("Outstanding Revenue Model - Phase 2: vehicle-wise revenue configuration (commission/platform fee/GST)", () => {
  const revenueEngineSource = readFileSync(join(repoRoot, "server", "revenue-engine.ts"), "utf8");

  it("loadVehicleRevenueConfig falls back to null (not a crash) when unconfigured, matching resolveDriverCreditLimit's pattern", () => {
    expect(revenueEngineSource).toContain("async function loadVehicleRevenueConfig(driverId?: string)");
    expect(revenueEngineSource).toContain("JOIN vehicle_revenue_config vrc ON vrc.vehicle_category_id = dd.vehicle_category_id");
  });

  it("commission, subscription, and hybrid models all resolve vehicle-wise config before the per-module/global fallback", () => {
    expect(revenueEngineSource).toContain("vehicleCfg?.commissionPct ?? modCfg?.commissionPct ?? revenueCfg.commissionPercent");
    expect(revenueEngineSource).toContain("vehicleCfg?.platformFeePerRide ?? parseFloat(s.sub_platform_fee_per_ride");
    expect(revenueEngineSource).toContain("vehicleCfg?.platformFeePerRide ?? parseFloat(s.hybrid_platform_fee_per_ride");
    expect(revenueEngineSource).toContain("vehicleCfg?.gstPct ?? modCfg?.commissionGstPct ?? revenueCfg.gstPercent");
  });

  it("migration 0011 creates vehicle_revenue_config with nullable override columns", () => {
    const migrationSql = readFileSync(join(repoRoot, "migrations", "0011_vehicle_revenue_config.sql"), "utf8");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS public.vehicle_revenue_config");
    expect(migrationSql).toContain("vehicle_category_id uuid PRIMARY KEY REFERENCES public.vehicle_categories(id)");
    expect(migrationSql).toContain("commission_pct numeric(6,2)");
    expect(migrationSql).toContain("platform_fee_per_ride numeric(10,2)");
    expect(migrationSql).toContain("gst_pct numeric(6,2)");
  });

  it("admin vehicle-config endpoints validate UUID format before querying, same as credit-limits", () => {
    const putIdx = routesSource.indexOf('app.put("/api/admin/revenue/vehicle-config/:vehicleCategoryId"');
    const deleteIdx = routesSource.indexOf('app.delete("/api/admin/revenue/vehicle-config/:vehicleCategoryId"');
    const putBody = routesSource.slice(putIdx, deleteIdx);
    const deleteBody = routesSource.slice(deleteIdx, deleteIdx + 600);
    for (const body of [putBody, deleteBody]) {
      expect(body).toContain("const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;");
      expect(body).toContain('res.status(400).json({ message: "Invalid vehicle category ID" })');
    }
  });

  it("admin vehicle-config endpoints are gated by the existing finance permissions, not a new permission system", () => {
    const getIdx = routesSource.indexOf('app.get("/api/admin/revenue/vehicle-config"');
    const putIdx = routesSource.indexOf('app.put("/api/admin/revenue/vehicle-config/:vehicleCategoryId"');
    const deleteIdx = routesSource.indexOf('app.delete("/api/admin/revenue/vehicle-config/:vehicleCategoryId"');
    expect(routesSource.slice(getIdx, getIdx + 120)).toContain("requireFinanceRead");
    expect(routesSource.slice(putIdx, putIdx + 120)).toContain("requireFinanceWrite");
    expect(routesSource.slice(deleteIdx, deleteIdx + 120)).toContain("requireFinanceWrite");
  });
});

describe("Outstanding Revenue Model - Phase 3: Admin Revenue Control Center", () => {
  it("/api/admin/revenue/analytics now also returns an outstanding-dues summary built from the canonical wallet_balance/is_locked fields", () => {
    const idx = routesSource.indexOf('app.get("/api/admin/revenue/analytics"');
    const nextIdx = routesSource.indexOf('app.get("/api/admin/revenue/trip/:tripId"');
    const body = routesSource.slice(idx, nextIdx);
    expect(body).toContain("COUNT(*) FILTER (WHERE is_locked = true)");
    expect(body).toContain("SUM(GREATEST(0, -wallet_balance))");
    expect(body).toContain("outstanding:");
  });

  it("Revenue Control Center UI consumes the existing analytics endpoint, not a new/duplicate one", () => {
    const revenueModelPageSource = readFileSync(join(repoRoot, "client", "src", "pages", "admin", "revenue-model.tsx"), "utf8");
    expect(revenueModelPageSource).toContain("/api/admin/revenue/analytics");
    expect(revenueModelPageSource).toContain("RevenueControlCenter");
  });

  it("driver earnings endpoint now returns GST and computes net earnings from the real per-trip driver_wallet_credit, not a re-derived formula", () => {
    const idx = routesSource.indexOf('app.get("/api/app/driver/earnings"');
    const nextIdx = routesSource.indexOf('app.get("/api/app/customer/saved-places"');
    const body = routesSource.slice(idx, nextIdx);
    // The old formula (actual_fare - commission_amount) silently ignored GST
    // and insurance, diverging from the real settled amount already stored
    // per-trip by settleRevenue() at trip completion.
    expect(body).not.toMatch(/actual_fare\s*-\s*COALESCE\(commission_amount/);
    const netEarningsOccurrences = (body.match(/SUM\(driver_wallet_credit\)/g) || []).length;
    expect(netEarningsOccurrences).toBe(4); // today/week/month/all-time branches
    const gstOccurrences = (body.match(/SUM\(gst_amount\)/g) || []).length;
    expect(gstOccurrences).toBe(4);
    expect(body).toContain("gst: parseFloat(d.gst || \"0\")");
  });

  it("driver app earnings screen displays the new GST figure", () => {
    const earningsScreenSource = readFileSync(
      join(repoRoot, "flutter_apps", "driver_app", "lib", "screens", "earnings", "earnings_screen.dart"),
      "utf8"
    );
    expect(earningsScreenSource).toContain("_stats['gst']");
    expect(earningsScreenSource).toContain("_statCard('GST'");
  });
});

describe("Outstanding Revenue Model - P0: driver subscription activation no longer crashes", () => {
  it("settleDriverSubscription no longer writes the nonexistent plan_base_price column", () => {
    // Root cause: this INSERT wrote 4 columns that didn't exist on
    // driver_subscriptions, crashing every real subscription purchase.
    // Verified per-column before deciding: plan_base_price had zero
    // references anywhere else in the repo and is fully derivable via
    // plan_id -> subscription_plans.price - removed rather than added to
    // schema. gst_amount/insurance_amount/insurance_plan_id are real,
    // consumed-by-the-live-driver-app fields - added via migration 0009
    // instead.
    expect(paymentSettlementSource).not.toMatch(/,\s*plan_base_price\s*,/);
    expect(paymentSettlementSource).not.toContain("${planBasePaise / 100}");
  });

  it("gst_amount, insurance_amount, and insurance_plan_id are still written - these were genuinely needed, not removed", () => {
    const settleSubIdx = paymentSettlementSource.indexOf("async function settleDriverSubscription");
    const nextFnIdx = paymentSettlementSource.indexOf("export async function settleDriverPaymentByOrder");
    const body = paymentSettlementSource.slice(settleSubIdx, nextFnIdx);
    expect(body).toContain("gst_amount, insurance_amount, insurance_plan_id");
    expect(body).toContain("${gstAmt}, ${insuranceAmt}, ${insurancePlanId || null}::uuid");
  });

  it("migration 0009 adds exactly the 3 genuinely-needed columns, not plan_base_price", () => {
    const migrationSql = readFileSync(
      join(repoRoot, "migrations", "0009_driver_subscription_insurance_gst.sql"),
      "utf8"
    );
    expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS gst_amount");
    expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS insurance_amount");
    expect(migrationSql).toContain("ADD COLUMN IF NOT EXISTS insurance_plan_id");
    expect(migrationSql).not.toMatch(/ADD COLUMN[^;]*plan_base_price/);
  });

  it("migration 0009 also adds the unique index the same INSERT's ON CONFLICT clause requires", () => {
    // Second, related root cause found live-verifying the same statement:
    // settleDriverSubscription()'s ON CONFLICT (razorpay_payment_id) WHERE
    // razorpay_payment_id IS NOT NULL had no matching unique index anywhere
    // on the table - Postgres error 42P10 on every call, columns
    // notwithstanding. This preserves the existing idempotency design
    // (safe retry of the same Razorpay payment) rather than removing it.
    const migrationSql = readFileSync(
      join(repoRoot, "migrations", "0009_driver_subscription_insurance_gst.sql"),
      "utf8"
    );
    expect(migrationSql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_subscriptions_rzp_payment_id");
    expect(migrationSql).toContain("ON public.driver_subscriptions (razorpay_payment_id)");
    expect(migrationSql).toContain("WHERE razorpay_payment_id IS NOT NULL");
  });
});
