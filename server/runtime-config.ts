import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { assertSchemaObjectsOrThrow } from "./schema-health";
import { featureFlags } from "./config/featureFlags";

type RuntimeScope = "global" | "city" | "service" | "vehicle" | "feature";

export interface RuntimeConfigSnapshot {
  version: string;
  generatedAt: string;
  precedence: string[];
  services: any[];
  cityServices: any[];
  parcelVehicles: any[];
  businessSettings: Record<string, string>;
  revenueSettings: Record<string, string>;
  featureFlags: Record<string, boolean>;
  runtimeOverrides: any[];
  effectiveConfig: {
    global: Record<string, any>;
    city: Record<string, Record<string, any>>;
    service: Record<string, Record<string, any>>;
    vehicle: Record<string, Record<string, any>>;
  };
}

export interface RuntimeConfigResolutionContext {
  cityKey?: string | null;
  serviceKey?: string | null;
  vehicleKey?: string | null;
}

const SNAPSHOT_CACHE_KEY = "runtime_config_snapshot:v1";
let memorySnapshot: RuntimeConfigSnapshot | null = null;
let memorySnapshotAt = 0;

async function getRedis(): Promise<any | null> {
  try {
    const { default: IORedis } = await import("ioredis");
    const url = process.env.REDIS_URL;
    if (!url) return null;
    return new IORedis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
    });
  } catch {
    return null;
  }
}

export async function initRuntimeConfigTables(): Promise<void> {
  await assertSchemaObjectsOrThrow({
    tables: ["runtime_config_entries", "runtime_config_audit_logs"],
  });
}

function parseRowValue(row: any): any {
  const raw = row?.config_value;
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return raw;
  }
}

function toKV(rows: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) out[String(row.key_name)] = String(row.value ?? "");
  return out;
}

const APP_SAFE_BUSINESS_SETTING_KEYS = [
  "otp_on_pickup",
  "max_ride_radius_km",
  "driver_auto_accept",
  "sos_number",
  "support_phone",
  "currency",
  "currency_symbol",
  "maintenance_mode",
  "force_update",
  "customer_app_version",
  "driver_app_version",
  "female_to_female_matching",
  "vehicle_type_matching",
  "service_ride_enabled",
  "service_parcel_enabled",
  "service_cargo_enabled",
  "service_intercity_enabled",
  "service_carsharing_enabled",
];

const BOOLEAN_KEYS = new Set([
  "maintenance_mode",
  "force_update",
  "driver_auto_accept",
  "service_ride_enabled",
  "service_parcel_enabled",
  "service_cargo_enabled",
  "service_intercity_enabled",
  "service_carsharing_enabled",
  "pool_enabled",
  "parcel_enabled",
  "rides_enabled",
  "subscriptions_enabled",
]);

const PERCENT_KEYS = new Set([
  "commission_rate",
  "driver_commission_pct",
  "ride_gst_rate",
  "hybrid_commission_pct",
  "surge_multiplier",
]);

function normalizeBool(value: any): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (["true", "1", "yes", "on", "active", "enabled"].includes(lower)) return true;
    if (["false", "0", "no", "off", "inactive", "disabled"].includes(lower)) return false;
  }
  if (typeof value === "number") return value !== 0;
  return null;
}

function validateRuntimeEntry(key: string, value: any) {
  if (!key.trim()) {
    throw new Error("Config key cannot be empty");
  }

  if (BOOLEAN_KEYS.has(key)) {
    const parsed = normalizeBool(value);
    if (parsed == null) throw new Error(`${key} must be a boolean`);
    return parsed;
  }

  if (PERCENT_KEYS.has(key)) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`${key} must be numeric`);
    if (parsed < 0 || parsed > 1000) throw new Error(`${key} out of allowed range`);
    return parsed;
  }

  if (key.endsWith("_radius_km") || key === "max_ride_radius_km") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 500) {
      throw new Error(`${key} must be between 0 and 500`);
    }
    return parsed;
  }

  if (key.endsWith("_version")) {
    const parsed = String(value || "").trim();
    if (!parsed) throw new Error(`${key} cannot be blank`);
    return parsed;
  }

  return value;
}

function buildEffectiveConfig(overrides: Array<{
  scopeType: string;
  scopeKey: string;
  configKey: string;
  configValue: any;
}>) {
  const effective = {
    global: {} as Record<string, any>,
    city: {} as Record<string, Record<string, any>>,
    service: {} as Record<string, Record<string, any>>,
    vehicle: {} as Record<string, Record<string, any>>,
  };

  for (const row of overrides) {
    const scopeKey = String(row.scopeKey || "default").trim().toLowerCase();
    const configKey = String(row.configKey || "").trim();
    if (!configKey) continue;
    if (row.scopeType === "global") {
      effective.global[configKey] = row.configValue;
      continue;
    }
    if (row.scopeType === "city") {
      effective.city[scopeKey] ||= {};
      effective.city[scopeKey][configKey] = row.configValue;
      continue;
    }
    if (row.scopeType === "service") {
      effective.service[scopeKey] ||= {};
      effective.service[scopeKey][configKey] = row.configValue;
      continue;
    }
    if (row.scopeType === "vehicle") {
      effective.vehicle[scopeKey] ||= {};
      effective.vehicle[scopeKey][configKey] = row.configValue;
    }
  }

  return effective;
}

export function resolveRuntimeConfigContext(
  snapshot: RuntimeConfigSnapshot,
  context: RuntimeConfigResolutionContext,
): Record<string, any> {
  const resolved = { ...(snapshot.effectiveConfig.global || {}) };
  const cityKey = String(context.cityKey || "").trim().toLowerCase();
  const serviceKey = String(context.serviceKey || "").trim().toLowerCase();
  const vehicleKey = String(context.vehicleKey || "").trim().toLowerCase();

  if (cityKey && snapshot.effectiveConfig.city[cityKey]) {
    Object.assign(resolved, snapshot.effectiveConfig.city[cityKey]);
  }
  if (serviceKey && snapshot.effectiveConfig.service[serviceKey]) {
    Object.assign(resolved, snapshot.effectiveConfig.service[serviceKey]);
  }
  if (vehicleKey && snapshot.effectiveConfig.vehicle[vehicleKey]) {
    Object.assign(resolved, snapshot.effectiveConfig.vehicle[vehicleKey]);
  }

  return resolved;
}

function enforceRuntimeDependencies(entries: Array<{ key: string; value: any }>) {
  const normalized = new Map(entries.map((entry) => [entry.key, entry.value]));
  const poolEnabled = normalized.has("pool_enabled") ? normalizeBool(normalized.get("pool_enabled")) : null;
  const ridesEnabled = normalized.has("rides_enabled") ? normalizeBool(normalized.get("rides_enabled")) : null;
  const parcelEnabled = normalized.has("parcel_enabled") ? normalizeBool(normalized.get("parcel_enabled")) : null;
  const subscriptionsEnabled = normalized.has("subscriptions_enabled") ? normalizeBool(normalized.get("subscriptions_enabled")) : null;

  if (poolEnabled === true && ridesEnabled === false) {
    throw new Error("pool_enabled cannot be true when rides_enabled is false");
  }
  if (parcelEnabled === true && normalized.get("service_parcel_enabled") === false) {
    throw new Error("parcel_enabled cannot be true when service_parcel_enabled is false");
  }
  if (subscriptionsEnabled === true && normalized.has("commission_rate") && Number(normalized.get("commission_rate")) < 0) {
    throw new Error("subscriptions_enabled dependency failed due to invalid commission configuration");
  }
}

export async function invalidateRuntimeConfigCache(): Promise<void> {
  memorySnapshot = null;
  memorySnapshotAt = 0;
  const redis = await getRedis();
  if (redis) {
    try { await redis.del(SNAPSHOT_CACHE_KEY); } catch {}
    try { await redis.quit(); } catch {}
  }
}

export async function getRuntimeConfigSnapshot(forceFresh = false): Promise<RuntimeConfigSnapshot> {
  if (!forceFresh && memorySnapshot && Date.now() - memorySnapshotAt < 10_000) {
    return memorySnapshot;
  }

  if (!forceFresh) {
    const redis = await getRedis();
    if (redis) {
      try {
        const cached = await redis.get(SNAPSHOT_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as RuntimeConfigSnapshot;
          memorySnapshot = parsed;
          memorySnapshotAt = Date.now();
          await redis.quit().catch(() => {});
          return parsed;
        }
      } catch {}
      try { await redis.quit(); } catch {}
    }
  }

  const [servicesR, cityServicesR, parcelVehiclesR, businessR, revenueR, overridesR] = await Promise.all([
    rawDb.execute(rawSql`
      SELECT service_key, service_name, service_category, service_status, revenue_model,
             commission_rate, sort_order, icon, color, description, image_url, short_description, eta_label, updated_at
      FROM platform_services
      ORDER BY sort_order ASC
    `).catch(() => ({ rows: [] as any[] })),
    rawDb.execute(rawSql`
      SELECT city_name, service_key, is_active, radius_km, city_lat, city_lng, updated_at
      FROM city_services
      ORDER BY city_name ASC, service_key ASC
    `).catch(() => ({ rows: [] as any[] })),
    rawDb.execute(rawSql`
      SELECT vehicle_key, name, subtitle, image_url, max_weight_kg, is_active, sort_order, base_fare, per_km, per_kg, load_charge, updated_at
      FROM parcel_vehicle_types
      ORDER BY sort_order ASC, name ASC
    `).catch(() => ({ rows: [] as any[] })),
    rawDb.execute(rawSql`
      SELECT key_name, value
      FROM business_settings
      WHERE key_name = ANY(${APP_SAFE_BUSINESS_SETTING_KEYS})
      ORDER BY key_name ASC
    `).catch(() => ({ rows: [] as any[] })),
    rawDb.execute(rawSql`
      SELECT key_name, value
      FROM revenue_model_settings
      ORDER BY key_name ASC
    `).catch(() => ({ rows: [] as any[] })),
    rawDb.execute(rawSql`
      SELECT scope_type, scope_key, config_key, config_value, description, updated_by, updated_at
      FROM runtime_config_entries
      ORDER BY updated_at DESC
    `).catch(() => ({ rows: [] as any[] })),
  ]);

  const latestTs = [
    ...(servicesR.rows as any[]).map((r: any) => r.updated_at),
    ...(cityServicesR.rows as any[]).map((r: any) => r.updated_at),
    ...(parcelVehiclesR.rows as any[]).map((r: any) => r.updated_at),
    ...(overridesR.rows as any[]).map((r: any) => r.updated_at),
  ]
    .filter(Boolean)
    .map((v: any) => new Date(v).getTime());

  const snapshot: RuntimeConfigSnapshot = {
    version: String(Math.max(...latestTs, Date.now())),
    generatedAt: new Date().toISOString(),
    precedence: [
      "runtime_override",
      "city_override",
      "service_override",
      "vehicle_override",
      "global_default",
    ],
    services: servicesR.rows as any[],
    cityServices: cityServicesR.rows as any[],
    parcelVehicles: parcelVehiclesR.rows as any[],
    businessSettings: toKV(businessR.rows as any[]),
    revenueSettings: toKV(revenueR.rows as any[]),
    featureFlags: { ...featureFlags },
    runtimeOverrides: (overridesR.rows as any[]).map((row: any) => ({
      scopeType: row.scope_type,
      scopeKey: row.scope_key,
      configKey: row.config_key,
      configValue: parseRowValue(row),
      description: row.description,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    })),
    effectiveConfig: buildEffectiveConfig((overridesR.rows as any[]).map((row: any) => ({
      scopeType: row.scope_type,
      scopeKey: row.scope_key,
      configKey: row.config_key,
      configValue: parseRowValue(row),
    }))),
  };

  memorySnapshot = snapshot;
  memorySnapshotAt = Date.now();

  const redis = await getRedis();
  if (redis) {
    try {
      await redis.set(SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot), "EX", 60);
    } catch {}
    try { await redis.quit(); } catch {}
  }

  return snapshot;
}

export async function upsertRuntimeConfigEntries(input: {
  scopeType?: RuntimeScope;
  scopeKey?: string;
  entries: Array<{ key: string; value: any; description?: string }>;
  updatedBy?: string;
  reason?: string;
}): Promise<RuntimeConfigSnapshot> {
  const scopeType = input.scopeType || "global";
  const scopeKey = input.scopeKey || "default";
  const normalizedEntries = input.entries.map((entry) => ({
    key: String(entry.key || "").trim(),
    value: validateRuntimeEntry(String(entry.key || "").trim(), entry.value),
    description: entry.description,
  })).filter((entry) => entry.key);

  enforceRuntimeDependencies(normalizedEntries);

  for (const entry of normalizedEntries) {
    const existing = await rawDb.execute(rawSql`
      SELECT config_value
      FROM runtime_config_entries
      WHERE scope_type = ${scopeType}
        AND scope_key = ${scopeKey}
        AND config_key = ${entry.key}
      LIMIT 1
    `).catch(() => ({ rows: [] as any[] }));

    const prev = existing.rows.length ? parseRowValue(existing.rows[0]) : null;

    await rawDb.execute(rawSql`
      INSERT INTO runtime_config_entries
        (scope_type, scope_key, config_key, config_value, description, updated_by, updated_at)
      VALUES
        (${scopeType}, ${scopeKey}, ${entry.key}, ${JSON.stringify(entry.value)}::jsonb, ${entry.description || null}, ${input.updatedBy || null}, NOW())
      ON CONFLICT (scope_type, scope_key, config_key)
      DO UPDATE SET
        config_value = EXCLUDED.config_value,
        description = COALESCE(EXCLUDED.description, runtime_config_entries.description),
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
    `);

    await rawDb.execute(rawSql`
      INSERT INTO runtime_config_audit_logs
        (scope_type, scope_key, config_key, previous_value, next_value, reason, updated_by)
      VALUES
        (${scopeType}, ${scopeKey}, ${entry.key}, ${prev == null ? null : JSON.stringify(prev)}::jsonb, ${JSON.stringify(entry.value)}::jsonb, ${input.reason || null}, ${input.updatedBy || null})
    `).catch(() => {});
  }

  await invalidateRuntimeConfigCache();
  return getRuntimeConfigSnapshot(true);
}

export async function listRuntimeConfigAuditLogs(limit = 50): Promise<any[]> {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const result = await rawDb.execute(rawSql`
    SELECT id, scope_type, scope_key, config_key, previous_value, next_value, reason, updated_by, created_at
    FROM runtime_config_audit_logs
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  `).catch(() => ({ rows: [] as any[] }));

  return (result.rows as any[]).map((row: any) => ({
    id: row.id,
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    configKey: row.config_key,
    previousValue: row.previous_value,
    nextValue: row.next_value,
    reason: row.reason,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
  }));
}

export async function rollbackRuntimeConfigAuditLog(input: {
  auditLogId: string;
  updatedBy?: string;
}): Promise<RuntimeConfigSnapshot> {
  const audit = await rawDb.execute(rawSql`
    SELECT id, scope_type, scope_key, config_key, previous_value
    FROM runtime_config_audit_logs
    WHERE id = ${input.auditLogId}::uuid
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));

  const row = audit.rows[0] as any;
  if (!row) throw new Error("Audit log not found");

  const previousValue = row.previous_value;
  if (previousValue == null) {
    await rawDb.execute(rawSql`
      DELETE FROM runtime_config_entries
      WHERE scope_type = ${row.scope_type}
        AND scope_key = ${row.scope_key}
        AND config_key = ${row.config_key}
    `);
    await rawDb.execute(rawSql`
      INSERT INTO runtime_config_audit_logs
        (scope_type, scope_key, config_key, previous_value, next_value, reason, updated_by)
      VALUES
        (${row.scope_type}, ${row.scope_key}, ${row.config_key}, ${JSON.stringify(previousValue)}::jsonb, 'null'::jsonb, 'rollback_delete', ${input.updatedBy || null})
    `).catch(() => {});
  } else {
    await upsertRuntimeConfigEntries({
      scopeType: row.scope_type,
      scopeKey: row.scope_key,
      entries: [{ key: row.config_key, value: previousValue }],
      updatedBy: input.updatedBy,
      reason: "rollback_restore",
    });
  }

  await invalidateRuntimeConfigCache();
  return getRuntimeConfigSnapshot(true);
}
