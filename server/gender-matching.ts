/**
 * Female driver priority matching.
 * Female customers (or those who prefer women drivers) get nearby female pilots first;
 * if none are available, any eligible pilot may be assigned.
 */

import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";

let cachedSetting: { enabled: boolean; at: number } | null = null;
const SETTING_CACHE_MS = 60_000;

export async function isFemaleDriverPriorityEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cachedSetting && now - cachedSetting.at < SETTING_CACHE_MS) {
    return cachedSetting.enabled;
  }
  try {
    const r = await rawDb.execute(rawSql`
      SELECT value FROM business_settings WHERE key_name = 'female_to_female_matching' LIMIT 1
    `);
    const enabled = r.rows.length
      ? String((r.rows[0] as any).value ?? "1") === "1"
      : true;
    cachedSetting = { enabled, at: now };
    return enabled;
  } catch {
    return true;
  }
}

export function shouldPrioritizeFemaleDrivers(input: {
  settingEnabled: boolean;
  customerGender?: string | null;
  preferredDriverGender?: string | null;
  preferFemaleDriver?: boolean;
}): boolean {
  if (!input.settingEnabled) return false;
  const pref = String(input.preferredDriverGender || "").toLowerCase();
  if (pref === "male") return false;
  if (pref === "female") return true;
  if (input.preferFemaleDriver) return true;
  if (String(input.customerGender || "").toLowerCase() === "female") return true;
  return false;
}

export function normalizeGender(value: unknown): "male" | "female" | "other" | null {
  const g = String(value || "").trim().toLowerCase();
  if (g === "male" || g === "female" || g === "other") return g;
  return null;
}

export function sortDriversByGenderPriority<T extends {
  driverGender?: string | null;
  distanceKm?: number;
  score?: number;
}>(drivers: T[], prioritizeFemale: boolean): T[] {
  if (!prioritizeFemale || drivers.length <= 1) return drivers;
  return [...drivers].sort((a, b) => {
    const aFemale = String(a.driverGender || "").toLowerCase() === "female" ? 0 : 1;
    const bFemale = String(b.driverGender || "").toLowerCase() === "female" ? 0 : 1;
    if (aFemale !== bFemale) return aFemale - bFemale;
    const aDist = Number(a.distanceKm ?? 999);
    const bDist = Number(b.distanceKm ?? 999);
    if (aDist !== bDist) return aDist - bDist;
    return (Number(b.score) || 0) - (Number(a.score) || 0);
  });
}
