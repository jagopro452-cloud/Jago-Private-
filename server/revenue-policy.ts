import { rawDb, rawSql } from "./db";

export type RevenueModule = "ride" | "parcel" | "carpool" | "outstation" | "b2b";

export type RevenuePolicy = {
  moduleName: RevenueModule;
  revenueModel: "commission" | "subscription" | "hybrid" | "free";
  commissionPercentage: number;
  commissionGstPercentage: number;
  subscriptionRequired: boolean;
  isActive: boolean;
  notes?: string | null;
};

const MODULE_ALIASES: Record<string, RevenueModule> = {
  ride: "ride",
  rides: "ride",
  bike_ride: "ride",
  auto_ride: "ride",
  cab: "ride",
  car: "ride",
  parcel: "parcel",
  parcels: "parcel",
  cargo: "parcel",
  parcel_delivery: "parcel",
  b2b: "b2b",
  b2b_parcel: "b2b",
  carpool: "carpool",
  city_pool: "carpool",
  local_pool: "carpool",
  pool: "carpool",
  car_pool_4: "carpool",
  car_pool_6: "carpool",
  intercity_pool: "carpool",
  outstation: "outstation",
  outstation_pool: "outstation",
  intercity: "outstation",
};

const LEGACY_MODEL_KEYS: Record<RevenueModule, string[]> = {
  ride: ["rides_model"],
  parcel: ["parcels_model", "cargo_model"],
  carpool: ["city_pool_model", "local_pool_model", "intercity_model"],
  outstation: ["outstation_pool_model"],
  b2b: ["b2b_model"],
};

const PLATFORM_SERVICE_KEYS: Record<RevenueModule, string[]> = {
  ride: ["bike_ride", "auto_ride", "mini_car", "sedan", "suv"],
  parcel: ["parcel_delivery"],
  carpool: ["city_pool", "intercity_pool"],
  outstation: ["outstation_pool"],
  b2b: [],
};

const DEFAULT_POLICY: Record<RevenueModule, RevenuePolicy> = {
  ride: {
    moduleName: "ride",
    revenueModel: "commission",
    commissionPercentage: 15,
    commissionGstPercentage: 18,
    subscriptionRequired: false,
    isActive: true,
  },
  parcel: {
    moduleName: "parcel",
    revenueModel: "commission",
    commissionPercentage: 12,
    commissionGstPercentage: 18,
    subscriptionRequired: false,
    isActive: true,
  },
  carpool: {
    moduleName: "carpool",
    revenueModel: "commission",
    commissionPercentage: 10,
    commissionGstPercentage: 18,
    subscriptionRequired: false,
    isActive: true,
  },
  outstation: {
    moduleName: "outstation",
    revenueModel: "commission",
    commissionPercentage: 12,
    commissionGstPercentage: 18,
    subscriptionRequired: false,
    isActive: true,
  },
  b2b: {
    moduleName: "b2b",
    revenueModel: "subscription",
    commissionPercentage: 0,
    commissionGstPercentage: 0,
    subscriptionRequired: true,
    isActive: true,
  },
};

function normalizeKey(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeRevenueModel(value: unknown): RevenuePolicy["revenueModel"] {
  const model = normalizeKey(value);
  if (model === "subscription" || model === "hybrid" || model === "free") return model;
  return "commission";
}

export function normalizeRevenueModule(value: unknown): RevenueModule | null {
  const key = normalizeKey(value);
  return MODULE_ALIASES[key] || null;
}

export function revenueModuleFromTripRow(row: any): RevenueModule {
  const tripType = normalizeKey(row?.trip_type || row?.tripType);
  const serviceType = normalizeKey(row?.service_type || row?.serviceType);
  const vehicleType = normalizeKey(row?.vehicle_type || row?.vehicleType);
  const vcType = normalizeKey(row?.vc_type || row?.vehicle_category_type || row?.type);
  const name = normalizeKey(row?.vehicle_name || row?.name);
  if (tripType.includes("parcel") || tripType.includes("delivery") || tripType.includes("cargo")) return "parcel";
  if (tripType.includes("outstation") || serviceType.includes("outstation")) return "outstation";
  if (tripType.includes("pool") || serviceType.includes("pool") || serviceType.includes("carpool") || row?.is_carpool === true || row?.is_carpool === "true") {
    return "carpool";
  }
  if (vcType === "parcel" || vcType === "cargo" || vehicleType.includes("parcel") || vehicleType.includes("cargo")) return "parcel";
  if (vehicleType.includes("pool") || name.includes("pool")) return "carpool";
  return "ride";
}

export function revenueModuleFromVehicleCategory(row: any): RevenueModule {
  const serviceType = normalizeKey(row?.service_type || row?.serviceType);
  const vcType = normalizeKey(row?.type || row?.vehicle_category_type);
  const vehicleType = normalizeKey(row?.vehicle_type || row?.vehicleType || row?.slug || row?.name);
  if (row?.is_carpool === true || row?.is_carpool === "true" || serviceType.includes("pool") || serviceType.includes("carpool") || vehicleType.includes("pool")) {
    return "carpool";
  }
  if (serviceType.includes("outstation")) return "outstation";
  if (vcType === "parcel" || vcType === "cargo" || vehicleType.includes("parcel") || vehicleType.includes("cargo")) return "parcel";
  return "ride";
}

function rowToPolicy(row: any, fallbackModule?: RevenueModule): RevenuePolicy {
  const moduleName = normalizeRevenueModule(row?.module_name) || fallbackModule || "ride";
  const revenueModel = normalizeRevenueModel(row?.revenue_model);
  return {
    moduleName,
    revenueModel,
    commissionPercentage: Number(row?.commission_percentage ?? DEFAULT_POLICY[moduleName].commissionPercentage),
    commissionGstPercentage: Number(row?.commission_gst_percentage ?? DEFAULT_POLICY[moduleName].commissionGstPercentage),
    subscriptionRequired: row?.subscription_required === true || row?.subscription_required === "true" || revenueModel === "subscription" || revenueModel === "hybrid",
    isActive: row?.is_active !== false && row?.is_active !== "false",
    notes: row?.notes ?? null,
  };
}

export async function listRevenueModuleConfigs(): Promise<RevenuePolicy[]> {
  const rows = await rawDb.execute(rawSql`SELECT * FROM service_revenue_config ORDER BY module_name`).catch(() => ({ rows: [] as any[] }));
  const merged = new Map<RevenueModule, RevenuePolicy>();
  for (const moduleName of Object.keys(DEFAULT_POLICY) as RevenueModule[]) {
    merged.set(moduleName, DEFAULT_POLICY[moduleName]);
  }
  for (const row of rows.rows as any[]) {
    const moduleName = normalizeRevenueModule(row.module_name);
    if (!moduleName) continue;
    const current = merged.get(moduleName);
    const incoming = rowToPolicy(row, moduleName);
    if (!current || normalizeKey(row.module_name) === moduleName) {
      merged.set(moduleName, incoming);
    }
  }
  return ["ride", "parcel", "carpool", "outstation", "b2b"].map((m) => merged.get(m as RevenueModule)!);
}

export async function getRevenueModulePolicy(moduleOrAlias: unknown): Promise<RevenuePolicy> {
  const moduleName = normalizeRevenueModule(moduleOrAlias) || "ride";
  const rows = await rawDb.execute(rawSql`
    SELECT * FROM service_revenue_config
    WHERE module_name = ${moduleName}
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  if (rows.rows.length) return rowToPolicy(rows.rows[0], moduleName);
  return DEFAULT_POLICY[moduleName];
}

async function syncLegacyModelKeys(policy: RevenuePolicy): Promise<void> {
  for (const key of LEGACY_MODEL_KEYS[policy.moduleName] || []) {
    await rawDb.execute(rawSql`
      INSERT INTO revenue_model_settings (key_name, value, updated_at)
      VALUES (${key}, ${policy.revenueModel}, NOW())
      ON CONFLICT (key_name) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `).catch(() => undefined);
  }
}

async function syncPlatformServices(policy: RevenuePolicy): Promise<void> {
  for (const serviceKey of PLATFORM_SERVICE_KEYS[policy.moduleName] || []) {
    await rawDb.execute(rawSql`
      UPDATE platform_services
      SET revenue_model = ${policy.revenueModel},
          commission_rate = ${policy.commissionPercentage},
          updated_at = NOW()
      WHERE service_key = ${serviceKey}
    `).catch(() => undefined);
  }
}

export async function upsertRevenueModuleConfig(inputModule: unknown, input: Partial<RevenuePolicy> & { notes?: string | null }): Promise<RevenuePolicy> {
  const moduleName = normalizeRevenueModule(inputModule);
  if (!moduleName) throw new Error("Invalid module name");
  const revenueModel = normalizeRevenueModel(input.revenueModel);
  const subscriptionRequired = revenueModel === "subscription" || revenueModel === "hybrid" || input.subscriptionRequired === true;
  await rawDb.execute(rawSql`
    INSERT INTO service_revenue_config
      (module_name, revenue_model, commission_percentage, commission_gst_percentage, subscription_required, is_active, notes, updated_at)
    VALUES
      (${moduleName}, ${revenueModel}, ${input.commissionPercentage ?? DEFAULT_POLICY[moduleName].commissionPercentage}::numeric,
       ${input.commissionGstPercentage ?? DEFAULT_POLICY[moduleName].commissionGstPercentage}::numeric,
       ${subscriptionRequired}::boolean, ${input.isActive ?? true}::boolean, ${input.notes || null}, NOW())
    ON CONFLICT (module_name) DO UPDATE SET
      revenue_model             = EXCLUDED.revenue_model,
      commission_percentage     = EXCLUDED.commission_percentage,
      commission_gst_percentage = EXCLUDED.commission_gst_percentage,
      subscription_required     = EXCLUDED.subscription_required,
      is_active                 = EXCLUDED.is_active,
      notes                     = EXCLUDED.notes,
      updated_at                = NOW()
  `);
  await rawDb.execute(rawSql`
    DELETE FROM service_revenue_config
    WHERE module_name IN ('rides', 'parcels', 'cargo', 'city_pool', 'local_pool', 'pool', 'outstation_pool', 'b2b_parcel')
  `).catch(() => undefined);
  const policy = await getRevenueModulePolicy(moduleName);
  await syncLegacyModelKeys(policy);
  await syncPlatformServices(policy);
  return policy;
}

export async function reconcileRevenueModuleAliases(): Promise<void> {
  const rows = await rawDb.execute(rawSql`
    SELECT * FROM service_revenue_config
    WHERE module_name IN ('rides', 'parcels', 'cargo', 'city_pool', 'local_pool', 'pool', 'outstation_pool', 'b2b_parcel')
    ORDER BY updated_at DESC NULLS LAST
  `).catch(() => ({ rows: [] as any[] }));
  for (const row of rows.rows as any[]) {
    const moduleName = normalizeRevenueModule(row.module_name);
    if (!moduleName) continue;
    await upsertRevenueModuleConfig(moduleName, {
      revenueModel: normalizeRevenueModel(row.revenue_model),
      commissionPercentage: Number(row.commission_percentage ?? DEFAULT_POLICY[moduleName].commissionPercentage),
      commissionGstPercentage: Number(row.commission_gst_percentage ?? DEFAULT_POLICY[moduleName].commissionGstPercentage),
      subscriptionRequired: row.subscription_required === true || row.subscription_required === "true",
      isActive: row.is_active !== false && row.is_active !== "false",
      notes: row.notes ?? null,
    }).catch(() => undefined);
  }
  await rawDb.execute(rawSql`
    DELETE FROM service_revenue_config
    WHERE module_name IN ('rides', 'parcels', 'cargo', 'city_pool', 'local_pool', 'pool', 'outstation_pool', 'b2b_parcel')
  `).catch(() => undefined);
}

export async function syncAllRevenueModuleConfigs(): Promise<void> {
  const policies = await listRevenueModuleConfigs();
  for (const policy of policies) {
    await syncLegacyModelKeys(policy);
    await syncPlatformServices(policy);
  }
}

function isParcelTripType(tripType: unknown): boolean {
  const tt = String(tripType || "").toLowerCase();
  return tt === "parcel" || tt === "delivery" || tt === "cargo";
}

/** Load rides_model from revenue_model_settings (defaults to commission). */
export async function getRidesRevenueModel(): Promise<string> {
  const r = await rawDb.execute(rawSql`
    SELECT value FROM revenue_model_settings WHERE key_name='rides_model' LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  return String((r.rows[0] as any)?.value || "commission").toLowerCase();
}

/** P0 gate: ride trips require active subscription when rides_model is subscription/hybrid. */
export async function assertDriverCanAcceptRideTrip(driverId: string, tripType?: unknown): Promise<void> {
  if (isParcelTripType(tripType)) return;
  const ridesModel = await getRidesRevenueModel();
  if (!["subscription", "hybrid"].includes(ridesModel)) return;
  const hasSubscription = await driverHasActiveSubscription(driverId);
  if (!hasSubscription) {
    const err: any = new Error("Active subscription required to accept rides. Please subscribe to continue.");
    err.statusCode = 403;
    err.code = "SUBSCRIPTION_REQUIRED";
    throw err;
  }
}

export async function driverHasActiveSubscription(driverId: string): Promise<boolean> {
  const freeR = await rawDb.execute(rawSql`
    SELECT launch_free_active, free_period_end
    FROM users
    WHERE id = ${driverId}::uuid
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const free = freeR.rows[0] as any;
  if (free?.launch_free_active === true && free?.free_period_end && new Date(free.free_period_end) >= new Date()) {
    return true;
  }
  const subR = await rawDb.execute(rawSql`
    SELECT id
    FROM driver_subscriptions
    WHERE driver_id = ${driverId}::uuid
      AND is_active = true
      AND end_date >= CURRENT_DATE
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  return subR.rows.length > 0;
}

export async function enforceDriverRevenuePolicy(driverId: string, moduleOrAlias: unknown): Promise<RevenuePolicy> {
  const policy = await getRevenueModulePolicy(moduleOrAlias);
  if (!policy.isActive) {
    const err: any = new Error(`${policy.moduleName} service is currently disabled`);
    err.statusCode = 403;
    err.code = "SERVICE_DISABLED";
    throw err;
  }
  if (policy.subscriptionRequired || policy.revenueModel === "subscription" || policy.revenueModel === "hybrid") {
    const hasSubscription = await driverHasActiveSubscription(driverId);
    if (!hasSubscription) {
      const err: any = new Error("Active subscription required for this service. Please purchase or renew your subscription.");
      err.statusCode = 403;
      err.code = "SUBSCRIPTION_REQUIRED";
      err.moduleName = policy.moduleName;
      throw err;
    }
  }
  return policy;
}
