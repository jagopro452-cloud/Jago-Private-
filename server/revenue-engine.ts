/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  UNIFIED REVENUE ENGINE — Production-grade revenue management
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *  Commission Model: percentage + GST + insurance → all go to admin/platform
 *  Subscription Model: fixed platform_fee + GST + insurance → all go to admin
 *  Hybrid Model: commission% + platform_fee + GST + insurance → admin
 *
 *  Supports: Rides, Parcel, B2B Parcel, City Carpool, Outstation Pool
 *  Each service has INDEPENDENT revenue model configuration.
 *
 *  Key invariant (Telugu request): Commission model lo percentage + GST + insurance
 *  anni admin ki ravali — all three must flow to admin wallet/revenue.
 */

import { db, pool } from "./db";
import { sql } from "drizzle-orm";
import { getRevenueConfig } from "./revenue-config";
import { assertSchemaObjectsOrThrow } from "./schema-health";

const rawDb = db;
const rawSql = sql;

type SqlExecutor = {
  execute: (query: any) => Promise<any>;
};

// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface RevenueBreakdown {
  model: "commission" | "subscription" | "hybrid" | "launch_free";
  commission: number;       // commission amount (₹)
  platformFee: number;      // subscription flat fee (₹)
  gst: number;              // GST amount (₹)
  insurance: number;        // insurance amount (₹)
  total: number;            // total platform deduction (₹)
  commissionPct: number;    // commission rate used
  gstPct: number;           // GST rate used
  fareBeforeDeduction: number;
  driverEarnings: number;   // what the driver keeps
}

export type ServiceCategory = "rides" | "parcel" | "b2b_parcel" | "cargo" | "intercity"
  | "city_pool" | "outstation_pool";

export type PaymentMethod = "cash" | "upi" | "wallet" | "online" | "razorpay" | "card" | "prepaid";

export interface UPIProvider {
  id: string;
  name: string;
  upiHandle: string;
  icon: string;
  isActive: boolean;
}

export interface CalculatedRevenue {
  model: RevenueBreakdown["model"];
  commission: number;
  platformFee: number;
  gst: number;
  insurance: number;
  totalDeduction: number;
  driverEarning: number;
}

export interface AppliedSettlement {
  breakdown: RevenueBreakdown;
  settlement: { newWalletBalance: number; isLocked: boolean; lockReason?: string };
}

export interface PendingBalanceResult {
  newWalletBalance: number;
  pendingBalance: number;
  pendingCommission: number;
  pendingGst: number;
  isLocked: boolean;
  autoUnlocked?: boolean;
  lockReason?: string;
}

export interface WalletChangeResult {
  userId: string;
  amount: number;
  type: "CREDIT" | "DEBIT";
  newBalance: number;
}

export interface CompanyWalletChangeResult {
  companyId: string;
  amount: number;
  type: "CREDIT" | "DEBIT";
  newBalance: number;
}

export const SUPPORTED_UPI_PROVIDERS: UPIProvider[] = [
  { id: "gpay",    name: "Google Pay", upiHandle: "@okicici",   icon: "💳", isActive: true },
  { id: "phonepe", name: "PhonePe",    upiHandle: "@ybl",       icon: "💜", isActive: true },
  { id: "paytm",   name: "Paytm",      upiHandle: "@paytm",     icon: "🔵", isActive: true },
  { id: "bhim",    name: "BHIM",        upiHandle: "@upi",       icon: "🇮🇳", isActive: true },
];

let walletEventsReady = false;

async function ensureWalletEventsTable(): Promise<void> {
  if (walletEventsReady) return;
  const tableR = await rawDb.execute(rawSql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema='public' AND table_name='wallet_events'
    ) AS exists
  `).catch(() => ({ rows: [{ exists: false }] as any[] }));
  if ((tableR.rows[0] as any)?.exists !== true) {
    throw new Error("wallet_events table is missing. Run SQL migrations before starting the server.");
  }
  walletEventsReady = true;
}

export async function applyWalletChange(params: {
  userId?: string;
  driverId?: string;
  amount: number;
  type: "CREDIT" | "DEBIT";
  reason: string;
  refId?: string | null;
  metadata?: Record<string, unknown>;
  requireSufficientFunds?: boolean;
  tx?: SqlExecutor;
}): Promise<WalletChangeResult> {
  const userId = String(params.userId || params.driverId || "");
  if (!userId) throw new Error("userId is required");
  const amount = Math.round(Number(params.amount || 0) * 100) / 100;
  if (!(amount > 0)) throw new Error("amount must be positive");

  await ensureWalletEventsTable();

  if (params.tx) {
    const lockRes = await params.tx.execute(rawSql`
      SELECT wallet_balance
      FROM users
      WHERE id=${userId}::uuid
      FOR UPDATE
    `);
    if (!lockRes.rows.length) {
      throw new Error("Wallet owner not found");
    }

    const currentBalance = parseFloat((lockRes.rows[0] as any)?.wallet_balance || 0);
    if (params.type === "DEBIT" && params.requireSufficientFunds && currentBalance < amount) {
      throw new Error("Insufficient wallet balance");
    }

    const updateRes = params.type === "CREDIT"
      ? await params.tx.execute(rawSql`
          UPDATE users
          SET wallet_balance = wallet_balance + ${amount},
              updated_at = NOW()
          WHERE id=${userId}::uuid
          RETURNING wallet_balance
        `)
      : await params.tx.execute(rawSql`
          UPDATE users
          SET wallet_balance = wallet_balance - ${amount},
              updated_at = NOW()
          WHERE id=${userId}::uuid
            ${params.requireSufficientFunds ? rawSql`AND wallet_balance >= ${amount}` : rawSql``}
          RETURNING wallet_balance
        `);

    if (!updateRes.rows.length) {
      if (params.type === "DEBIT" && params.requireSufficientFunds) throw new Error("Insufficient wallet balance");
      throw new Error("Wallet owner not found");
    }

    const newBalance = parseFloat((updateRes.rows[0] as any)?.wallet_balance || 0);
    await params.tx.execute(rawSql`
      INSERT INTO wallet_events (user_id, amount, type, reason, ref_id, metadata)
      VALUES (
        ${userId}::uuid,
        ${amount},
        ${params.type},
        ${params.reason},
        ${params.refId || null},
        ${JSON.stringify(params.metadata || {})}::jsonb
      )
    `);
    return {
      userId,
      amount,
      type: params.type,
      newBalance,
    };
  }

  // Atomic wallet operation: lock row → update balance → insert event log, all in one transaction.
  // SELECT FOR UPDATE prevents concurrent requests from reading stale balance before either UPDATE commits.
  const client = await pool.connect();
  let newBalance: number;
  try {
    await client.query("BEGIN");

    // Lock the user row for this transaction
    const lockRes = await client.query(
      "SELECT wallet_balance FROM users WHERE id=$1::uuid FOR UPDATE",
      [userId]
    );
    if (!lockRes.rows.length) {
      await client.query("ROLLBACK");
      throw new Error("Wallet owner not found");
    }

    const currentBalance = parseFloat(lockRes.rows[0].wallet_balance || 0);

    if (params.type === "DEBIT" && params.requireSufficientFunds && currentBalance < amount) {
      await client.query("ROLLBACK");
      throw new Error("Insufficient wallet balance");
    }

    const updateRes = params.type === "CREDIT"
      ? await client.query(
          "UPDATE users SET wallet_balance = wallet_balance + $1, updated_at = NOW() WHERE id=$2::uuid RETURNING wallet_balance",
          [amount, userId]
        )
      : await client.query(
          params.requireSufficientFunds
            ? "UPDATE users SET wallet_balance = wallet_balance - $1, updated_at = NOW() WHERE id=$2::uuid AND wallet_balance >= $1 RETURNING wallet_balance"
            : "UPDATE users SET wallet_balance = wallet_balance - $1, updated_at = NOW() WHERE id=$2::uuid RETURNING wallet_balance",
          [amount, userId]
        );

    if (!updateRes.rows.length) {
      await client.query("ROLLBACK");
      if (params.type === "DEBIT" && params.requireSufficientFunds) throw new Error("Insufficient wallet balance");
      throw new Error("Wallet owner not found");
    }

    newBalance = parseFloat(updateRes.rows[0].wallet_balance || 0);

    await client.query(
      "INSERT INTO wallet_events (user_id, amount, type, reason, ref_id, metadata) VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb)",
      [userId, amount, params.type, params.reason, params.refId || null, JSON.stringify(params.metadata || {})]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return {
    userId,
    amount,
    type: params.type,
    newBalance,
  };
}

export async function applyCompanyWalletChange(params: {
  companyId: string;
  amount: number;
  type: "CREDIT" | "DEBIT";
  reason: string;
  refId?: string | null;
  metadata?: Record<string, unknown>;
  tripDelta?: number;
}): Promise<CompanyWalletChangeResult> {
  const companyId = String(params.companyId || "");
  if (!companyId) throw new Error("companyId is required");
  const amount = Math.round(Number(params.amount || 0) * 100) / 100;
  if (!(amount > 0)) throw new Error("amount must be positive");
  const tripDelta = Number(params.tripDelta || 0);

  const client = await pool.connect();
  let newBalance: number;
  try {
    await client.query("BEGIN");

    const lockRes = await client.query(
      "SELECT wallet_balance FROM b2b_companies WHERE id=$1::uuid FOR UPDATE",
      [companyId]
    );
    if (!lockRes.rows.length) {
      await client.query("ROLLBACK");
      throw new Error("Company not found");
    }

    const updateRes = params.type === "CREDIT"
      ? await client.query(
          "UPDATE b2b_companies SET wallet_balance = wallet_balance + $1, total_trips = GREATEST(0, total_trips + $2), updated_at = NOW() WHERE id=$3::uuid RETURNING wallet_balance",
          [amount, tripDelta, companyId]
        )
      : await client.query(
          "UPDATE b2b_companies SET wallet_balance = wallet_balance - $1, total_trips = GREATEST(0, total_trips + $2), updated_at = NOW() WHERE id=$3::uuid RETURNING wallet_balance",
          [amount, tripDelta, companyId]
        );

    if (!updateRes.rows.length) {
      await client.query("ROLLBACK");
      throw new Error("Company not found");
    }

    newBalance = parseFloat(updateRes.rows[0].wallet_balance || 0);

    await client.query(
      "INSERT INTO company_wallet_events (company_id, amount, type, reason, ref_id, metadata) VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb)",
      [companyId, amount, params.type, params.reason, params.refId || null, JSON.stringify(params.metadata || {})]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return { companyId, amount, type: params.type, newBalance };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SERVICE MODEL KEY MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

/** Map service category → revenue_model_settings key */
function normalizeServiceCategory(service: string): ServiceCategory {
  switch (String(service || "").toLowerCase()) {
    case "ride":
    case "rides":
      return "rides";
    case "parcel":
      return "parcel";
    case "b2b":
    case "b2b_parcel":
      return "b2b_parcel";
    case "cargo":
      return "cargo";
    case "intercity":
      return "intercity";
    case "city_pool":
    case "carpool":
      return "city_pool";
    case "outstation_pool":
      return "outstation_pool";
    default:
      return "rides";
  }
}

function getModelKey(serviceCategory: ServiceCategory): string {
  switch (serviceCategory) {
    case "rides":           return "rides_model";
    case "parcel":          return "parcels_model";
    case "b2b_parcel":      return "parcels_model";       // B2B parcel uses same as parcel
    case "cargo":           return "cargo_model";
    case "intercity":       return "intercity_model";
    case "city_pool":       return "city_pool_model";
    case "outstation_pool": return "outstation_pool_model";
    default:                return "rides_model";
  }
}

/** Map service category → service_revenue_config module_name */
function getModuleName(serviceCategory: ServiceCategory): string {
  switch (serviceCategory) {
    case "rides":           return "ride";
    case "parcel":          return "parcel";
    case "b2b_parcel":      return "b2b";
    case "cargo":           return "parcel";
    case "intercity":       return "outstation";
    case "city_pool":       return "carpool";
    case "outstation_pool": return "outstation";
    default:                return "ride";
  }
}

/** Load per-module config from service_revenue_config (null if not found) */
async function loadModuleConfig(serviceCategory: ServiceCategory): Promise<{
  revenueModel: string;
  commissionPct: number;
  commissionGstPct: number;   // GST on commission amount (e.g. 18%)
  isActive: boolean;
} | null> {
  const moduleName = getModuleName(serviceCategory);
  const r = await rawDb.execute(rawSql`
    SELECT revenue_model, commission_percentage, commission_gst_percentage, is_active
    FROM service_revenue_config
    WHERE module_name = ${moduleName}
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const row = r.rows[0] as any;
  if (!row) return null;
  return {
    revenueModel: row.revenue_model || "commission",
    commissionPct: parseFloat(row.commission_percentage) || 0,
    commissionGstPct: parseFloat(row.commission_gst_percentage) || 18,
    isActive: row.is_active !== false,
  };
}

/** Map service category → GST rate key */
function getGstKey(serviceCategory: ServiceCategory): string {
  switch (serviceCategory) {
    case "parcel":
    case "b2b_parcel":
    case "cargo":           return "parcel_gst_rate";
    default:                return "ride_gst_rate";
  }
}

export async function getCustomerGstRatePercent(service: ServiceCategory | string): Promise<number> {
  const serviceCategory = normalizeServiceCategory(String(service));
  const settings = await loadRevenueSettings();
  const key = getGstKey(serviceCategory);
  const fallback = serviceCategory === "parcel" || serviceCategory === "b2b_parcel" || serviceCategory === "cargo" ? 18 : 5;
  const value = parseFloat(settings[key] || String(fallback));
  return Number.isFinite(value) ? value : fallback;
}

export async function calculateCustomerGstAmount(service: ServiceCategory | string, taxableAmount: number): Promise<number> {
  const pct = await getCustomerGstRatePercent(service);
  const taxablePaise = Math.round(Number(taxableAmount || 0) * 100);
  return Math.round(taxablePaise * Math.round(pct * 100) / 10000) / 100;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOAD REVENUE SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

export async function loadRevenueSettings(): Promise<Record<string, string>> {
  const r = await rawDb.execute(rawSql`
    SELECT key_name, value FROM revenue_model_settings
  `).catch(() => ({ rows: [] as any[] }));
  const s: Record<string, string> = {};
  (r.rows as any[]).forEach((row: any) => { s[row.key_name] = row.value; });
  return s;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Outstanding Revenue Model, Phase 2 — vehicle-wise credit limit resolution
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolves the Outstanding threshold above which a driver auto-locks.
 * Outstanding = GREATEST(0, -wallet_balance) - see the corrected note above
 * applyPendingBalanceDebit(). Vehicle-category-specific limit if one is
 * configured in vehicle_credit_limits; otherwise falls back to the existing
 * global `auto_lock_threshold` setting - so a category with no configured
 * limit keeps today's behavior exactly (backward compatible, requirement #5).
 * Every auto-lock/unlock call site should call this instead of reading
 * `auto_lock_threshold` directly, so credit-limit resolution lives in
 * exactly one place.
 */
export async function resolveDriverCreditLimit(
  driverId: string,
  settings?: Record<string, string>,
): Promise<number> {
  const s = settings || await loadRevenueSettings();
  const globalLimit = Math.abs(parseFloat(s.auto_lock_threshold || "-200"));

  const r = await rawDb.execute(rawSql`
    SELECT vcl.credit_limit
    FROM driver_details dd
    JOIN vehicle_credit_limits vcl ON vcl.vehicle_category_id = dd.vehicle_category_id
    WHERE dd.user_id = ${driverId}::uuid
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));

  const configured = (r.rows[0] as any)?.credit_limit;
  if (configured === undefined || configured === null) return globalLimit;
  const parsed = Math.abs(parseFloat(configured));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : globalLimit;
}

/**
 * Phase 2 — vehicle-wise revenue configuration. Same precedence shape as the
 * vehicle-wise credit limit resolver above: a configured, non-null column for
 * the driver's vehicle category overrides the per-module config / global
 * setting; an unconfigured or NULL column falls through unchanged (backward
 * compatible).
 */
async function loadVehicleRevenueConfig(driverId?: string): Promise<{
  commissionPct: number | null;
  platformFeePerRide: number | null;
  gstPct: number | null;
} | null> {
  if (!driverId) return null;
  const r = await rawDb.execute(rawSql`
    SELECT vrc.commission_pct, vrc.platform_fee_per_ride, vrc.gst_pct
    FROM driver_details dd
    JOIN vehicle_revenue_config vrc ON vrc.vehicle_category_id = dd.vehicle_category_id
    WHERE dd.user_id = ${driverId}::uuid
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const row = r.rows[0] as any;
  if (!row) return null;
  return {
    commissionPct: row.commission_pct !== null && row.commission_pct !== undefined ? parseFloat(row.commission_pct) : null,
    platformFeePerRide: row.platform_fee_per_ride !== null && row.platform_fee_per_ride !== undefined ? parseFloat(row.platform_fee_per_ride) : null,
    gstPct: row.gst_pct !== null && row.gst_pct !== undefined ? parseFloat(row.gst_pct) : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CORE: Calculate revenue breakdown for ANY service
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate the full revenue breakdown for a completed trip/order.
 * Commission model: commission% + GST + insurance → all to admin
 * Subscription model: platform_fee + GST + insurance → all to admin
 * Hybrid: commission% + platform_fee + GST + insurance → all to admin
 *
 * Returns exact paise-based calculations (no floating point drift).
 */
export async function calculateRevenueBreakdown(
  fare: number,
  serviceCategory: ServiceCategory,
  driverId?: string,
): Promise<RevenueBreakdown> {
  const [s, modCfg, vehicleCfg] = await Promise.all([
    loadRevenueSettings(),
    loadModuleConfig(serviceCategory),
    loadVehicleRevenueConfig(driverId),
  ]);
  const revenueCfg = await getRevenueConfig(serviceCategory);

  // Determine active model: per-module config takes priority over global settings
  const modelKey = getModelKey(serviceCategory);
  const activeModel = modCfg?.revenueModel || revenueCfg.model || s[modelKey] || s.active_model || "commission";

  // Check launch free period
  let launchFreeApplied = false;
  if (driverId) {
    const campaignGlobalOn = s["launch_campaign_enabled"] !== "false";
    if (campaignGlobalOn) {
      const dr = await rawDb.execute(rawSql`
        SELECT launch_free_active, free_period_end FROM users WHERE id=${driverId}::uuid LIMIT 1
      `).catch(() => ({ rows: [] as any[] }));
      const d = dr.rows[0] as any;
      if (d?.launch_free_active === true && d?.free_period_end && new Date(d.free_period_end) >= new Date()) {
        launchFreeApplied = true;
      }
      // Auto-expire
      if (d?.launch_free_active === true && d?.free_period_end && new Date(d.free_period_end) < new Date()) {
        await rawDb.execute(rawSql`UPDATE users SET launch_free_active=false WHERE id=${driverId}::uuid`).catch(() => {});
      }
    }
  }

  // INTEGER PAISE MATH to prevent floating-point drift
  const farePaise = Math.round(fare * 100);

  const insPaise = Math.round(parseFloat(s.commission_insurance_per_ride || "2") * 100);
  let deductPaise = 0;
  let breakdown: RevenueBreakdown;

  if (launchFreeApplied) {
    // Launch free: only insurance charged (no commission/GST during free period)
    deductPaise = insPaise;
    breakdown = {
      model: "launch_free", commission: 0, platformFee: 0,
      gst: 0, insurance: insPaise / 100, total: deductPaise / 100,
      commissionPct: 0, gstPct: 0,
      fareBeforeDeduction: fare, driverEarnings: (farePaise - deductPaise) / 100,
    };
  } else if (activeModel === "commission") {
    // COMMISSION MODEL: commission% + GST-on-commission + insurance → ALL go to admin
    // Rates: per-module config takes priority over global settings
    const commPct = vehicleCfg?.commissionPct ?? modCfg?.commissionPct ?? revenueCfg.commissionPercent ?? parseFloat(s.commission_pct || "15");
    const gstOnCommPct = vehicleCfg?.gstPct ?? modCfg?.commissionGstPct ?? revenueCfg.gstPercent ?? parseFloat(s.commission_gst_on_comm || "18");
    const commPctX100 = Math.round(commPct * 100);
    const commPaise = Math.round(farePaise * commPctX100 / 10000);
    const gstPaise  = Math.round(commPaise * Math.round(gstOnCommPct * 100) / 10000); // GST on commission
    deductPaise = commPaise + gstPaise + insPaise; // ALL THREE → admin

    breakdown = {
      model: "commission",
      commission: commPaise / 100,
      platformFee: 0,
      gst: gstPaise / 100,
      insurance: insPaise / 100,
      total: deductPaise / 100,
      commissionPct: commPct,
      gstPct: gstOnCommPct,
      fareBeforeDeduction: fare,
      driverEarnings: (farePaise - deductPaise) / 100,
    };
  } else if (activeModel === "subscription") {
    // Subscription mode: flat platform fee + GST + insurance per ride (no % commission).
    const platPaise = Math.round((vehicleCfg?.platformFeePerRide ?? parseFloat(s.sub_platform_fee_per_ride || "5")) * 100);
    const gstOnCommPct = vehicleCfg?.gstPct ?? modCfg?.commissionGstPct ?? revenueCfg.gstPercent ?? parseFloat(s.commission_gst_on_comm || "18");
    const gstPaise = Math.round(platPaise * Math.round(gstOnCommPct * 100) / 10000);
    deductPaise = platPaise + gstPaise + insPaise;

    breakdown = {
      model: "subscription",
      commission: 0,
      platformFee: platPaise / 100,
      gst: gstPaise / 100,
      insurance: insPaise / 100,
      total: deductPaise / 100,
      commissionPct: 0,
      gstPct: gstOnCommPct,
      fareBeforeDeduction: fare,
      driverEarnings: (farePaise - deductPaise) / 100,
    };
  } else if (activeModel === "hybrid") {
    // HYBRID: commission% + platform_fee + GST + insurance → admin
    const commPct = vehicleCfg?.commissionPct ?? modCfg?.commissionPct ?? revenueCfg.commissionPercent ?? parseFloat(s.hybrid_commission_pct || s.commission_pct || "10");
    const platPaise = Math.round((vehicleCfg?.platformFeePerRide ?? parseFloat(s.hybrid_platform_fee_per_ride || s.sub_platform_fee_per_ride || "5")) * 100);
    const gstOnCommPct = vehicleCfg?.gstPct ?? modCfg?.commissionGstPct ?? revenueCfg.gstPercent ?? parseFloat(s.commission_gst_on_comm || "18");
    const commPctX100 = Math.round(commPct * 100);
    const commPaise = Math.round(farePaise * commPctX100 / 10000);
    const gstPaise  = Math.round((commPaise + platPaise) * Math.round(gstOnCommPct * 100) / 10000);
    deductPaise = commPaise + platPaise + gstPaise + insPaise;

    breakdown = {
      model: "hybrid",
      commission: commPaise / 100,
      platformFee: platPaise / 100,
      gst: gstPaise / 100,
      insurance: insPaise / 100,
      total: deductPaise / 100,
      commissionPct: commPct,
      gstPct: gstOnCommPct,
      fareBeforeDeduction: fare,
      driverEarnings: (farePaise - deductPaise) / 100,
    };
  } else {
    // fallback — treat as commission
    const commPct = modCfg?.commissionPct ?? revenueCfg.commissionPercent ?? parseFloat(s.commission_pct || "15");
    const gstOnCommPct = modCfg?.commissionGstPct ?? revenueCfg.gstPercent ?? parseFloat(s.commission_gst_on_comm || "18");
    const commPctX100 = Math.round(commPct * 100);
    const commPaise = Math.round(farePaise * commPctX100 / 10000);
    const gstPaise  = Math.round(commPaise * Math.round(gstOnCommPct * 100) / 10000);
    deductPaise = commPaise + gstPaise + insPaise;

    breakdown = {
      model: "commission",
      commission: commPaise / 100,
      platformFee: 0,
      gst: gstPaise / 100,
      insurance: insPaise / 100,
      total: deductPaise / 100,
      commissionPct: commPct,
      gstPct: gstOnCommPct,
      fareBeforeDeduction: fare,
      driverEarnings: (farePaise - deductPaise) / 100,
    };
  }

  return breakdown;
}

export async function calculateRevenue(
  service: ServiceCategory | string,
  fare: number,
  driverId?: string,
): Promise<CalculatedRevenue> {
  const breakdown = await calculateRevenueBreakdown(fare, normalizeServiceCategory(String(service)), driverId);
  return {
    model: breakdown.model,
    commission: breakdown.commission,
    platformFee: breakdown.platformFee,
    gst: breakdown.gst,
    insurance: breakdown.insurance,
    totalDeduction: breakdown.total,
    driverEarning: breakdown.driverEarnings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SETTLE: Apply revenue to driver wallet + admin revenue + GST wallet
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * After calculating breakdown, settle it:
 * 1. Update driver wallet (negative for cash, positive for online)
 * 2. Record commission_settlements
 * 3. Credit company_gst_wallet
 * 4. Record admin_revenue
 * 5. Auto-lock if threshold breached
 *
 * Returns: { newWalletBalance, isLocked, lockReason }
 */
export async function settleRevenue(params: {
  driverId: string;
  tripId: string;
  fare: number;
  paymentMethod: PaymentMethod;
  breakdown: RevenueBreakdown;
  serviceCategory: ServiceCategory;
  serviceLabel?: string;
  customerWalletBalance?: number; // Needed for wallet payment validation
  tx?: SqlExecutor;
}): Promise<{ newWalletBalance: number; isLocked: boolean; lockReason?: string }> {
  const { driverId, tripId, fare, paymentMethod, breakdown, serviceCategory, serviceLabel } = params;
  const executor = params.tx || rawDb;
  const deductAmount = breakdown.total;
  const driverWalletCredit = breakdown.driverEarnings;
  const gstAmount = breakdown.gst;
  const commissionOwed = parseFloat((deductAmount - gstAmount).toFixed(2)); // commission + insurance portion

  if (deductAmount <= 0) {
    return { newWalletBalance: 0, isLocked: false };
  }

  const s = await loadRevenueSettings();
  const lockThresholdVal = await resolveDriverCreditLimit(driverId, s);

  const balBeforeR = await executor.execute(rawSql`
    SELECT wallet_balance
    FROM users WHERE id=${driverId}::uuid LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const balBefore = balBeforeR.rows[0] as any || {};
  const prevWalletBalance = parseFloat(balBefore.wallet_balance ?? "0") || 0;
  const prevTotal = Math.max(0, -prevWalletBalance);

  // Determine if payment is online (platform collected) or cash (driver collected)
  let effectivePaymentMethod = paymentMethod;
  if (paymentMethod === "wallet" && params.customerWalletBalance !== undefined) {
    if (params.customerWalletBalance < fare) {
      effectivePaymentMethod = "cash"; // Insufficient wallet → treat as cash
    }
  }
  const isOnlinePayment = ["online", "wallet", "upi", "razorpay", "card", "prepaid"].includes(effectivePaymentMethod);

  let wUpd: any;
  let newTotal = prevTotal;

  if (isOnlinePayment) {
    // ONLINE: Platform already collected fare. Credit driver net amount.
    const walletChange = await applyWalletChange({
      userId: driverId,
      amount: driverWalletCredit,
      type: "CREDIT",
      reason: "trip_settlement_credit",
      refId: tripId,
      metadata: { serviceCategory, paymentMethod: effectivePaymentMethod },
      tx: params.tx,
    });
    wUpd = await executor.execute(rawSql`
      UPDATE users
      SET completed_rides_count = COALESCE(completed_rides_count, 0) + 1
      WHERE id=${driverId}::uuid
      RETURNING ${walletChange.newBalance}::numeric AS wallet_balance, is_locked
    `);
    newTotal = Math.max(0, -walletChange.newBalance);
  } else {
    // CASH: Driver collected full fare. Platform dues tracked only in wallet.
    const walletChange = await applyWalletChange({
      userId: driverId,
      amount: deductAmount,
      type: "DEBIT",
      reason: "cash_ride_dues",
      refId: tripId,
      metadata: { serviceCategory, paymentMethod: effectivePaymentMethod },
      tx: params.tx,
    });
    wUpd = await executor.execute(rawSql`
      UPDATE users
      SET completed_rides_count = COALESCE(completed_rides_count, 0) + 1
      WHERE id=${driverId}::uuid
      RETURNING ${walletChange.newBalance}::numeric AS wallet_balance, is_locked
    `);
    newTotal = Math.max(0, -walletChange.newBalance);
  }

  const wRow: any = wUpd?.rows?.[0] || {};
  const newWalletBalance = parseFloat(wRow.wallet_balance ?? 0);
  let isLocked = wRow.is_locked === true;
  let lockReason: string | undefined;

  // Auto-lock for CASH rides only
  if (!isOnlinePayment && !isLocked) {
    if (newWalletBalance < -lockThresholdVal) {
      lockReason = `Wallet balance ₹${newWalletBalance.toFixed(2)} is below -₹${lockThresholdVal}. Recharge to unlock.`;
      await executor.execute(rawSql`
        UPDATE users SET is_locked=true, lock_reason=${lockReason}, locked_at=NOW()
        WHERE id=${driverId}::uuid
      `);
      isLocked = true;
    }
  }

  // ── GST: credit to company GST wallet ───────────────────────────────────
  if (gstAmount > 0) {
    await executor.execute(rawSql`
      UPDATE company_gst_wallet
      SET balance = balance + ${gstAmount},
          total_collected = total_collected + ${gstAmount},
          total_trips = total_trips + 1,
          updated_at = NOW()
      WHERE id = 1
    `).catch(() => {});
  }

  // ── Commission settlements audit trail ──────────────────────────────────
  const svcLabel = serviceLabel || serviceCategory || "ride";
  if (commissionOwed > 0) {
    await executor.execute(rawSql`
      INSERT INTO commission_settlements
        (driver_id, trip_id, settlement_type, commission_amount, gst_amount, total_amount,
         direction, balance_before, balance_after, ride_fare, service_type, description)
      VALUES
        (${driverId}::uuid, ${tripId}::uuid, 'commission_debit',
         ${commissionOwed}, 0, ${commissionOwed},
         'debit', ${prevTotal}, ${newTotal}, ${fare}, ${svcLabel},
         ${"Commission " + (breakdown.model) + " for " + svcLabel + " " + tripId.slice(0, 8)})
    `).catch(() => {});
  }
  if (gstAmount > 0) {
    await executor.execute(rawSql`
      INSERT INTO commission_settlements
        (driver_id, trip_id, settlement_type, commission_amount, gst_amount, total_amount,
         direction, balance_before, balance_after, ride_fare, service_type, description)
      VALUES
        (${driverId}::uuid, ${tripId}::uuid, 'gst_debit',
         0, ${gstAmount}, ${gstAmount},
         'debit', ${prevTotal}, ${newTotal}, ${fare}, ${svcLabel},
         ${"GST (" + breakdown.gstPct + "%) for " + svcLabel + " " + tripId.slice(0, 8)})
    `).catch(() => {});
  }

  // ── Admin revenue record ────────────────────────────────────────────────
  const revenueType = breakdown.model === "launch_free" ? "gst_only"
    : breakdown.model === "commission" ? "commission"
    : breakdown.model === "hybrid" ? "hybrid_fee"
    : "subscription_fee";
  await executor.execute(rawSql`
    INSERT INTO admin_revenue (driver_id, trip_id, amount, revenue_type, breakdown)
    VALUES (${driverId}::uuid, ${tripId}::uuid, ${deductAmount}, ${revenueType}, ${JSON.stringify(breakdown)}::jsonb)
  `).catch(() => {});

  // ── Driver payment record (legacy table) ────────────────────────────────
  const deductDesc = breakdown.model === "launch_free"
    ? `GST ₹${gstAmount} for ${svcLabel} ${tripId.slice(0, 8)}… (launch period)`
    : `Platform fee (${breakdown.model}) ₹${deductAmount} [comm:₹${breakdown.commission} + GST:₹${gstAmount} + ins:₹${breakdown.insurance}] for ${svcLabel} ${tripId.slice(0, 8)}…`;
  await executor.execute(rawSql`
    INSERT INTO driver_payments (driver_id, amount, payment_type, status, description)
    VALUES (${driverId}::uuid, ${deductAmount}, 'deduction', 'completed', ${deductDesc})
  `).catch(() => {});

  // ── Transaction record ──────────────────────────────────────────────────
  try {
    if (isOnlinePayment) {
      await executor.execute(rawSql`
        INSERT INTO transactions (user_id, account, credit, debit, balance, transaction_type, ref_transaction_id)
        VALUES (${driverId}::uuid, ${"Trip earnings (online " + svcLabel + ")"}, ${driverWalletCredit}, 0, ${newWalletBalance}, ${"trip_earning"}, ${tripId})
        ON CONFLICT (ref_transaction_id, transaction_type) WHERE ref_transaction_id IS NOT NULL DO NOTHING
      `);
    } else {
      await executor.execute(rawSql`
        INSERT INTO transactions (user_id, account, credit, debit, balance, transaction_type, ref_transaction_id)
        VALUES (${driverId}::uuid, ${"Platform fee (cash " + svcLabel + ")"}, 0, ${deductAmount}, ${newWalletBalance}, ${"commission_deduction"}, ${tripId})
        ON CONFLICT (ref_transaction_id, transaction_type) WHERE ref_transaction_id IS NOT NULL DO NOTHING
      `);
    }
  } catch (e: any) { console.error("[REVENUE-TX]", e.message); }

  return { newWalletBalance, isLocked, lockReason };
}

export async function applySettlement(params: {
  rideId: string;
  service: ServiceCategory | string;
  fare: number;
  driverId: string;
  paymentMethod: PaymentMethod;
  serviceLabel?: string;
  customerWalletBalance?: number;
}): Promise<AppliedSettlement> {
  const serviceCategory = normalizeServiceCategory(String(params.service));
  const breakdown = await calculateRevenueBreakdown(params.fare, serviceCategory, params.driverId);
  const settlement = await settleRevenue({
    driverId: params.driverId,
    tripId: params.rideId,
    fare: params.fare,
    paymentMethod: params.paymentMethod,
    breakdown,
    serviceCategory,
    serviceLabel: params.serviceLabel || serviceCategory,
    customerWalletBalance: params.customerWalletBalance,
  });
  return { breakdown, settlement };
}

// CORRECTED (Outstanding Revenue Model, Phase 1 rebuild - see the corrected
// architecture report): users.pending_payment_amount, referenced below, does
// NOT exist anywhere in the schema (verified: no migration, root or server,
// ever adds it to `users` - only to `trip_requests`, a different table and a
// different concept). The two functions below are unreachable dead code
// (zero callers anywhere in the repo) and would throw
// "column pending_payment_amount does not exist" if ever invoked.
//
// The real, schema-backed, live single source of truth for driver
// Outstanding is users.wallet_balance: Outstanding = GREATEST(0,
// -wallet_balance), maintained by applyWalletChange() and read by
// settleRevenue() (the function that actually runs on every trip
// completion) to decide is_locked. See the corrected architecture report
// for the full field-by-field data flow, including why
// total_pending_balance / pending_commission_balance / pending_gst_balance
// / lock_threshold exist but are not currently populated by any live trip
// path either.
//
// Left in place, unfixed, pending a decision on this file's out-of-scope
// (Commission Engine) status - not touched further in Phase 2.
export async function applyPendingBalanceDebit(params: {
  driverId: string;
  amount: number;
  gstAmount?: number;
  description?: string;
  tripId?: string | null;
}): Promise<PendingBalanceResult> {
  const { driverId, description, tripId } = params;
  const totalAmt = parseFloat(Number(params.amount || 0).toFixed(2));
  const balR = await rawDb.execute(rawSql`
    SELECT wallet_balance, is_locked
    FROM users WHERE id=${driverId}::uuid LIMIT 1
  `);
  if (!balR.rows.length) throw new Error("Driver not found");
  const bal: any = balR.rows[0] || {};
  const prevWalletBalance = parseFloat(bal.wallet_balance ?? "0") || 0;
  const prevTotal = Math.max(0, -prevWalletBalance);

  const walletChange = await applyWalletChange({
    userId: driverId,
    amount: totalAmt,
    type: "DEBIT",
    reason: "platform_fee_deduction",
    refId: tripId || null,
    metadata: { description: description || "Platform fee deduction" },
  });
  const updated = await rawDb.execute(rawSql`
    UPDATE users
    SET pending_payment_amount = GREATEST(0, ${Math.max(0, -walletChange.newBalance)})
    WHERE id = ${driverId}::uuid
    RETURNING ${walletChange.newBalance}::numeric AS wallet_balance, is_locked
  `);
  const newTotal = Math.max(0, -walletChange.newBalance);

  await rawDb.execute(rawSql`
    INSERT INTO driver_payments (driver_id, amount, payment_type, status, description)
    VALUES (${driverId}::uuid, ${totalAmt}, 'deduction', 'completed', ${description || 'Platform fee deduction'})
  `).catch(() => {});

  await rawDb.execute(rawSql`
    INSERT INTO commission_settlements
      (driver_id, trip_id, settlement_type, commission_amount, gst_amount, total_amount, direction, balance_before, balance_after, description)
    VALUES
      (${driverId}::uuid, ${tripId ? rawSql`${tripId}::uuid` : rawSql`NULL`}, 'commission_debit', 0, 0, ${totalAmt}, 'debit', ${prevTotal}, ${newTotal}, ${description || 'Fee deduction'})
  `).catch(() => {});

  const lockThreshold = await resolveDriverCreditLimit(driverId);
  let isLocked = (updated.rows[0] as any)?.is_locked === true;
  let lockReason: string | undefined;
  if (!isLocked && walletChange.newBalance < -lockThreshold) {
    lockReason = `Wallet balance ₹${walletChange.newBalance.toFixed(2)} is below -₹${lockThreshold}. Recharge to unlock.`;
    await rawDb.execute(rawSql`
      UPDATE users SET is_locked=true, lock_reason=${lockReason}, locked_at=NOW()
      WHERE id=${driverId}::uuid
    `);
    isLocked = true;
  }

  return {
    newWalletBalance: parseFloat((updated.rows[0] as any)?.wallet_balance || 0),
    pendingBalance: newTotal,
    pendingCommission: 0,
    pendingGst: 0,
    isLocked,
    lockReason,
  };
}

export async function applyPendingBalanceCredit(params: {
  driverId: string;
  amount: number;
  method?: string;
  description?: string;
  forceUnlock?: boolean;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  status?: string;
  settlementType?: string;
  createDriverPayment?: boolean;
}): Promise<PendingBalanceResult> {
  const {
    driverId,
    method = "cash",
    description,
    forceUnlock = false,
    razorpayOrderId,
    razorpayPaymentId,
    status = "completed",
    settlementType = "payment_credit",
    createDriverPayment = false,
  } = params;
  const payAmt = parseFloat(Number(params.amount || 0).toFixed(2));

  const balR = await rawDb.execute(rawSql`
    SELECT wallet_balance, is_locked
    FROM users WHERE id=${driverId}::uuid LIMIT 1
  `);
  if (!balR.rows.length) throw new Error("Driver not found");
  const bal: any = balR.rows[0] || {};
  const prevWalletBalance = parseFloat(bal.wallet_balance ?? "0") || 0;
  const prevTotal = Math.max(0, -prevWalletBalance);

  const walletChange = await applyWalletChange({
    userId: driverId,
    amount: payAmt,
    type: "CREDIT",
    reason: settlementType,
    refId: razorpayPaymentId || razorpayOrderId || null,
    metadata: { method, description: description || null },
  });
  const updated = await rawDb.execute(rawSql`
    UPDATE users
    SET pending_payment_amount = GREATEST(0, ${Math.max(0, -walletChange.newBalance)})
    WHERE id = ${driverId}::uuid
    RETURNING ${walletChange.newBalance}::numeric AS wallet_balance, is_locked
  `);
  const newTotal = Math.max(0, -walletChange.newBalance);

  const lockThreshold = await resolveDriverCreditLimit(driverId);
  const wasLocked = (updated.rows[0] as any)?.is_locked === true;
  const autoUnlocked = !!(walletChange.newBalance >= -lockThreshold && wasLocked || forceUnlock);
  if (autoUnlocked) {
    await rawDb.execute(rawSql`UPDATE users SET is_locked=false, lock_reason=NULL, locked_at=NULL WHERE id=${driverId}::uuid`);
  }

  await rawDb.execute(rawSql`
    INSERT INTO commission_settlements
      (driver_id, settlement_type, commission_amount, gst_amount, total_amount,
       direction, balance_before, balance_after, payment_method,
       razorpay_order_id, razorpay_payment_id, status, description)
    VALUES
      (${driverId}::uuid, ${settlementType}, 0, 0, ${payAmt},
       'credit', ${prevTotal}, ${newTotal}, ${method},
       ${razorpayOrderId || null}, ${razorpayPaymentId || null}, ${status}, ${description || 'Settlement credit'})
  `).catch(() => {});

  if (createDriverPayment) {
    await rawDb.execute(rawSql`
      INSERT INTO driver_payments (driver_id, amount, payment_type, status, description)
      VALUES (${driverId}::uuid, ${payAmt}, 'admin_settlement', 'completed', ${description || 'Admin settlement'})
    `).catch(() => {});
  }

  return {
    newWalletBalance: parseFloat((updated.rows[0] as any)?.wallet_balance || 0),
    pendingBalance: newTotal,
    pendingCommission: 0,
    pendingGst: 0,
    isLocked: autoUnlocked ? false : ((updated.rows[0] as any)?.is_locked === true),
    autoUnlocked,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WALLET OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/** Get driver wallet summary */
export async function getDriverWalletSummary(driverId: string) {
  const r = await rawDb.execute(rawSql`
    SELECT wallet_balance, is_locked, lock_reason, locked_at
    FROM users WHERE id=${driverId}::uuid LIMIT 1
  `);
  if (!r.rows.length) return null;
  const w = r.rows[0] as any;
  const walletBalance = parseFloat(w.wallet_balance ?? "0");
  const totalPending = Math.max(0, -walletBalance);
  return {
    walletBalance,
    pendingCommission: 0,
    pendingGst: 0,
    totalPending,
    isLocked: w.is_locked === true,
    lockReason: w.lock_reason || null,
    lockedAt: w.locked_at || null,
  };
}

/** Process driver withdrawal request */
export async function requestWithdrawal(
  driverId: string,
  amount: number,
  method: string = "bank_transfer",
  note?: string,
) {
  const normalizedAmount = Math.round(Number(amount || 0) * 100) / 100;
  if (!(normalizedAmount > 0)) throw new Error("Amount must be greater than 0");

  return rawDb.transaction(async (tx) => {
    const driverRes = await tx.execute(rawSql`
      SELECT id
      FROM users
      WHERE id=${driverId}::uuid
      LIMIT 1
    `);
    if (!driverRes.rows.length) throw new Error("Driver not found");

    const paymentRes = await tx.execute(rawSql`
      INSERT INTO driver_payments (driver_id, amount, payment_type, status, description)
      VALUES (${driverId}::uuid, ${normalizedAmount}, 'withdrawal_request', 'pending',
              ${"Withdrawal request ₹" + normalizedAmount + " via " + method})
      RETURNING id, amount, status, created_at
    `);
    const payment = (paymentRes.rows as any[])[0];
    const paymentId = String(payment?.id || "");

    const walletChange = await applyWalletChange({
      userId: driverId,
      amount: normalizedAmount,
      type: "DEBIT",
      reason: "withdrawal_request",
      refId: paymentId,
      metadata: { method, note: note || null },
      requireSufficientFunds: true,
      tx,
    });

    await tx.execute(rawSql`
      INSERT INTO transactions (user_id, account, credit, debit, balance, transaction_type, ref_transaction_id)
      VALUES (
        ${driverId}::uuid,
        ${"Withdrawal via " + method},
        0,
        ${normalizedAmount},
        ${walletChange.newBalance},
        'withdrawal',
        ${paymentId || null}
      )
      ON CONFLICT (ref_transaction_id, transaction_type) WHERE ref_transaction_id IS NOT NULL DO NOTHING
    `);

    await tx.execute(rawSql`
      INSERT INTO withdraw_requests (user_id, driver_payment_id, amount, note, status, created_at)
      VALUES (${driverId}::uuid, ${paymentId}::uuid, ${normalizedAmount}, ${note || null}, 'pending', NOW())
      ON CONFLICT DO NOTHING
    `);

    return {
      ...payment,
      walletBalance: walletChange.newBalance,
    };
  });
}

/** Admin: approve withdrawal */
export async function approveWithdrawal(paymentId: string) {
  await rawDb.transaction(async (tx) => {
    const result = await tx.execute(rawSql`
      UPDATE driver_payments
      SET status='completed', updated_at=NOW()
      WHERE id=${paymentId}::uuid
        AND payment_type='withdrawal_request'
        AND status='pending'
      RETURNING id
    `);
    if (!result.rows.length) return;

    await tx.execute(rawSql`
      UPDATE withdraw_requests
      SET status='approved'
      WHERE driver_payment_id=${paymentId}::uuid
        AND status='pending'
    `);
  });
}

/** Admin: reject withdrawal (refund to driver wallet) */
export async function rejectWithdrawal(paymentId: string) {
  await rawDb.transaction(async (tx) => {
    const r = await tx.execute(rawSql`
      UPDATE driver_payments
      SET status='rejected', updated_at=NOW()
      WHERE id=${paymentId}::uuid
        AND payment_type='withdrawal_request'
        AND status='pending'
      RETURNING driver_id, amount
    `);
    const row = (r.rows as any[])[0];
    if (!row) return;

    const walletChange = await applyWalletChange({
      userId: String(row.driver_id),
      amount: parseFloat(String(row.amount || 0)),
      type: "CREDIT",
      reason: "withdrawal_rejected_refund",
      refId: paymentId,
      tx,
    });

    await tx.execute(rawSql`
      INSERT INTO transactions (user_id, account, credit, debit, balance, transaction_type, ref_transaction_id)
      VALUES (${row.driver_id}::uuid, 'Withdrawal rejected - refund', ${row.amount}, 0, ${walletChange.newBalance}, 'withdrawal_refund', ${paymentId})
      ON CONFLICT (ref_transaction_id, transaction_type) WHERE ref_transaction_id IS NOT NULL DO NOTHING
    `);

    await tx.execute(rawSql`
      UPDATE withdraw_requests
      SET status='rejected'
      WHERE driver_payment_id=${paymentId}::uuid
        AND status='pending'
    `);
  });
}

/** Get pending withdrawals */
export async function getPendingWithdrawals() {
  const r = await rawDb.execute(rawSql`
    SELECT dp.*, u.full_name as driver_name, u.phone as driver_phone, u.wallet_balance
    FROM driver_payments dp
    LEFT JOIN users u ON u.id = dp.driver_id
    WHERE dp.payment_type = 'withdrawal_request'
      AND dp.status = 'pending'
    ORDER BY dp.created_at DESC
    LIMIT 100
  `);
  return r.rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CUSTOMER WALLET: top-up / deduct / balance
// ═══════════════════════════════════════════════════════════════════════════════

export async function getCustomerWallet(customerId: string) {
  const r = await rawDb.execute(rawSql`
    SELECT wallet_balance FROM users WHERE id=${customerId}::uuid LIMIT 1
  `);
  return parseFloat((r.rows[0] as any)?.wallet_balance ?? "0");
}

export async function topUpCustomerWallet(customerId: string, amount: number, paymentMethod: string, paymentId?: string) {
  if (amount <= 0) throw new Error("Amount must be > 0");
  const walletChange = await applyWalletChange({
    userId: customerId,
    amount,
    type: "CREDIT",
    reason: "customer_wallet_topup",
    refId: paymentId || null,
    metadata: { paymentMethod },
  });
  const newBal = walletChange.newBalance;

  await rawDb.execute(rawSql`
    INSERT INTO transactions (user_id, account, credit, debit, balance, transaction_type, ref_transaction_id)
    VALUES (${customerId}::uuid, ${"Wallet top-up via " + paymentMethod}, ${amount}, 0, ${newBal}, 'wallet_topup', ${paymentId || null})
  `).catch(() => {});

  if (paymentId) {
    await rawDb.execute(rawSql`
      INSERT INTO customer_payments (customer_id, amount, payment_type, razorpay_payment_id, status)
      VALUES (${customerId}::uuid, ${amount}, 'wallet_topup', ${paymentId}, 'completed')
    `).catch(() => {});
  }

  return newBal;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ADMIN: Revenue analytics per service
// ═══════════════════════════════════════════════════════════════════════════════

export async function getRevenueAnalytics(days: number = 7) {
  const r = await rawDb.execute(rawSql`
    SELECT
      revenue_type,
      COUNT(*)::int as total_trips,
      COALESCE(SUM(amount), 0)::numeric(12,2) as total_revenue,
      COALESCE(AVG(amount), 0)::numeric(12,2) as avg_revenue_per_trip,
      COALESCE(SUM((breakdown->>'commission')::numeric), 0)::numeric(12,2) as total_commission,
      COALESCE(SUM((breakdown->>'gst')::numeric), 0)::numeric(12,2) as total_gst,
      COALESCE(SUM((breakdown->>'insurance')::numeric), 0)::numeric(12,2) as total_insurance,
      COALESCE(SUM((breakdown->>'platformFee')::numeric), 0)::numeric(12,2) as total_platform_fee
    FROM admin_revenue
    WHERE created_at > NOW() - (${days} || ' days')::interval
    GROUP BY revenue_type
    ORDER BY total_revenue DESC
  `);
  return r.rows;
}

export async function getRevenueByService(days: number = 7) {
  const r = await rawDb.execute(rawSql`
    SELECT
      cs.service_type,
      COUNT(*)::int as total_settlements,
      COALESCE(SUM(cs.commission_amount), 0)::numeric(12,2) as commission_collected,
      COALESCE(SUM(cs.gst_amount), 0)::numeric(12,2) as gst_collected,
      COALESCE(SUM(cs.total_amount), 0)::numeric(12,2) as total_collected
    FROM commission_settlements cs
    WHERE cs.created_at > NOW() - (${days} || ' days')::interval
      AND cs.direction = 'debit'
    GROUP BY cs.service_type
    ORDER BY total_collected DESC
  `);
  return r.rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INIT: Ensure revenue tables have required columns
// ═══════════════════════════════════════════════════════════════════════════════

export async function initRevenueEngineTables() {
  // Add city_pool_model to revenue_model_settings if missing
  const newSettings: Record<string, string> = {
    city_pool_model:        "commission",
    city_pool_commission:   "10",
    outstation_pool_commission: "15",
    b2b_parcel_model:       "commission",
    insurance_optional:     "true",
  };
  for (const [key, value] of Object.entries(newSettings)) {
    await rawDb.execute(rawSql`
      INSERT INTO revenue_model_settings (key_name, value)
      VALUES (${key}, ${value})
      ON CONFLICT (key_name) DO NOTHING
    `).catch(() => {});
  }

  await assertSchemaObjectsOrThrow({
    tables: ["outstation_pool_bookings", "parcel_orders", "driver_payments", "ledger_entries"],
    columns: [
      {
        table: "outstation_pool_bookings",
        columns: ["commission_amount", "gst_amount", "insurance_amount", "driver_earnings", "revenue_model", "revenue_breakdown"],
      },
      {
        table: "parcel_orders",
        columns: ["gst_amount", "insurance_amount", "driver_earnings", "revenue_model", "revenue_breakdown", "payment_status"],
      },
      {
        table: "driver_payments",
        columns: ["updated_at", "description"],
      },
      {
        table: "ledger_entries",
        columns: ["user_id", "trip_id", "type", "amount", "status", "description", "created_at"],
      },
    ],
    indexes: [{ table: "ledger_entries", pattern: "%trip_id%", description: "ledger_entries trip_id index" }],
    foreignKeys: [{ table: "ledger_entries", column: "user_id", references: "users" }],
  });

  console.log("[revenue-engine] Tables and settings initialized");
}

// ─────────────────────────────────────────────────────────────────────────────
// C6: Atomic trip completion — single DB transaction for state + all money
// ─────────────────────────────────────────────────────────────────────────────

export type CompleteTripParams = {
  tripId: string;
  driverId: string;
  fare: number;
  actualDistance: number;
  tipsVal: number;
  rideFullFare: number;
  userDiscount: number;
  userPayable: number;
  gstAmount: number;
  deductAmount: number;
  driverWalletCredit: number;
  commissionOwed: number;
  vehicleTypeName: string | null;
  seatsBooked: number;
  seatPrice: number;
  tripPaymentMethod: string;
  tripCustomerId: string | null;
  serviceCategory: string;
  serviceLabel: string;
  revenueModel: string;
};

export type CompleteTripResult = {
  alreadyCompleted: boolean;
  tripId: string;
  customerId: string | null;
  currentStatus: string;
  walletPaidAmount: number;
  walletPendingAmount: number;
  newDriverBalance: number;
  isLocked: boolean;
};

export async function completeTripAtomic(params: CompleteTripParams): Promise<CompleteTripResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Lock the trip row — prevents double-complete under concurrency
    const tripRes = await client.query(
      `SELECT id, current_status, payment_status, customer_id
       FROM trip_requests WHERE id=$1::uuid AND driver_id=$2::uuid
       FOR UPDATE`,
      [params.tripId, params.driverId]
    );
    if (!tripRes.rows.length) {
      await client.query("ROLLBACK");
      throw { status: 404, code: "TRIP_NOT_FOUND", message: "Trip not found" };
    }
    const trip = tripRes.rows[0];

    // Idempotency guard — safe retry
    if (trip.current_status === "completed") {
      await client.query("ROLLBACK");
      return {
        alreadyCompleted: true,
        tripId: String(trip.id),
        customerId: trip.customer_id ? String(trip.customer_id) : null,
        currentStatus: String(trip.current_status),
        walletPaidAmount: 0,
        walletPendingAmount: 0,
        newDriverBalance: 0,
        isLocked: false,
      };
    }
    if (trip.current_status !== "on_the_way") {
      await client.query("ROLLBACK");
      throw { status: 409, code: "INVALID_STATE", message: `Cannot complete trip in status: ${trip.current_status}` };
    }

    // 2) Customer wallet deduction (inline — no nested transaction)
    let walletPaidAmount = 0;
    let walletPendingAmount = 0;
    let paymentStatus = "paid";

    if (params.tripPaymentMethod === "wallet" && params.tripCustomerId) {
      // Atomic full deduction: WHERE balance >= amount prevents overdraft
      const fullRes = await client.query(
        `UPDATE users SET wallet_balance = wallet_balance - $1, updated_at = NOW()
         WHERE id=$2::uuid AND wallet_balance >= $1
         RETURNING wallet_balance`,
        [params.userPayable, params.tripCustomerId]
      );
      if (fullRes.rows.length) {
        walletPaidAmount = params.userPayable;
        const newBal = parseFloat(fullRes.rows[0].wallet_balance || "0");
        await client.query(
          `INSERT INTO wallet_events (user_id, amount, type, reason, ref_id, metadata)
           VALUES ($1::uuid, $2, 'DEBIT', 'ride_wallet_payment', $3, '{}')`,
          [params.tripCustomerId, params.userPayable, params.tripId]
        );
        await client.query(
          `INSERT INTO transactions (user_id, account, credit, debit, balance, transaction_type, ref_transaction_id)
           VALUES ($1::uuid, 'Ride payment via Wallet', 0, $2, $3, 'ride_payment', $4)`,
          [params.tripCustomerId, params.userPayable, newBal, params.tripId]
        );
      } else {
        // Insufficient funds — attempt partial using locked balance
        const balRes = await client.query(
          "SELECT wallet_balance FROM users WHERE id=$1::uuid FOR UPDATE",
          [params.tripCustomerId]
        );
        const custBal = parseFloat(balRes.rows[0]?.wallet_balance || "0");
        if (custBal > 0) {
          const deducted = parseFloat(custBal.toFixed(2));
          const partialRes = await client.query(
            `UPDATE users SET wallet_balance = wallet_balance - $1, updated_at = NOW()
             WHERE id=$2::uuid AND wallet_balance >= $1
             RETURNING wallet_balance`,
            [deducted, params.tripCustomerId]
          );
          if (partialRes.rows.length) {
            const remaining = parseFloat((params.userPayable - deducted).toFixed(2));
            walletPaidAmount = deducted;
            walletPendingAmount = remaining;
            paymentStatus = "partial_payment";
            const newBal2 = parseFloat(partialRes.rows[0].wallet_balance || "0");
            await client.query(
              `INSERT INTO wallet_events (user_id, amount, type, reason, ref_id, metadata)
               VALUES ($1::uuid, $2, 'DEBIT', 'ride_wallet_partial_payment', $3, '{}')`,
              [params.tripCustomerId, deducted, params.tripId]
            );
            await client.query(
              `INSERT INTO transactions (user_id, account, credit, debit, balance, transaction_type, ref_transaction_id)
               VALUES ($1::uuid, 'Partial ride payment via Wallet', 0, $2, $3, 'ride_payment', $4)`,
              [params.tripCustomerId, deducted, newBal2, params.tripId]
            );
          } else {
            walletPendingAmount = params.userPayable;
            paymentStatus = "pending_payment";
          }
        } else {
          walletPendingAmount = params.userPayable;
          paymentStatus = "pending_payment";
        }
      }
    }

    // 3) Driver wallet settlement (inline)
    let newDriverBalance = 0;
    let isLocked = false;
    if (params.deductAmount > 0) {
      const isOnline = ["online", "wallet", "upi", "razorpay", "card", "prepaid"].includes(params.tripPaymentMethod);
      if (isOnline) {
        const driverRes = await client.query(
          `UPDATE users SET wallet_balance = wallet_balance + $1, updated_at = NOW()
           WHERE id=$2::uuid RETURNING wallet_balance, is_locked`,
          [params.driverWalletCredit, params.driverId]
        );
        newDriverBalance = parseFloat(driverRes.rows[0]?.wallet_balance || "0");
        isLocked = driverRes.rows[0]?.is_locked === true;
        await client.query(
          `INSERT INTO wallet_events (user_id, amount, type, reason, ref_id, metadata)
           VALUES ($1::uuid, $2, 'CREDIT', 'trip_settlement_credit', $3, $4::jsonb)`,
          [params.driverId, params.driverWalletCredit, params.tripId, JSON.stringify({ serviceCategory: params.serviceCategory })]
        );
      } else {
        // Cash ride: deduct platform dues from driver wallet
        const driverRes = await client.query(
          `UPDATE users SET wallet_balance = wallet_balance - $1, updated_at = NOW()
           WHERE id=$2::uuid RETURNING wallet_balance, is_locked`,
          [params.deductAmount, params.driverId]
        );
        newDriverBalance = parseFloat(driverRes.rows[0]?.wallet_balance || "0");
        isLocked = driverRes.rows[0]?.is_locked === true;
        await client.query(
          `INSERT INTO wallet_events (user_id, amount, type, reason, ref_id, metadata)
           VALUES ($1::uuid, $2, 'DEBIT', 'cash_ride_dues', $3, $4::jsonb)`,
          [params.driverId, params.deductAmount, params.tripId, JSON.stringify({ serviceCategory: params.serviceCategory })]
        );
      }
      // Commission settlement audit row
      if (params.commissionOwed > 0) {
        await client.query(
          `INSERT INTO commission_settlements
             (driver_id, trip_id, settlement_type, commission_amount, gst_amount,
              total_amount, direction, ride_fare, service_type, description)
           VALUES ($1::uuid, $2::uuid, 'commission_debit', $3, $4, $5, 'debit', $6, $7, $8)`,
          [params.driverId, params.tripId, params.commissionOwed, params.gstAmount,
           params.deductAmount, params.fare, params.serviceLabel,
           `Commission (${params.revenueModel}) for ${params.serviceLabel} ${params.tripId.slice(0, 8)}`]
        ).catch(() => {});
      }
    }

    // 4) Ledger entries — double-entry audit trail (one debit + one credit per trip)
    if (!params.tripCustomerId) {
      throw new Error("LEDGER_INVARIANT_VIOLATION");
    }
    await client.query(
      `INSERT INTO ledger_entries (user_id, trip_id, type, amount, status, description)
       VALUES ($1::uuid, $2::uuid, 'DEBIT', $3, $4, 'Ride fare')`,
      [params.tripCustomerId, params.tripId, params.userPayable,
       walletPaidAmount > 0 ? "SUCCESS" : "PENDING"]
    );
    await client.query(
      `INSERT INTO ledger_entries (user_id, trip_id, type, amount, status, description)
       VALUES ($1::uuid, $2::uuid, 'CREDIT', $3, 'SUCCESS', 'Driver earnings')`,
      [params.driverId, params.tripId, params.driverWalletCredit]
    );
    const ledgerInvariant = await client.query(
      `SELECT
          COALESCE(SUM(CASE WHEN type='DEBIT' THEN 1 ELSE 0 END), 0)::int AS debits,
          COALESCE(SUM(CASE WHEN type='CREDIT' THEN 1 ELSE 0 END), 0)::int AS credits
       FROM ledger_entries
       WHERE trip_id = $1::uuid`,
      [params.tripId]
    );
    const debits = Number(ledgerInvariant.rows[0]?.debits || 0);
    const credits = Number(ledgerInvariant.rows[0]?.credits || 0);
    if (debits !== 1 || credits !== 1) {
      throw new Error("LEDGER_INVARIANT_VIOLATION");
    }

    // 5) Finalize trip status — last write in the transaction
    const preservedStatuses = new Set(["paid_online", "wallet_paid", "partial_payment"]);
    const finalPaymentStatus = preservedStatuses.has(trip.payment_status)
      ? trip.payment_status
      : (walletPendingAmount > 0 ? paymentStatus : "paid");

    await client.query(
      `UPDATE trip_requests
       SET current_status        = 'completed',
           ride_ended_at         = NOW(),
           actual_fare           = $1,
           actual_distance       = $2,
           tips                  = $3,
           payment_status        = $4,
           pending_payment_amount= $5,
           ride_full_fare        = $6,
           user_discount         = $7,
           user_payable          = $8,
           gst_amount            = $9,
           commission_amount     = $10,
           driver_wallet_credit  = $11,
           driver_fare           = $11,
           customer_fare         = $8,
           vehicle_type_name     = $12,
           seats_booked          = $13,
           seat_price            = $14
       WHERE id = $15::uuid`,
      [params.fare, params.actualDistance, params.tipsVal,
       finalPaymentStatus, walletPendingAmount,
       params.rideFullFare, params.userDiscount, params.userPayable, params.gstAmount,
       params.deductAmount, params.driverWalletCredit,
       params.vehicleTypeName, params.seatsBooked, params.seatPrice,
       params.tripId]
    );

    // 6) Free driver for next trip
    await client.query(
      "UPDATE users SET current_trip_id = NULL WHERE id = $1::uuid",
      [params.driverId]
    );

    await client.query(
      `INSERT INTO outbox_events (id, type, payload)
       VALUES (gen_random_uuid(), 'TRIP_COMPLETED', $1::jsonb)`,
      [JSON.stringify({
        tripId: params.tripId,
        customerId: params.tripCustomerId,
        currentStatus: "completed",
        fare: params.rideFullFare,
        actualFare: params.userPayable,
        userDiscount: params.userDiscount,
        userPayable: params.userPayable,
        gstAmount: params.gstAmount,
        driverWalletCredit: params.driverWalletCredit,
        actualDistance: params.actualDistance,
        paymentMethod: params.tripPaymentMethod,
        platformDeduction: params.deductAmount,
        launchOfferApplied: params.userDiscount > 0,
        walletPaidAmount,
        walletPendingAmount,
        requiresCashPayment: walletPendingAmount > 0,
        uiState: "trip_completed",
      })]
    );

    await client.query("COMMIT");
    return {
      alreadyCompleted: false,
      tripId: params.tripId,
      customerId: params.tripCustomerId,
      currentStatus: "completed",
      walletPaidAmount,
      walletPendingAmount,
      newDriverBalance,
      isLocked,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

