import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import {
  getMatchingDriverCategoryIds,
  getPlatformServiceKeyForCategory,
  getVehicleCategoryMeta,
  normalizeVehicleKey,
} from "./vehicle-matching";
import { driverHasActiveSubscription, getRidesRevenueModel } from "./revenue-policy";
import {
  isFemaleDriverPriorityEnabled,
  shouldPrioritizeFemaleDrivers,
  sortDriversByGenderPriority,
} from "./gender-matching";

export interface DispatchRequirements {
  tripId?: string;
  tripType: string;
  dispatchServiceType: string;
  platformServiceKey: string | null;
  city: string | null;
  vehicleCategoryId: string | null;
  vehicleCategoryKey: string | null;
  vehicleSubcategoryKey: string | null;
  parcelVehicleCategory: string | null;
  seatsRequired: number;
  strictCategoryIds: string[] | null;
  requiresParcel: boolean;
  requiresPool: boolean;
  requiresOutstation: boolean;
  requiresIntercity: boolean;
  customerGender: string | null;
  preferredDriverGender: string | null;
  preferFemaleDriver: boolean;
  prioritizeFemaleDrivers: boolean;
}

export interface DriverDispatchProfile {
  driverId: string;
  vehicleCategoryId: string | null;
  vehicleCategoryKey: string | null;
  vehicleSubcategoryKey: string | null;
  serviceEligibility: string[];
  parcelEligibility: boolean;
  poolEligibility: boolean;
  outstationEligibility: boolean;
  intercityEligibility: boolean;
  seatCapacity: number;
  approvalState: string;
  city: string | null;
  cityEligibility: string[];
  isActive: boolean;
  isLocked: boolean;
  isOnline: boolean;
  hasActiveTrip: boolean;
}

function normalizeTextArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeVehicleKey(String(entry || "")))
    .filter(Boolean);
}

function inferDispatchServiceType(tripType: string, categoryKey: string | null): string {
  const tt = normalizeVehicleKey(tripType);
  const ck = normalizeVehicleKey(categoryKey);
  if (tt === "parcel" || tt === "delivery") return "parcel";
  if (tt === "cargo" || tt === "b2b") return "b2b_parcel";
  if (tt === "carpool" || tt === "pool" || tt === "city_pool") return "carpool";
  if (tt === "intercity" || tt === "outstation" || tt === "outstation_pool") return "outstation";
  if (ck === "bike" || ck === "bike_ride") return "bike";
  if (ck === "auto" || ck === "auto_ride") return "auto";
  return "cab";
}

function inferPlatformServiceKey(
  tripType: string,
  categoryKey: string | null,
  categoryServiceKey: string | null,
): string | null {
  const tt = normalizeVehicleKey(tripType);
  if (tt === "parcel" || tt === "delivery" || tt === "cargo" || tt === "b2b") {
    return "parcel_delivery";
  }
  if (tt === "carpool" || tt === "pool" || tt === "city_pool") return "city_pool";
  if (tt === "intercity" || tt === "intercity_pool") return "intercity_pool";
  if (tt === "outstation" || tt === "outstation_pool") return "outstation_pool";
  if (categoryServiceKey) return normalizeVehicleKey(categoryServiceKey);
  const ck = normalizeVehicleKey(categoryKey);
  if (ck === "bike") return "bike_ride";
  if (ck === "auto") return "auto_ride";
  if (ck === "mini_car") return "mini_car";
  if (ck === "sedan") return "sedan";
  if (ck === "premium") return "premium";
  if (ck === "suv") return "suv";
  return null;
}

async function isServiceEnabledForCity(
  platformServiceKey: string | null,
  city: string | null,
): Promise<boolean> {
  if (!platformServiceKey) return true;
  const globalR = await rawDb.execute(rawSql`
    SELECT service_status
    FROM platform_services
    WHERE service_key = ${platformServiceKey}
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  if (globalR.rows.length) {
    const status = String((globalR.rows[0] as any).service_status || "").toLowerCase();
    if (status && status !== "active") return false;
  }
  if (!city) return true;
  const cityR = await rawDb.execute(rawSql`
    SELECT is_active
    FROM city_services
    WHERE LOWER(city_name) = LOWER(${city})
      AND service_key = ${platformServiceKey}
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  if (!cityR.rows.length) return true;
  return (cityR.rows[0] as any).is_active !== false;
}

export async function buildDispatchRequirementsFromTripInput(input: {
  tripId?: string;
  tripType?: string | null;
  vehicleCategoryId?: string | null;
  vehicleCategoryName?: string | null;
  parcelVehicleCategory?: string | null;
  seatsBooked?: number | string | null;
  city?: string | null;
  customerGender?: string | null;
  preferredDriverGender?: string | null;
  preferFemaleDriver?: boolean;
  prioritizeFemaleDrivers?: boolean;
}): Promise<DispatchRequirements> {
  const tripType = String(input.tripType || "normal");
  const categoryMeta = input.vehicleCategoryId
    ? await getVehicleCategoryMeta(input.vehicleCategoryId)
    : null;
  const categoryKey = categoryMeta?.vehicleType || normalizeVehicleKey(input.vehicleCategoryName || "");
  const serviceKey = getPlatformServiceKeyForCategory(categoryMeta)
    || inferPlatformServiceKey(tripType, categoryKey || null, categoryMeta?.serviceType || null);
  const dispatchServiceType = inferDispatchServiceType(tripType, categoryKey || null);
  const seatsRequired = Math.max(1, Number(input.seatsBooked || 1) || 1);
  // Expand to all equivalent category UUIDs (bike↔bike_ride, mini_car↔cab, etc.)
  // so dispatch never misses drivers registered under a sibling category row.
  const strictCategoryIds = await getMatchingDriverCategoryIds(input.vehicleCategoryId || null);
  const settingEnabled = input.prioritizeFemaleDrivers === undefined
    ? await isFemaleDriverPriorityEnabled()
    : true;
  const prioritizeFemaleDrivers = input.prioritizeFemaleDrivers ?? shouldPrioritizeFemaleDrivers({
    settingEnabled,
    customerGender: input.customerGender,
    preferredDriverGender: input.preferredDriverGender,
    preferFemaleDriver: input.preferFemaleDriver,
  });

  return {
    tripId: input.tripId,
    tripType,
    dispatchServiceType,
    platformServiceKey: serviceKey,
    city: input.city || null,
    vehicleCategoryId: input.vehicleCategoryId || null,
    vehicleCategoryKey: categoryKey || null,
    vehicleSubcategoryKey: null,
    parcelVehicleCategory: input.parcelVehicleCategory
      ? normalizeVehicleKey(input.parcelVehicleCategory)
      : (dispatchServiceType === "parcel" || dispatchServiceType === "b2b_parcel" ? categoryKey || null : null),
    seatsRequired,
    strictCategoryIds,
    requiresParcel: dispatchServiceType === "parcel" || dispatchServiceType === "b2b_parcel",
    requiresPool: dispatchServiceType === "carpool",
    requiresOutstation: normalizeVehicleKey(tripType) === "outstation" || normalizeVehicleKey(tripType) === "outstation_pool",
    requiresIntercity: normalizeVehicleKey(tripType) === "intercity",
    customerGender: input.customerGender ? String(input.customerGender).toLowerCase() : null,
    preferredDriverGender: input.preferredDriverGender ? String(input.preferredDriverGender).toLowerCase() : null,
    preferFemaleDriver: !!input.preferFemaleDriver,
    prioritizeFemaleDrivers,
  };
}

export async function resolveDispatchRequirementsFromTrip(tripId: string): Promise<DispatchRequirements | null> {
  let row: any = null;
  try {
    const tripR = await rawDb.execute(rawSql`
      SELECT
        t.id,
        t.trip_type,
        t.vehicle_category_id,
        t.seats_booked,
        COALESCE(t.vehicle_type_name, vc.name, '') as vehicle_category_name,
        COALESCE(u.city, '') as city_name,
        COALESCE(u.gender, '') as customer_gender,
        COALESCE(u.prefer_female_driver, false) as prefer_female_driver,
        COALESCE(up.preferred_gender, 'any') as preferred_driver_gender
      FROM trip_requests t
      LEFT JOIN vehicle_categories vc ON vc.id = t.vehicle_category_id
      LEFT JOIN users u ON u.id = t.customer_id
      LEFT JOIN user_preferences up ON up.user_id = t.customer_id
      WHERE t.id = ${tripId}::uuid
      LIMIT 1
    `);
    row = tripR.rows[0];
  } catch {
    const tripR = await rawDb.execute(rawSql`
      SELECT
        t.id,
        t.trip_type,
        t.vehicle_category_id,
        t.seats_booked,
        COALESCE(t.vehicle_type_name, vc.name, '') as vehicle_category_name,
        COALESCE(u.city, '') as city_name
      FROM trip_requests t
      LEFT JOIN vehicle_categories vc ON vc.id = t.vehicle_category_id
      LEFT JOIN users u ON u.id = t.customer_id
      WHERE t.id = ${tripId}::uuid
      LIMIT 1
    `).catch(() => ({ rows: [] as any[] }));
    row = tripR.rows[0];
  }

  if (!row) return null;
  return buildDispatchRequirementsFromTripInput({
    tripId,
    tripType: row.trip_type,
    vehicleCategoryId: row.vehicle_category_id,
    vehicleCategoryName: row.vehicle_category_name,
    seatsBooked: row.seats_booked,
    city: row.city_name || null,
    customerGender: row.customer_gender || null,
    preferredDriverGender: row.preferred_driver_gender || null,
    preferFemaleDriver: row.prefer_female_driver === true,
  });
}

export async function getDriverDispatchProfile(driverId: string): Promise<DriverDispatchProfile | null> {
  const r = await rawDb.execute(rawSql`
    SELECT
      u.id,
      u.is_active,
      u.is_locked,
      u.current_trip_id,
      u.verification_status,
      u.city,
      u.is_online,
      dl.is_online as dl_online,
      dd.vehicle_category_id as vehicle_category_id,
      COALESCE(dd.vehicle_subcategory, '') as vehicle_subcategory,
      -- service_eligibility is jsonb, not text[] - COALESCE(..., '{}'::text[])
      -- against a jsonb column throws "COALESCE types jsonb and text[] cannot
      -- be matched", which made this whole query fail on every dispatch
      -- attempt (confirmed in production logs: candidate-query-error on
      -- every radius step, silently falling back to a looser query that
      -- doesn't apply this same eligibility filtering). node-postgres
      -- already parses jsonb into a native JS array/null, and
      -- normalizeTextArray() below treats non-array/null as [], so the
      -- column can just be selected as-is.
      dd.service_eligibility as service_eligibility,
      dd.parcel_eligibility,
      dd.pool_eligibility,
      dd.outstation_eligibility,
      dd.intercity_eligibility,
      dd.seat_capacity,
      COALESCE(dd.approval_state, '') as approval_state,
      COALESCE(dd.city_eligibility, '{}'::text[]) as city_eligibility,
      COALESCE(vc.name, '') as vehicle_category_name,
      COALESCE(vc.vehicle_type, '') as vehicle_type_key,
      COALESCE(vc.total_seats, 0) as category_total_seats,
      COALESCE(vc.is_carpool, false) as category_is_carpool,
      COALESCE(vc.service_type, '') as category_service_type
    FROM users u
    LEFT JOIN driver_locations dl ON dl.driver_id = u.id
    LEFT JOIN driver_details dd ON dd.user_id = u.id
    LEFT JOIN vehicle_categories vc ON vc.id = dd.vehicle_category_id
    WHERE u.id = ${driverId}::uuid
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));

  if (!r.rows.length) return null;
  const row = r.rows[0] as any;
  const vehicleCategoryKey = normalizeVehicleKey(row.vehicle_type_key || row.vehicle_category_name);
  const categoryMeta = row.vehicle_category_id ? await getVehicleCategoryMeta(row.vehicle_category_id) : null;
  const serviceEligibility = normalizeTextArray(row.service_eligibility);
  if (!serviceEligibility.length) {
    const inferredService = inferPlatformServiceKey("", vehicleCategoryKey, categoryMeta?.serviceType || null);
    if (inferredService) serviceEligibility.push(inferredService);
    if (categoryMeta?.serviceType === "parcel") serviceEligibility.push("parcel_delivery");
    if (categoryMeta?.serviceType === "pool" || categoryMeta?.isCarpool) serviceEligibility.push("city_pool");
  }
  if (serviceEligibility.includes("intercity")) serviceEligibility.push("intercity_pool");
  if (serviceEligibility.includes("outstation")) serviceEligibility.push("outstation_pool");
  if (serviceEligibility.includes("intercity_pool")) serviceEligibility.push("intercity");
  if (serviceEligibility.includes("outstation_pool")) serviceEligibility.push("outstation");

  const parcelEligibility = row.parcel_eligibility === null || row.parcel_eligibility === undefined
    ? categoryMeta?.serviceType === "parcel" || serviceEligibility.includes("parcel_delivery")
    : row.parcel_eligibility === true;
  const poolEligibility = row.pool_eligibility === null || row.pool_eligibility === undefined
    ? categoryMeta?.serviceType === "pool" || categoryMeta?.isCarpool || serviceEligibility.includes("city_pool")
    : row.pool_eligibility === true;
  const outstationEligibility = row.outstation_eligibility === true
    || serviceEligibility.includes("outstation")
    || serviceEligibility.includes("outstation_pool");
  const intercityEligibility = row.intercity_eligibility === true
    || serviceEligibility.includes("intercity")
    || serviceEligibility.includes("intercity_pool");
  const seatCapacity = Math.max(1, Number(row.seat_capacity || row.category_total_seats || 1) || 1);

  return {
    driverId: row.id,
    vehicleCategoryId: row.vehicle_category_id || null,
    vehicleCategoryKey: vehicleCategoryKey || null,
    vehicleSubcategoryKey: normalizeVehicleKey(row.vehicle_subcategory || "") || null,
    serviceEligibility: Array.from(new Set(serviceEligibility)),
    parcelEligibility,
    poolEligibility,
    outstationEligibility,
    intercityEligibility,
    seatCapacity,
    approvalState: normalizeVehicleKey(row.approval_state || row.verification_status || ""),
    city: row.city || null,
    cityEligibility: normalizeTextArray(row.city_eligibility),
    isActive: row.is_active === true,
    isLocked: row.is_locked === true,
    isOnline: row.is_online === true || row.dl_online === true,
    hasActiveTrip: !!row.current_trip_id,
  };
}

/**
 * Build a DriverDispatchProfile directly from the row already fetched by
 * findEligibleDriversForDispatch's main SQL query. Zero additional DB calls.
 * This eliminates the N+1 getDriverDispatchProfile() call inside the filter loop
 * (each call was its own SELECT + a getVehicleCategoryMeta() lookup per candidate).
 */
function buildProfileFromCandidateRow(row: any): DriverDispatchProfile {
  const vehicleCategoryKey = normalizeVehicleKey(row.vehicle_type_code || row.vehicle_name || "");
  const categoryServiceType = String(row.category_service_type || "");
  const categoryIsCarpool = row.category_is_carpool === true;

  const serviceEligibility = normalizeTextArray(row.service_eligibility);
  if (!serviceEligibility.length) {
    const inferredService = inferPlatformServiceKey("", vehicleCategoryKey, categoryServiceType || null);
    if (inferredService) serviceEligibility.push(inferredService);
    if (categoryServiceType === "parcel") serviceEligibility.push("parcel_delivery");
    if (categoryServiceType === "pool" || categoryIsCarpool) serviceEligibility.push("city_pool");
  }
  if (serviceEligibility.includes("intercity")) serviceEligibility.push("intercity_pool");
  if (serviceEligibility.includes("outstation")) serviceEligibility.push("outstation_pool");
  if (serviceEligibility.includes("intercity_pool")) serviceEligibility.push("intercity");
  if (serviceEligibility.includes("outstation_pool")) serviceEligibility.push("outstation");

  const parcelEligibility = row.parcel_eligibility === null || row.parcel_eligibility === undefined
    ? categoryServiceType === "parcel" || serviceEligibility.includes("parcel_delivery")
    : row.parcel_eligibility === true;
  const poolEligibility = row.pool_eligibility === null || row.pool_eligibility === undefined
    ? categoryServiceType === "pool" || categoryIsCarpool || serviceEligibility.includes("city_pool")
    : row.pool_eligibility === true;
  const outstationEligibility = row.outstation_eligibility === true
    || serviceEligibility.includes("outstation")
    || serviceEligibility.includes("outstation_pool");
  const intercityEligibility = row.intercity_eligibility === true
    || serviceEligibility.includes("intercity")
    || serviceEligibility.includes("intercity_pool");
  const seatCapacity = Math.max(1, Number(row.seat_capacity || row.category_total_seats || 1) || 1);

  return {
    driverId: row.id,
    vehicleCategoryId: row.vehicle_category_id || null,
    vehicleCategoryKey: vehicleCategoryKey || null,
    vehicleSubcategoryKey: normalizeVehicleKey(row.vehicle_subcategory || "") || null,
    serviceEligibility: Array.from(new Set(serviceEligibility)),
    parcelEligibility,
    poolEligibility,
    outstationEligibility,
    intercityEligibility,
    seatCapacity,
    approvalState: normalizeVehicleKey(row.approval_state || row.verification_status || ""),
    city: row.city || null,
    cityEligibility: normalizeTextArray(row.city_eligibility),
    isActive: row.is_active === true,
    isLocked: row.is_locked === true,
    isOnline: row.is_online === true || row.dl_online === true,
    hasActiveTrip: !!row.current_trip_id,
  };
}

/**
 * Run all eligibility gates against a pre-built profile — does NOT touch the
 * database. ridesModel must be pre-fetched once outside the candidate loop
 * (was previously re-fetched per candidate — see findEligibleDriversForDispatch).
 * Mirrors isDriverEligibleForDispatch's gates exactly, including the _ride/normal
 * service-key fallback matching.
 */
function checkProfileEligibility(
  profile: DriverDispatchProfile,
  requirements: DispatchRequirements,
  ridesModel: string,
): { eligible: boolean; reason?: string; needsSubCheck?: boolean } {
  if (!profile.isActive) return { eligible: false, reason: "driver_inactive" };
  if (profile.isLocked) return { eligible: false, reason: "driver_locked" };
  if (!profile.isOnline) return { eligible: false, reason: "driver_offline" };
  if (profile.hasActiveTrip) return { eligible: false, reason: "driver_busy" };
  if (!["approved", "verified"].includes(profile.approvalState)) {
    return { eligible: false, reason: "driver_not_approved" };
  }
  if (
    requirements.strictCategoryIds?.length &&
    !requirements.strictCategoryIds.includes(profile.vehicleCategoryId || "")
  ) {
    return { eligible: false, reason: "vehicle_category_mismatch" };
  }
  const driverVehicleKey = profile.vehicleCategoryKey || "";
  const isParcelVehicle = ["parcel", "cargo", "truck", "tempo", "pickup"].some((t) =>
    driverVehicleKey.includes(t),
  );
  if (!requirements.requiresParcel && isParcelVehicle) {
    return { eligible: false, reason: "parcel_vehicle_on_ride_trip" };
  }
  if (requirements.requiresParcel && !profile.parcelEligibility && !isParcelVehicle) {
    return { eligible: false, reason: "ride_vehicle_on_parcel_trip" };
  }
  if (requirements.platformServiceKey) {
    const pKey = requirements.platformServiceKey;
    const hasDirect = profile.serviceEligibility.includes(pKey);
    const isRide = pKey.endsWith("_ride");
    const baseKey = pKey.replace("_ride", "");
    const hasBase = isRide && profile.serviceEligibility.includes(baseKey);
    const hasNormal = profile.serviceEligibility.includes("normal");
    if (!hasDirect && !hasBase && !hasNormal) {
      return { eligible: false, reason: "service_not_enabled" };
    }
  }
  if (requirements.requiresParcel && !profile.parcelEligibility) {
    return { eligible: false, reason: "parcel_not_enabled" };
  }
  if (requirements.requiresPool) {
    if (!profile.poolEligibility) return { eligible: false, reason: "pool_not_enabled" };
    if (profile.seatCapacity < requirements.seatsRequired) {
      return { eligible: false, reason: "seat_capacity_low" };
    }
  }
  if (requirements.requiresOutstation && !profile.outstationEligibility) {
    return { eligible: false, reason: "outstation_not_enabled" };
  }
  if (requirements.requiresIntercity && !profile.intercityEligibility) {
    return { eligible: false, reason: "intercity_not_enabled" };
  }
  if (requirements.city) {
    const eligible = profile.cityEligibility;
    if (eligible.length && !eligible.includes(normalizeVehicleKey(requirements.city))) {
      return { eligible: false, reason: "city_not_enabled" };
    }
  }
  // Subscription check: ridesModel is pre-fetched — only flag that a per-driver DB call is needed
  if (!requirements.requiresParcel) {
    const tripType = normalizeVehicleKey(requirements.tripType || "");
    const isRideTrip = !["parcel", "delivery", "cargo", "carpool", "pool", "city_pool", "intercity", "outstation"].includes(tripType);
    if (isRideTrip && ["subscription", "hybrid"].includes(ridesModel)) {
      return { eligible: true, needsSubCheck: true };
    }
  }
  return { eligible: true };
}

export async function isDriverEligibleForDispatch(
  driverId: string,
  requirements: DispatchRequirements,
): Promise<{ eligible: boolean; reason?: string; profile?: DriverDispatchProfile | null }> {
  const serviceEnabled = await isServiceEnabledForCity(requirements.platformServiceKey, requirements.city);
  if (!serviceEnabled) return { eligible: false, reason: "service_disabled" };

  const profile = await getDriverDispatchProfile(driverId);
  if (!profile) return { eligible: false, reason: "driver_not_found" };
  if (!profile.isActive) return { eligible: false, reason: "driver_inactive", profile };
  if (profile.isLocked) return { eligible: false, reason: "driver_locked", profile };
  if (!profile.isOnline) return { eligible: false, reason: "driver_offline", profile };
  if (profile.hasActiveTrip) return { eligible: false, reason: "driver_busy", profile };
  if (!["approved", "verified"].includes(profile.approvalState)) {
    return { eligible: false, reason: "driver_not_approved", profile };
  }
  if (requirements.strictCategoryIds?.length && !requirements.strictCategoryIds.includes(profile.vehicleCategoryId || "")) {
    return { eligible: false, reason: "vehicle_category_mismatch", profile };
  }
  const driverVehicleKey = profile.vehicleCategoryKey || "";
  const isParcelVehicle = ["parcel", "cargo", "truck", "tempo", "pickup"].some((token) => driverVehicleKey.includes(token));
  if (!requirements.requiresParcel && isParcelVehicle) {
    return { eligible: false, reason: "parcel_vehicle_on_ride_trip", profile };
  }
  if (requirements.requiresParcel && !profile.parcelEligibility && !isParcelVehicle) {
    return { eligible: false, reason: "ride_vehicle_on_parcel_trip", profile };
  }
  if (requirements.platformServiceKey) {
    const pKey = requirements.platformServiceKey;
    const hasDirect = profile.serviceEligibility.includes(pKey);
    const isRide = pKey.endsWith("_ride");
    const baseKey = pKey.replace("_ride", "");
    const hasBase = isRide && profile.serviceEligibility.includes(baseKey);
    const hasNormal = profile.serviceEligibility.includes("normal");
    if (!hasDirect && !hasBase && !hasNormal) {
      return { eligible: false, reason: "service_not_enabled", profile };
    }
  }
  if (requirements.requiresParcel && !profile.parcelEligibility) {
    return { eligible: false, reason: "parcel_not_enabled", profile };
  }
  if (requirements.requiresPool) {
    if (!profile.poolEligibility) return { eligible: false, reason: "pool_not_enabled", profile };
    if (profile.seatCapacity < requirements.seatsRequired) {
      return { eligible: false, reason: "seat_capacity_low", profile };
    }
  }
  if (requirements.requiresOutstation && !profile.outstationEligibility) {
    return { eligible: false, reason: "outstation_not_enabled", profile };
  }
  if (requirements.requiresIntercity && !profile.intercityEligibility) {
    return { eligible: false, reason: "intercity_not_enabled", profile };
  }
  if (requirements.city) {
    const eligibleCities = profile.cityEligibility;
    if (eligibleCities.length && !eligibleCities.includes(normalizeVehicleKey(requirements.city))) {
      return { eligible: false, reason: "city_not_enabled", profile };
    }
  }
  // P0: exclude drivers without subscription from ride dispatch when rides_model requires it
  if (!requirements.requiresParcel) {
    const tripType = normalizeVehicleKey(requirements.tripType || "");
    const isRideTrip = !["parcel", "delivery", "cargo", "carpool", "pool", "city_pool", "intercity", "outstation"].includes(tripType);
    if (isRideTrip) {
      const ridesModel = await getRidesRevenueModel();
      if (["subscription", "hybrid"].includes(ridesModel)) {
        const hasSub = await driverHasActiveSubscription(driverId);
        if (!hasSub) return { eligible: false, reason: "subscription_required", profile };
      }
    }
  }
  return { eligible: true, profile };
}

export async function findEligibleDriversForDispatch(input: {
  pickupLat: number;
  pickupLng: number;
  radiusKm: number;
  excludeDriverIds: string[];
  limit: number;
  requirements: DispatchRequirements;
}): Promise<any[]> {
  const { pickupLat, pickupLng, radiusKm, excludeDriverIds, limit, requirements } = input;
  const serviceEnabled = await isServiceEnabledForCity(requirements.platformServiceKey, requirements.city);
  if (!serviceEnabled) return [];

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const safeExclude = excludeDriverIds.filter((id) => uuidRe.test(id));
  const safeStrictCategoryIds = (requirements.strictCategoryIds || []).filter((id) => uuidRe.test(id));
  const excludeClause = safeExclude.length > 0
    ? safeExclude.length === 1
      ? rawSql`AND u.id <> ${safeExclude[0]}::uuid`
      : rawSql`AND u.id NOT IN (${rawSql.join(
          safeExclude.map((id) => rawSql`${id}::uuid`),
          rawSql`, `,
        )})`
    : rawSql``;
  const categoryClause = safeStrictCategoryIds.length
    ? safeStrictCategoryIds.length === 1
      ? rawSql`AND dd.vehicle_category_id = ${safeStrictCategoryIds[0]}::uuid`
      : rawSql`AND dd.vehicle_category_id IN (${rawSql.join(
          safeStrictCategoryIds.map((id) => rawSql`${id}::uuid`),
          rawSql`, `,
        )})`
    : requirements.vehicleCategoryId
      ? rawSql`AND dd.vehicle_category_id = ${requirements.vehicleCategoryId}::uuid`
      : rawSql``;

  const candidates = await rawDb.execute(rawSql`
    SELECT
      u.id, u.full_name, u.phone, u.rating, u.city, u.gender,
      u.is_active, u.is_locked, u.current_trip_id, u.verification_status, u.is_online,
      dl.is_online as dl_online, dl.lat, dl.lng, dl.updated_at,
      dd.vehicle_category_id as vehicle_category_id,
      COALESCE(dd.vehicle_subcategory, '') as vehicle_subcategory,
      -- service_eligibility is jsonb, not text[] - COALESCE(..., '{}'::text[])
      -- against a jsonb column throws "COALESCE types jsonb and text[] cannot
      -- be matched", which made this whole query fail on every dispatch
      -- attempt (confirmed in production logs: candidate-query-error on
      -- every radius step, silently falling back to a looser query that
      -- doesn't apply this same eligibility filtering). node-postgres
      -- already parses jsonb into a native JS array/null, and
      -- normalizeTextArray() below treats non-array/null as [], so the
      -- column can just be selected as-is.
      dd.service_eligibility as service_eligibility,
      dd.parcel_eligibility, dd.pool_eligibility, dd.outstation_eligibility, dd.intercity_eligibility,
      dd.seat_capacity, COALESCE(dd.approval_state, '') as approval_state,
      COALESCE(dd.city_eligibility, '{}'::text[]) as city_eligibility,
      COALESCE(vc.name, '') as vehicle_name,
      COALESCE(vc.vehicle_type, '') as vehicle_type_code,
      COALESCE(vc.total_seats, 0) as category_total_seats,
      COALESCE(vc.is_carpool, false) as category_is_carpool,
      COALESCE(vc.service_type, '') as category_service_type,
      COALESCE(ds.total_trips, 0) as total_trips,
      COALESCE(ds.avg_response_time_sec, 60) as avg_response_time_sec,
      COALESCE(ds.completion_rate, 0.8) as completion_rate,
      COALESCE(dbs.overall_score, 50) as behavior_score,
      (SELECT ud.fcm_token FROM user_devices ud WHERE ud.user_id = u.id AND ud.fcm_token IS NOT NULL LIMIT 1) as fcm_token,
      SQRT(
        POW((dl.lat - ${Number(pickupLat)}) * 111.32, 2) +
        POW((dl.lng - ${Number(pickupLng)}) * 111.32 * COS(RADIANS(${Number(pickupLat)})), 2)
      ) as distance_km
    FROM users u
    JOIN driver_locations dl ON dl.driver_id = u.id
    LEFT JOIN driver_details dd ON dd.user_id = u.id
    LEFT JOIN vehicle_categories vc ON vc.id = dd.vehicle_category_id
    LEFT JOIN driver_stats ds ON ds.driver_id = u.id
    LEFT JOIN driver_behavior_scores dbs ON dbs.driver_id = u.id
    WHERE u.user_type = 'driver'
      AND u.is_active = true
      AND u.is_locked = false
      AND dl.is_online = true
      AND u.current_trip_id IS NULL
      AND dl.lat != 0 AND dl.lng != 0
      AND dl.updated_at > NOW() - INTERVAL '90 seconds'
      ${categoryClause}
      ${excludeClause}
      AND SQRT(
        POW((dl.lat - ${Number(pickupLat)}) * 111.32, 2) +
        POW((dl.lng - ${Number(pickupLng)}) * 111.32 * COS(RADIANS(${Number(pickupLat)})), 2)
      ) <= ${radiusKm}
    ORDER BY distance_km ASC
    LIMIT ${Math.max(limit * 4, 20)}
  `).catch((error) => {
    console.error(
      `[DISPATCH_DEBUG] candidate-query-error trip=${requirements.tripId || "unknown"} radius=${radiusKm}:`,
      (error as any)?.message || error,
    );
    return { rows: [] as any[] };
  });

  if (requirements.tripId) {
    console.log(
      `[DISPATCH_DEBUG] trip=${requirements.tripId} strict-sql candidates=${(candidates.rows as any[]).length} radius=${radiusKm} service=${requirements.platformServiceKey || "unknown"} category=${requirements.vehicleCategoryId || "any"} strictIds=${safeStrictCategoryIds.join(",") || "none"}`,
    );
    if (!(candidates.rows as any[]).length) {
      const stepCounts = await rawDb.execute(rawSql`
        SELECT
          COUNT(*) FILTER (WHERE u.user_type = 'driver')::int AS base_count,
          COUNT(*) FILTER (
            WHERE u.user_type = 'driver'
              AND SQRT(
                POW((dl.lat - ${Number(pickupLat)}) * 111.32, 2) +
                POW((dl.lng - ${Number(pickupLng)}) * 111.32 * COS(RADIANS(${Number(pickupLat)})), 2)
              ) <= ${radiusKm}
          )::int AS in_radius,
          COUNT(*) FILTER (
            WHERE u.user_type = 'driver'
              AND SQRT(
                POW((dl.lat - ${Number(pickupLat)}) * 111.32, 2) +
                POW((dl.lng - ${Number(pickupLng)}) * 111.32 * COS(RADIANS(${Number(pickupLat)})), 2)
              ) <= ${radiusKm}
              AND u.is_active = true
              AND u.is_locked = false
          )::int AS active_unlocked,
          COUNT(*) FILTER (
            WHERE u.user_type = 'driver'
              AND SQRT(
                POW((dl.lat - ${Number(pickupLat)}) * 111.32, 2) +
                POW((dl.lng - ${Number(pickupLng)}) * 111.32 * COS(RADIANS(${Number(pickupLat)})), 2)
              ) <= ${radiusKm}
              AND u.is_active = true
              AND u.is_locked = false
              AND dl.is_online = true
          )::int AS dl_online_count,
          COUNT(*) FILTER (
            WHERE u.user_type = 'driver'
              AND SQRT(
                POW((dl.lat - ${Number(pickupLat)}) * 111.32, 2) +
                POW((dl.lng - ${Number(pickupLng)}) * 111.32 * COS(RADIANS(${Number(pickupLat)})), 2)
              ) <= ${radiusKm}
              AND u.is_active = true
              AND u.is_locked = false
              AND dl.is_online = true
              AND u.current_trip_id IS NULL
          )::int AS not_busy_count,
          COUNT(*) FILTER (
            WHERE u.user_type = 'driver'
              AND SQRT(
                POW((dl.lat - ${Number(pickupLat)}) * 111.32, 2) +
                POW((dl.lng - ${Number(pickupLng)}) * 111.32 * COS(RADIANS(${Number(pickupLat)})), 2)
              ) <= ${radiusKm}
              AND u.is_active = true
              AND u.is_locked = false
              AND dl.is_online = true
              AND u.current_trip_id IS NULL
              AND dl.lat != 0 AND dl.lng != 0
          )::int AS valid_gps_count,
          COUNT(*) FILTER (
            WHERE u.user_type = 'driver'
              AND SQRT(
                POW((dl.lat - ${Number(pickupLat)}) * 111.32, 2) +
                POW((dl.lng - ${Number(pickupLng)}) * 111.32 * COS(RADIANS(${Number(pickupLat)})), 2)
              ) <= ${radiusKm}
              AND u.is_active = true
              AND u.is_locked = false
              AND dl.is_online = true
              AND u.current_trip_id IS NULL
              AND dl.lat != 0 AND dl.lng != 0
              AND dl.updated_at > NOW() - INTERVAL '90 seconds'
              ${excludeClause}
          )::int AS fresh_count,
          COUNT(*) FILTER (
            WHERE u.user_type = 'driver'
              AND SQRT(
                POW((dl.lat - ${Number(pickupLat)}) * 111.32, 2) +
                POW((dl.lng - ${Number(pickupLng)}) * 111.32 * COS(RADIANS(${Number(pickupLat)})), 2)
              ) <= ${radiusKm}
              AND u.is_active = true
              AND u.is_locked = false
              AND dl.is_online = true
              AND u.current_trip_id IS NULL
              AND dl.lat != 0 AND dl.lng != 0
              AND dl.updated_at > NOW() - INTERVAL '90 seconds'
              ${excludeClause}
              ${categoryClause}
          )::int AS category_count
        FROM users u
        JOIN driver_locations dl ON dl.driver_id = u.id
        LEFT JOIN driver_details dd ON dd.user_id = u.id
      `).catch(() => ({ rows: [] as any[] }));
      console.log(`[DISPATCH_DEBUG] trip=${requirements.tripId} step-counts=${JSON.stringify((stepCounts.rows as any[])[0] || {})}`);
      const nearbyDebug = await rawDb.execute(rawSql`
        SELECT
          u.id,
          u.is_online,
          u.current_trip_id,
          dl.is_online AS dl_online,
          dl.lat,
          dl.lng,
          dl.updated_at,
          EXTRACT(EPOCH FROM (NOW() - dl.updated_at))::int AS age_seconds,
          dd.vehicle_category_id
        FROM users u
        JOIN driver_locations dl ON dl.driver_id = u.id
        LEFT JOIN driver_details dd ON dd.user_id = u.id
        WHERE u.user_type = 'driver'
          AND SQRT(
            POW((dl.lat - ${Number(pickupLat)}) * 111.32, 2) +
            POW((dl.lng - ${Number(pickupLng)}) * 111.32 * COS(RADIANS(${Number(pickupLat)})), 2)
          ) <= ${radiusKm}
        ORDER BY dl.updated_at DESC NULLS LAST
        LIMIT 10
      `).catch(() => ({ rows: [] as any[] }));
      for (const row of nearbyDebug.rows as any[]) {
        const reasons: string[] = [];
        if (!(row as any).dl_online) reasons.push("dl_offline");
        if ((row as any).current_trip_id) reasons.push("busy");
        if ((row as any).lat == null || (row as any).lng == null || ((row as any).lat === 0 && (row as any).lng === 0)) reasons.push("gps_invalid");
        if ((row as any).age_seconds == null || Number((row as any).age_seconds) > 90) reasons.push(`stale_${String((row as any).age_seconds)}`);
        if (safeStrictCategoryIds.length && !safeStrictCategoryIds.includes(String((row as any).vehicle_category_id || ""))) reasons.push("category_mismatch");
        if (safeExclude.includes(String((row as any).id))) reasons.push("in_exclude_list");
        console.log(
          `[DISPATCH_DEBUG] trip=${requirements.tripId} nearby-driver=${String((row as any).id)} ` +
          `uOnline=${String((row as any).is_online)} dlOnline=${String((row as any).dl_online)} ageSec=${String((row as any).age_seconds)} ` +
          `vc=${String((row as any).vehicle_category_id || "")} reject=${reasons.join("|") || "none"}`,
        );
      }
    }
  }

  // Hoist getRidesRevenueModel() once outside the loop (was called once per candidate — N+1 fix).
  const ridesModel = await getRidesRevenueModel().catch(() => "commission");

  const filtered: any[] = [];
  for (const row of candidates.rows as any[]) {
    // Build profile from already-fetched row data — zero additional DB calls.
    const profile = buildProfileFromCandidateRow(row);

    // Run all gate checks in-memory using the pre-fetched ridesModel.
    const eligCheck = checkProfileEligibility(profile, requirements, ridesModel);

    if (!eligCheck.eligible) {
      if (requirements.tripId) {
        console.log(
          `[DISPATCH_DEBUG] trip=${requirements.tripId} driver=${row.id} rejected=${eligCheck.reason || "unknown"} ` +
          `diagFields={uOnline:${String((row as any).is_online)},dlOnline:${String((row as any).dl_online)},vc:${String((row as any).vehicle_category_id || "")},updated:${String((row as any).updated_at || "")}}`,
        );
      }
      continue;
    }

    // Per-driver subscription check — only executed when ridesModel requires it (needsSubCheck flag).
    if (eligCheck.needsSubCheck) {
      const hasSub = await driverHasActiveSubscription(row.id).catch(() => false);
      if (!hasSub) {
        if (requirements.tripId) {
          console.log(`[DISPATCH_DEBUG] trip=${requirements.tripId} driver=${row.id} rejected=subscription_required`);
        }
        continue;
      }
    }

    filtered.push({
      driverId: row.id,
      fullName: row.full_name || "Pilot",
      phone: row.phone || "",
      lat: Number(row.lat),
      lng: Number(row.lng),
      distanceKm: Math.round((Number(row.distance_km) || 0) * 100) / 100,
      rating: Math.round((Number(row.rating) || 5) * 10) / 10,
      totalTrips: Number(row.total_trips) || 0,
      avgResponseTimeSec: Number(row.avg_response_time_sec) || 60,
      score: 0,
      completionRate: Number(row.completion_rate) || 0.8,
      behaviorScore: Number(row.behavior_score) || 50,
      fcmToken: row.fcm_token || undefined,
      seatCapacity: profile.seatCapacity,
      driverGender: row.gender ? String(row.gender).toLowerCase() : null,
    });
  }

  let result = filtered;
  if (requirements.prioritizeFemaleDrivers) {
    result = sortDriversByGenderPriority(filtered, true).slice(0, limit);
    if (requirements.tripId) {
      const femaleCount = result.filter((d) => String(d.driverGender || "").toLowerCase() === "female").length;
      console.log(
        `[DISPATCH] trip=${requirements.tripId} female-priority active eligible=${filtered.length} femaleInQueue=${femaleCount}`,
      );
    }
  } else {
    result = filtered.slice(0, limit);
  }

  if (requirements.tripId) {
    console.log(
      `[DISPATCH_DEBUG] trip=${requirements.tripId} strict-filtered=${result.length}`,
    );
  }

  return result;
}

export async function getDriverEligibleServiceSnapshot(driverId: string): Promise<{
  profile: DriverDispatchProfile | null;
  serviceKeys: string[];
  parcelVehicleKeys: string[];
}> {
  const profile = await getDriverDispatchProfile(driverId);
  if (!profile) return { profile: null, serviceKeys: [], parcelVehicleKeys: [] };

  const serviceKeys = Array.from(new Set(profile.serviceEligibility));
  const categoryKey = normalizeVehicleKey(profile.vehicleCategoryKey || "");
  const parcelVehicleKeys: string[] = [];

  if (profile.parcelEligibility) {
    if (categoryKey === "bike") parcelVehicleKeys.push("bike_parcel");
    if (categoryKey === "auto") parcelVehicleKeys.push("auto_parcel");
    if (["mini_truck", "tata_ace", "mini_cargo", "mini_cargo_auto"].includes(categoryKey)) {
      parcelVehicleKeys.push("tata_ace");
    }
    if (["pickup_truck", "truck", "pickup"].includes(categoryKey)) {
      parcelVehicleKeys.push("pickup_truck", "bolero_cargo");
    }
    if (["tempo", "tempo_407"].includes(categoryKey)) parcelVehicleKeys.push("tempo_407");
  }

  return {
    profile,
    serviceKeys,
    parcelVehicleKeys: Array.from(new Set(parcelVehicleKeys)),
  };
}
