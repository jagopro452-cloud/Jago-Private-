import { db } from "./db";
import { sql } from "drizzle-orm";

const rawDb = db;
const rawSql = sql;

export type RevenueModel = "commission" | "subscription" | "hybrid" | "free";

export interface RevenueConfig {
  service: string;
  model: RevenueModel;
  commissionPercent: number;
  gstPercent: number;
}

const DEFAULT_REVENUE_CONFIG: Record<string, RevenueConfig> = {
  ride: { service: "ride", model: "commission", commissionPercent: 15, gstPercent: 18 },
  parcel: { service: "parcel", model: "commission", commissionPercent: 15, gstPercent: 18 },
  b2b_parcel: { service: "b2b_parcel", model: "commission", commissionPercent: 15, gstPercent: 18 },
  cargo: { service: "cargo", model: "commission", commissionPercent: 15, gstPercent: 18 },
  intercity: { service: "intercity", model: "commission", commissionPercent: 15, gstPercent: 18 },
  city_pool: { service: "city_pool", model: "commission", commissionPercent: 15, gstPercent: 18 },
  outstation_pool: { service: "outstation_pool", model: "commission", commissionPercent: 15, gstPercent: 18 },
};

let cache: { value: Record<string, RevenueConfig>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000;

const MODEL_KEY_MAP: Record<string, string> = {
  ride: "rides_model",
  parcel: "parcels_model",
  b2b_parcel: "parcels_model",
  cargo: "cargo_model",
  intercity: "intercity_model",
  city_pool: "city_pool_model",
  outstation_pool: "outstation_pool_model",
};

function normalizeRevenueModel(value: string | undefined): RevenueModel {
  if (value === "subscription" || value === "hybrid" || value === "commission") return value;
  if (value === "launch_free" || value === "free") return "free";
  return "commission";
}

export async function loadRevenueConfigMap(): Promise<Record<string, RevenueConfig>> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  const settings = await rawDb.execute(rawSql`
    SELECT key_name, value
    FROM revenue_model_settings
    WHERE key_name IN (
      'rides_model', 'parcels_model', 'cargo_model', 'intercity_model',
      'city_pool_model', 'outstation_pool_model',
      'commission_pct', 'hybrid_commission_pct', 'commission_gst_on_comm'
    )
  `).catch(() => ({ rows: [] as any[] }));

  const s: Record<string, string> = {};
  for (const row of settings.rows as any[]) s[String(row.key_name)] = String(row.value);

  const result: Record<string, RevenueConfig> = {};
  for (const [service, defaults] of Object.entries(DEFAULT_REVENUE_CONFIG)) {
    const modelKey = MODEL_KEY_MAP[service] || "rides_model";
    const model = normalizeRevenueModel(s[modelKey]);
    const commissionPercent = model === "hybrid"
      ? parseFloat(s.hybrid_commission_pct || String(defaults.commissionPercent))
      : parseFloat(s.commission_pct || String(defaults.commissionPercent));
    const gstPercent = parseFloat(s.commission_gst_on_comm || String(defaults.gstPercent));
    result[service] = {
      service,
      model,
      commissionPercent: Number.isFinite(commissionPercent) ? commissionPercent : defaults.commissionPercent,
      gstPercent: Number.isFinite(gstPercent) ? gstPercent : defaults.gstPercent,
    };
  }

  cache = { value: result, expiresAt: Date.now() + CACHE_TTL_MS };
  return result;
}

export async function getRevenueConfig(service: string): Promise<RevenueConfig> {
  const map = await loadRevenueConfigMap();
  return map[service] || map.ride || DEFAULT_REVENUE_CONFIG.ride;
}
