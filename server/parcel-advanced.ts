/**
 * Advanced Parcel Delivery System — Production-Grade (Porter-Level)
 *
 * Features:
 * 1. Parcel dimensions & volumetric weight (L×W×H / 5000)
 * 2. Vehicle-based dispatch filtering (vehicle_type match)
 * 3. Receiver notifications (SMS + FCM + tracking link)
 * 4. Proof of delivery (photo upload + digital signature)
 * 5. B2B CSV bulk upload with validation
 * 6. B2B webhook callbacks (order lifecycle events)
 * 7. Declared value & insurance pricing
 * 8. Prohibited items validation (admin-managed blocklist)
 * 9. SLA tracking (expected vs actual delivery time)
 * 10. Parcel-specific socket events
 */

import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { assertSchemaObjectsOrThrow } from "./schema-health";
import { notifyUser } from "./notification-service";
// Removed legacy SMS notification logic. Only FCM and socket notifications are supported.
import { io } from "./socket";
import { activeDriverEligibilitySql } from "./driver-state";
import { uuidArraySql } from "./vehicle-matching";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ParcelDimensions {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
}

export interface InsuranceQuote {
  declaredValue: number;
  premiumRate: number;
  premiumAmount: number;
  coverageMax: number;
  isFragile: boolean;
}

export interface ParcelSLA {
  orderId: string;
  expectedDeliveryMinutes: number;
  actualDeliveryMinutes: number | null;
  delayMinutes: number;
  slaBreached: boolean;
}

export interface B2BWebhookEvent {
  eventType: "order_created" | "driver_assigned" | "parcel_picked" | "parcel_delivered" | "order_cancelled";
  orderId: string;
  companyId: string;
  timestamp: string;
  data: Record<string, any>;
}

// ── Volumetric Weight Calculation ────────────────────────────────────────────

const VOLUMETRIC_DIVISOR = 5000; // Industry standard: L×W×H / 5000

export function calculateBillableWeight(dims: ParcelDimensions): {
  actualWeightKg: number;
  volumetricWeightKg: number;
  billableWeightKg: number;
  method: "actual" | "volumetric";
} {
  const actualKg = Math.max(0.1, dims.weightKg || 0.1);
  const volumetricKg =
    ((dims.lengthCm || 0) * (dims.widthCm || 0) * (dims.heightCm || 0)) /
    VOLUMETRIC_DIVISOR;
  const billable = Math.max(actualKg, volumetricKg);
  return {
    actualWeightKg: Math.round(actualKg * 100) / 100,
    volumetricWeightKg: Math.round(volumetricKg * 100) / 100,
    billableWeightKg: Math.round(billable * 100) / 100,
    method: volumetricKg > actualKg ? "volumetric" : "actual",
  };
}

// ── Insurance & Declared Value ───────────────────────────────────────────────

const DEFAULT_INSURANCE_RATES = {
  standard: { rate: 0.02, maxCoverage: 50000 },   // 2% premium, max ₹50,000
  fragile:  { rate: 0.035, maxCoverage: 25000 },   // 3.5% premium, max ₹25,000
};

export async function calculateInsurance(
  declaredValue: number,
  isFragile: boolean
): Promise<InsuranceQuote> {
  // Try to load admin-configured rates
  let rates = isFragile ? DEFAULT_INSURANCE_RATES.fragile : DEFAULT_INSURANCE_RATES.standard;
  try {
    const r = await rawDb.execute(rawSql`
      SELECT value FROM business_settings
      WHERE key_name = ${isFragile ? "parcel_insurance_fragile_rate" : "parcel_insurance_standard_rate"}
      LIMIT 1
    `);
    if (r.rows.length) {
      const parsed = JSON.parse((r.rows[0] as any).value);
      if (parsed.rate) rates = parsed;
    }
  } catch {}

  const capped = Math.min(declaredValue, rates.maxCoverage);
  const premium = Math.ceil(capped * rates.rate);

  return {
    declaredValue: capped,
    premiumRate: rates.rate,
    premiumAmount: premium,
    coverageMax: rates.maxCoverage,
    isFragile,
  };
}

// ── Prohibited Items Validation ──────────────────────────────────────────────

const DEFAULT_PROHIBITED = [
  "explosives", "ammunition", "firearms", "weapons", "narcotics", "drugs",
  "flammable liquids", "corrosive chemicals", "radioactive materials",
  "live animals", "human remains", "currency notes", "counterfeit goods",
  "hazardous waste", "compressed gas", "poison", "biohazard",
];

export async function validateProhibitedItems(
  description: string
): Promise<{ allowed: boolean; matchedItems: string[] }> {
  const desc = (description || "").toLowerCase();
  if (!desc) return { allowed: true, matchedItems: [] };

  // Load admin-managed blocklist
  let blocklist = DEFAULT_PROHIBITED;
  try {
    const r = await rawDb.execute(rawSql`
      SELECT item_name FROM parcel_prohibited_items WHERE is_active = true
    `);
    if (r.rows.length) {
      blocklist = r.rows.map((row: any) => (row.item_name || "").toLowerCase());
    }
  } catch {}

  const matched = blocklist.filter((item) => desc.includes(item));
  return { allowed: matched.length === 0, matchedItems: matched };
}

// ── SLA Tracking ─────────────────────────────────────────────────────────────

// Estimated delivery minutes based on distance + vehicle type
const SLA_ESTIMATES: Record<string, { baseMinutes: number; perKmMinutes: number }> = {
  bike_parcel:   { baseMinutes: 15, perKmMinutes: 3 },
  tata_ace:      { baseMinutes: 30, perKmMinutes: 4 },
  pickup_truck:  { baseMinutes: 45, perKmMinutes: 5 },
  auto_parcel:   { baseMinutes: 20, perKmMinutes: 3.5 },
  bolero_cargo:  { baseMinutes: 45, perKmMinutes: 5 },
  tempo_407:     { baseMinutes: 55, perKmMinutes: 6 },
};

export function calculateExpectedDeliveryMinutes(
  vehicleCategory: string,
  distanceKm: number
): number {
  const est = SLA_ESTIMATES[vehicleCategory] || SLA_ESTIMATES.bike_parcel;
  return Math.ceil(est.baseMinutes + distanceKm * est.perKmMinutes);
}

export async function getParcelSLA(orderId: string): Promise<ParcelSLA | null> {
  try {
    const r = await rawDb.execute(rawSql`
      SELECT id, vehicle_category, total_distance_km, current_status,
             created_at, updated_at
      FROM parcel_orders WHERE id = ${orderId}::uuid
    `);
    if (!r.rows.length) return null;
    const o = r.rows[0] as any;
    const expectedMin = calculateExpectedDeliveryMinutes(
      o.vehicle_category || "bike_parcel",
      parseFloat(o.total_distance_km) || 5
    );
    const createdAt = new Date(o.created_at).getTime();
    const now = Date.now();
    const completedAt =
      o.current_status === "completed"
        ? new Date(o.updated_at).getTime()
        : now;
    const actualMin = Math.round((completedAt - createdAt) / 60000);
    const delay = Math.max(0, actualMin - expectedMin);

    return {
      orderId,
      expectedDeliveryMinutes: expectedMin,
      actualDeliveryMinutes:
        o.current_status === "completed" ? actualMin : null,
      delayMinutes: delay,
      slaBreached: delay > 15, // 15-min grace period
    };
  } catch {
    return null;
  }
}

// ── Receiver Notifications ───────────────────────────────────────────────────

export async function notifyReceiver(opts: {
  receiverPhone: string;
  receiverName: string;
  eventType: "pickup_started" | "arriving" | "otp_share" | "delivered";
  orderId: string;
  otp?: string;
  driverName?: string;
  trackingUrl?: string;
}): Promise<void> {
  const { receiverPhone, receiverName, eventType, orderId, otp, driverName, trackingUrl } = opts;
  if (!receiverPhone) return;

  const messages: Record<string, string> = {
    pickup_started: `Hi ${receiverName}, your parcel has been picked up by ${driverName || "the driver"}. Track: ${trackingUrl || "JAGO Pro"}`,
    arriving: `Hi ${receiverName}, your parcel is arriving soon! Driver: ${driverName || "JAGO Pro Pilot"}. Keep OTP ready.`,
    otp_share: `Hi ${receiverName}, your JAGO Pro parcel delivery OTP is ${otp}. Share with the driver to confirm delivery.`,
    delivered: `Hi ${receiverName}, your parcel has been delivered successfully! Order: ${orderId.slice(0, 8).toUpperCase()}`,
  };

  const smsBody = messages[eventType];
  if (!smsBody) return;
  // SMS notification removed. Only FCM and socket notifications are supported.

  // FCM push if receiver is a registered user
  try {
    const userR = await rawDb.execute(rawSql`
      SELECT u.id as user_id, ud.fcm_token
      FROM users u
      JOIN user_devices ud ON ud.user_id = u.id
      WHERE u.phone = ${receiverPhone}
        AND ud.fcm_token IS NOT NULL
      LIMIT 1
    `);
    const targetUserId = (userR.rows[0] as any)?.user_id;
    if (targetUserId) {
      await notifyUser(String(targetUserId), "parcel:update", {
        type: "parcel_update",
        orderId,
        eventType,
        message: smsBody,
      }, {
        title: eventType === "delivered" ? "Parcel Delivered!" : "Parcel Update",
        body: smsBody,
        channelId: "parcel_updates",
      });
    }
  } catch {}
}

// Send receiver notifications for all drops (when parcel picked up)
export async function notifyAllReceivers(
  orderId: string,
  dropLocations: any[],
  eventType: "pickup_started" | "arriving" | "delivered",
  driverName?: string
): Promise<void> {
  for (const drop of dropLocations) {
    if (drop.receiverPhone) {
      await notifyReceiver({
        receiverPhone: drop.receiverPhone,
        receiverName: drop.receiverName || "Customer",
        eventType,
        orderId,
        otp: eventType === "arriving" ? drop.deliveryOtp : undefined,
        driverName,
        trackingUrl: `https://jago.app/track/parcel/${orderId}`,
      });
    }
  }
}

// ── B2B Webhook Callbacks ────────────────────────────────────────────────────

export async function fireB2BWebhook(event: B2BWebhookEvent): Promise<void> {
  try {
    // Get the company's webhook URL
    const r = await rawDb.execute(rawSql`
      SELECT webhook_url, webhook_secret FROM b2b_companies
      WHERE id = ${event.companyId}::uuid AND webhook_url IS NOT NULL
    `);
    if (!r.rows.length) return;
    const company = r.rows[0] as any;
    if (!company.webhook_url) return;

    // Log the webhook attempt
    await rawDb.execute(rawSql`
      INSERT INTO b2b_webhook_logs (company_id, event_type, order_id, payload, status)
      VALUES (${event.companyId}::uuid, ${event.eventType}, ${event.orderId}::uuid,
              ${JSON.stringify(event)}, 'pending')
    `).catch(() => {});

    // Fire webhook (with timeout)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const hmacBody = JSON.stringify(event);
    const signature = company.webhook_secret
      ? await computeHmac(hmacBody, company.webhook_secret)
      : "";

    const response = await fetch(company.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-JAGO-Signature": signature,
        "X-JAGO-Event": event.eventType,
      },
      body: hmacBody,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // Update webhook log
    await rawDb.execute(rawSql`
      UPDATE b2b_webhook_logs
      SET status = ${response.ok ? "delivered" : "failed"},
          response_code = ${response.status},
          delivered_at = NOW()
      WHERE company_id = ${event.companyId}::uuid
        AND order_id = ${event.orderId}::uuid
        AND event_type = ${event.eventType}
        AND status = 'pending'
    `).catch(() => {});
  } catch (err: any) {
    console.error(`[B2B-WEBHOOK] Failed for ${event.eventType}:`, err.message);
  }
}

async function computeHmac(body: string, secret: string): Promise<string> {
  const crypto = await import("crypto");
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

// ── B2B CSV Bulk Upload Parser ───────────────────────────────────────────────

export interface CSVParcelRow {
  receiverName: string;
  receiverPhone: string;
  dropAddress: string;
  dropLat?: number;
  dropLng?: number;
  weightKg?: number;
  description?: string;
  declaredValue?: number;
}

export function parseParcelCSV(csvContent: string): {
  rows: CSVParcelRow[];
  errors: string[];
} {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) return { rows: [], errors: ["CSV must have a header row and at least one data row"] };

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, ""));
  const required = ["receivername", "receiverphone", "dropaddress"];
  const missing = required.filter(
    (r) => !headers.some((h) => h.includes(r.replace("_", "")))
  );
  if (missing.length) {
    return { rows: [], errors: [`Missing required columns: ${missing.join(", ")}. Required: receiverName, receiverPhone, dropAddress`] };
  }

  const nameIdx = headers.findIndex((h) => h.includes("receivername") || h.includes("name"));
  const phoneIdx = headers.findIndex((h) => h.includes("receiverphone") || h.includes("phone"));
  const addrIdx = headers.findIndex((h) => h.includes("dropaddress") || h.includes("address"));
  const latIdx = headers.findIndex((h) => h.includes("droplat") || h === "lat" || h === "latitude");
  const lngIdx = headers.findIndex((h) => h.includes("droplng") || h === "lng" || h === "longitude");
  const weightIdx = headers.findIndex((h) => h.includes("weight"));
  const descIdx = headers.findIndex((h) => h.includes("description") || h.includes("desc"));
  const valueIdx = headers.findIndex((h) => h.includes("declaredvalue") || h.includes("value"));

  const rows: CSVParcelRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.every((c) => !c)) continue; // skip empty rows

    const name = cols[nameIdx] || "";
    const phone = cols[phoneIdx] || "";
    const addr = cols[addrIdx] || "";

    if (!name || !phone || !addr) {
      errors.push(`Row ${i + 1}: Missing required fields (receiverName, receiverPhone, dropAddress)`);
      continue;
    }

    // Basic phone validation
    const cleanPhone = phone.replace(/[^0-9+]/g, "");
    if (cleanPhone.length < 10) {
      errors.push(`Row ${i + 1}: Invalid phone number "${phone}"`);
      continue;
    }

    rows.push({
      receiverName: name,
      receiverPhone: cleanPhone,
      dropAddress: addr,
      dropLat: latIdx >= 0 ? parseFloat(cols[latIdx]) || undefined : undefined,
      dropLng: lngIdx >= 0 ? parseFloat(cols[lngIdx]) || undefined : undefined,
      weightKg: weightIdx >= 0 ? parseFloat(cols[weightIdx]) || undefined : undefined,
      description: descIdx >= 0 ? cols[descIdx] : undefined,
      declaredValue: valueIdx >= 0 ? parseFloat(cols[valueIdx]) || undefined : undefined,
    });
  }

  return { rows, errors };
}

// ── Proof of Delivery ────────────────────────────────────────────────────────

export async function saveProofOfDelivery(opts: {
  orderId: string;
  dropIndex: number;
  photoUrl?: string;
  signatureUrl?: string;
  deliveredTo?: string;
  driverId: string;
}): Promise<void> {
  const { orderId, dropIndex, photoUrl, signatureUrl, deliveredTo, driverId } = opts;

  await rawDb.execute(rawSql`
    INSERT INTO parcel_delivery_proofs
      (order_id, drop_index, photo_url, signature_url, delivered_to, driver_id)
    VALUES
      (${orderId}::uuid, ${dropIndex}, ${photoUrl || null}, ${signatureUrl || null},
       ${deliveredTo || null}, ${driverId}::uuid)
    ON CONFLICT (order_id, drop_index) DO UPDATE SET
      photo_url = COALESCE(EXCLUDED.photo_url, parcel_delivery_proofs.photo_url),
      signature_url = COALESCE(EXCLUDED.signature_url, parcel_delivery_proofs.signature_url),
      delivered_to = COALESCE(EXCLUDED.delivered_to, parcel_delivery_proofs.delivered_to),
      updated_at = NOW()
  `);
}

export async function getProofOfDelivery(
  orderId: string,
  dropIndex?: number
): Promise<any[]> {
  const filter = dropIndex !== undefined
    ? rawSql`AND drop_index = ${dropIndex}`
    : rawSql``;
  const r = await rawDb.execute(rawSql`
    SELECT * FROM parcel_delivery_proofs
    WHERE order_id = ${orderId}::uuid ${filter}
    ORDER BY drop_index ASC
  `);
  return r.rows as any[];
}

// ── Parcel Socket Events ─────────────────────────────────────────────────────

export function emitParcelEvent(
  eventName: string,
  customerId: string,
  driverId: string | null,
  payload: Record<string, any>
): void {
  if (!io) return;
  io.to(`user:${customerId}`).emit(eventName, payload);
  if (driverId) {
    io.to(`user:${driverId}`).emit(eventName, payload);
  }
}

// Emit parcel lifecycle events to customer + driver
export function emitParcelLifecycle(
  orderId: string,
  customerId: string,
  driverId: string | null,
  event: "new_order" | "driver_assigned" | "pickup_started" | "in_transit" | "delivery_approaching" | "delivered" | "completed" | "cancelled",
  extra?: Record<string, any>
): void {
  const payload = { orderId, event, timestamp: new Date().toISOString(), ...extra };
  emitParcelEvent(`parcel:${event}`, customerId, driverId, payload);
}

// ── Vehicle Type Matching for Dispatch (Porter-grade strict) ─────────────────

/**
 * Strict 1:1 mapping from parcel vehicle_key (sent by app) to canonical
 * driver vehicle_categories.name / slug. NO fuzzy fallback — a parcel key
 * with no mapping is rejected outright.
 */
const PARCEL_VEHICLE_DRIVER_MAP: Record<string, string[]> = {
  bike_parcel:   ["bike_parcel", "bike parcel", "parcel_bike", "bike_delivery", "bike delivery"],
  auto_parcel:   ["auto_parcel", "auto parcel", "parcel_auto", "auto_delivery", "auto delivery", "mini_cargo_auto"],
  tata_ace:      ["tata_ace", "tata ace"],
  pickup_truck:  ["pickup_truck", "pickup truck"],
  bolero_cargo:  ["bolero_cargo", "bolero pickup", "bolero cargo"],
  tempo_407:     ["tempo_407", "tempo 407", "tata 407 / tempo"],
};

// 60s in-memory cache for parcel_key → vehicle_category_id[] resolution.
// Saves one DB round-trip per dispatch call on hot paths.
const VC_ID_CACHE = new Map<string, { ids: string[]; expiresAt: number }>();
const VC_CACHE_TTL_MS = 60_000;

async function resolveAllowedCategoryIds(parcelKey: string): Promise<string[]> {
  const cached = VC_ID_CACHE.get(parcelKey);
  if (cached && cached.expiresAt > Date.now()) return cached.ids;

  const allowedNames = PARCEL_VEHICLE_DRIVER_MAP[parcelKey];
  if (!allowedNames || !allowedNames.length) return [];

  const lowered = allowedNames.map((t) => t.toLowerCase());
  const ilikePatterns = allowedNames.map((t) => `%${t.replace(/_/g, "%")}%`);
  const r = await rawDb.execute(rawSql`
    SELECT id FROM vehicle_categories
    WHERE REGEXP_REPLACE(LOWER(name), '[^a-z0-9]+', '_', 'g') = ANY(${lowered})
       OR REGEXP_REPLACE(LOWER(COALESCE(vehicle_type, '')), '[^a-z0-9]+', '_', 'g') = ANY(${lowered})
       OR LOWER(COALESCE(vehicle_type, '')) = ${parcelKey.toLowerCase()}
       OR LOWER(name) LIKE ANY(${ilikePatterns})
       OR LOWER(COALESCE(vehicle_type, '')) LIKE ANY(${ilikePatterns})
  `).catch(() => ({ rows: [] as any[] }));

  const ids = (r.rows as any[]).map((row) => String(row.id));
  VC_ID_CACHE.set(parcelKey, { ids, expiresAt: Date.now() + VC_CACHE_TTL_MS });
  return ids;
}

export interface ParcelMatchResult {
  drivers: any[];
  excludedSummary: Record<string, number>;
  rejected: boolean; // true when parcelKey has no mapping at all
}

/**
 * Find parcel-capable drivers using strict Porter-grade filters.
 * All filters are ANDed. No silent fallback.
 *
 * Eligibility (driver must satisfy EVERY condition):
 *   - vehicle_category_id matches parcel key mapping
 *   - verification_status = 'approved' (strict — no pending/verified)
 *   - is_online = true on driver_locations
 *   - current_trip_id IS NULL
 *   - lat/lng != 0
 *   - is_active = true, is_locked = false
 *   - location_updated_at within last 30 seconds (fresh GPS)
 */
export async function findParcelCapableDrivers(
  pickupLat: number,
  pickupLng: number,
  radiusKm: number,
  vehicleCategory: string,
  excludeDriverIds: string[],
  limit: number = 10
): Promise<any[]> {
  const result = await findParcelCapableDriversDetailed(
    pickupLat, pickupLng, radiusKm, vehicleCategory, excludeDriverIds, limit
  );
  return result.drivers;
}

/**
 * Like findParcelCapableDrivers but also returns a breakdown of exclusion
 * reasons — used by dispatch logs and diagnostics.
 */
export async function findParcelCapableDriversDetailed(
  pickupLat: number,
  pickupLng: number,
  radiusKm: number,
  vehicleCategory: string,
  excludeDriverIds: string[],
  limit: number = 10
): Promise<ParcelMatchResult> {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const safeExclude = excludeDriverIds.filter((id) => uuidRe.test(id));
  const excludeClause = safeExclude.length > 0
    ? rawSql`AND NOT (u.id = ANY(${uuidArraySql(safeExclude)}))`
    : rawSql``;

  const categoryIds = await resolveAllowedCategoryIds(vehicleCategory);

  // Strict: no mapping → no fallback → dispatch cannot proceed for this key.
  if (!categoryIds.length) {
    console.warn(
      `[PARCEL_MATCH] rejected — parcelKey=${vehicleCategory} has no valid ` +
      `vehicle_category mapping (check PARCEL_VEHICLE_DRIVER_MAP + vehicle_categories table)`
    );
    return { drivers: [], excludedSummary: { vehicle_mapping_missing: 1 }, rejected: true };
  }

  const eligible = await rawDb.execute(rawSql`
    SELECT
      u.id, u.full_name, u.phone, u.rating, u.gender,
      dl.lat, dl.lng,
      COALESCE(dbs.overall_score, 50) as behavior_score,
      (SELECT ud.fcm_token FROM user_devices ud WHERE ud.user_id = u.id AND ud.fcm_token IS NOT NULL LIMIT 1) as fcm_token,
      SQRT(
        POW((dl.lat - ${Number(pickupLat)}) * 111.32, 2) +
        POW((dl.lng - ${Number(pickupLng)}) * 111.32 * COS(RADIANS(${Number(pickupLat)})), 2)
      ) as distance_km
    FROM users u
    JOIN driver_locations dl ON dl.driver_id = u.id
    JOIN driver_details dd ON dd.user_id = u.id
    LEFT JOIN driver_behavior_scores dbs ON dbs.driver_id = u.id
    WHERE u.user_type = 'driver'
      AND ${activeDriverEligibilitySql("u")}
      AND dl.is_online = true
      AND u.current_trip_id IS NULL
      AND dl.lat != 0 AND dl.lng != 0
      AND dl.updated_at > NOW() - INTERVAL '30 seconds'
      AND dd.vehicle_category_id = ANY(${uuidArraySql(categoryIds)})
      ${excludeClause}
      AND SQRT(
        POW((dl.lat - ${Number(pickupLat)}) * 111.32, 2) +
        POW((dl.lng - ${Number(pickupLng)}) * 111.32 * COS(RADIANS(${Number(pickupLat)})), 2)
      ) <= ${radiusKm}
    ORDER BY distance_km ASC
    LIMIT ${limit}
  `);

  console.log(
    `[PARCEL_MATCH] parcelKey=${vehicleCategory} radiusKm=${radiusKm} ` +
    `allowedCategoryIds=${categoryIds.length} drivers=${eligible.rows.length}`
  );

  // When no drivers match, surface per-driver exclusion reasons for nearby
  // online drivers so the operator can see what's wrong (log-only; cheap).
  const excludedSummary: Record<string, number> = {};
  if (!eligible.rows.length) {
    try {
      const nearby = await rawDb.execute(rawSql`
        SELECT
          u.id, u.full_name, u.is_active, u.is_locked,
          u.current_trip_id, u.verification_status,
          dl.is_online as dl_online, dl.lat, dl.lng, dl.updated_at,
          dd.vehicle_category_id,
          SQRT(
            POW((dl.lat - ${Number(pickupLat)}) * 111.32, 2) +
            POW((dl.lng - ${Number(pickupLng)}) * 111.32 * COS(RADIANS(${Number(pickupLat)})), 2)
          ) as distance_km
        FROM users u
        JOIN driver_locations dl ON dl.driver_id = u.id
        LEFT JOIN driver_details dd ON dd.user_id = u.id
        WHERE u.user_type = 'driver' AND dl.is_online = true
        ORDER BY distance_km ASC
        LIMIT 20
      `).catch(() => ({ rows: [] as any[] }));

      for (const row of nearby.rows as any[]) {
        const reasons: string[] = [];
        if (!row.is_active) reasons.push("inactive");
        if (row.is_locked) reasons.push("locked");
        if (!row.dl_online) reasons.push("offline");
        if (row.current_trip_id) reasons.push("busy");
        if (row.verification_status !== "approved") reasons.push("not_active");
        if (Number(row.lat) === 0 && Number(row.lng) === 0) reasons.push("gps_invalid");
        const mins = row.updated_at
          ? (Date.now() - new Date(row.updated_at).getTime()) / 1000
          : null;
        if (mins != null && mins > 30) reasons.push("stale_location");
        if (!row.vehicle_category_id || !categoryIds.includes(String(row.vehicle_category_id))) {
          reasons.push("vehicle_mismatch");
        }
        const distKm = Number(row.distance_km);
        if (Number.isFinite(distKm) && distKm > radiusKm) reasons.push("outside_radius");

        reasons.forEach((r) => (excludedSummary[r] = (excludedSummary[r] || 0) + 1));
        console.log(
          `[PARCEL_EXCLUDE] driverId=${row.id} parcelKey=${vehicleCategory} ` +
          `distKm=${distKm.toFixed(2)} reasons=${reasons.join(",") || "none"}`
        );
      }
    } catch (e: any) {
      console.error("[PARCEL_EXCLUDE] diagnostic query failed:", e.message);
    }
  }

  return { drivers: eligible.rows as any[], excludedSummary, rejected: false };
}

// ── DB Table Initialization ──────────────────────────────────────────────────

export async function initParcelAdvancedTables(): Promise<void> {
  await assertSchemaObjectsOrThrow({
    tables: ["parcel_delivery_proofs", "parcel_prohibited_items", "b2b_webhook_logs", "b2b_companies", "parcel_orders", "business_settings"],
  });

  console.log("[PARCEL-ADV] Schema verified");
}
