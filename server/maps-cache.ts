/**
 * Google Maps API Optimization — Route, Distance, Polyline Caching
 *
 * Reduces excessive Google Maps API calls using:
 * 1. In-memory LRU cache (fast, volatile)
 * 2. Database persistence (durable, cross-restart)
 * 3. Haversine fallback when API fails
 *
 * Cached:
 * - Geocode results (address → lat/lng)
 * - Distance/duration between two points
 * - Route polylines
 * - Directions API responses
 */

import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { assertSchemaObjectsOrThrow } from "./schema-health";

// ── In-memory LRU cache ──────────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly defaultTTL: number;

  constructor(maxSize: number, defaultTTLMs: number) {
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTLMs;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    if (this.cache.size >= this.maxSize) {
      // Delete oldest (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs || this.defaultTTL),
    });
  }

  get size(): number { return this.cache.size; }
  clear(): void { this.cache.clear(); }
}

// Cache instances
const geocodeCache = new LRUCache<GeocodeResult>(3000, 30 * 60 * 1000);   // 30 min
const distanceCache = new LRUCache<DistanceResult>(5000, 15 * 60 * 1000); // 15 min
const routeCache = new LRUCache<RouteResult>(2000, 10 * 60 * 1000);       // 10 min

// ── Types ────────────────────────────────────────────────────────────────────

export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

export interface DistanceResult {
  distanceKm: number;
  durationMinutes: number;
  source: "google" | "haversine" | "cache";
}

export interface RouteResult {
  polyline: string;           // encoded polyline
  distanceKm: number;
  durationMinutes: number;
  steps: RouteStep[];
  source: "google" | "cache";
}

export interface RouteStep {
  instruction: string;
  distanceKm: number;
  durationMinutes: number;
}

// ── API key helper ───────────────────────────────────────────────────────────

let cachedApiKey: string | null = null;
let apiKeyFetchedAt = 0;

async function getGoogleMapsKey(): Promise<string | null> {
  // Cache key for 5 minutes
  if (cachedApiKey && Date.now() - apiKeyFetchedAt < 5 * 60 * 1000) return cachedApiKey;

  try {
    const r = await rawDb.execute(rawSql`
      SELECT value FROM business_settings WHERE key_name IN ('google_maps_key', 'GOOGLE_MAPS_API_KEY') LIMIT 1
    `);
    const val = (r.rows[0] as any)?.value?.trim();
    if (val) {
      cachedApiKey = val;
      apiKeyFetchedAt = Date.now();
      return cachedApiKey;
    }

    const envKey = process.env.GOOGLE_MAPS_API_KEY;
    if (envKey) {
      cachedApiKey = envKey;
      apiKeyFetchedAt = Date.now();
      return cachedApiKey;
    }
    return cachedApiKey;
  } catch {
    return cachedApiKey;
  }
}

// ── 1. GEOCODING with cache ─────────────────────────────────────────────────

/**
 * Geocode an address with multi-layer caching.
 * Memory cache → DB cache → Google API → null
 */
export async function geocodeWithCache(address: string): Promise<GeocodeResult | null> {
  const normalized = (address || "").trim().toLowerCase();
  if (!normalized) return null;

  const cacheKey = `geo:${normalized}`;

  // Layer 1: Memory cache
  const memCached = geocodeCache.get(cacheKey);
  if (memCached) return memCached;

  // Layer 2: DB cache
  try {
    const dbResult = await rawDb.execute(rawSql`
      SELECT lat, lng, formatted_address FROM maps_cache
      WHERE cache_type = 'geocode' AND cache_key = ${normalized}
        AND expires_at > NOW()
      LIMIT 1
    `);
    if (dbResult.rows.length) {
      const r = dbResult.rows[0] as any;
      const result: GeocodeResult = {
        lat: Number(r.lat),
        lng: Number(r.lng),
        formattedAddress: r.formatted_address || address,
      };
      geocodeCache.set(cacheKey, result);
      return result;
    }
  } catch { /* DB cache miss, continue */ }

  // Layer 3: Google API
  const apiKey = await getGoogleMapsKey();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const r = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Referer': 'https://jagopro.org' }
    });
    if (!r.ok) return null;
    const data = await r.json() as any;
    if (data?.status !== "OK" || !data.results?.length) return null;

    const loc = data.results[0]?.geometry?.location;
    if (!loc || !Number.isFinite(loc.lat)) return null;

    const result: GeocodeResult = {
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      formattedAddress: data.results[0]?.formatted_address || address,
    };

    // Cache in memory
    geocodeCache.set(cacheKey, result);

    // Cache in DB (30 min TTL)
    persistToDbCache("geocode", normalized, result.lat, result.lng, result.formattedAddress, null, 30);

    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── 2. DISTANCE with cache + Haversine fallback ────────────────────────────

/**
 * Get distance/duration between two points.
 * Memory cache → DB cache → Google Distance Matrix → Haversine fallback
 */
export async function getDistanceWithCache(
  originLat: number, originLng: number,
  destLat: number, destLng: number
): Promise<DistanceResult> {
  const cacheKey = `dist:${originLat.toFixed(4)},${originLng.toFixed(4)}:${destLat.toFixed(4)},${destLng.toFixed(4)}`;

  // Layer 1: Memory
  const memCached = distanceCache.get(cacheKey);
  if (memCached) return { ...memCached, source: "cache" };

  // Layer 2: DB cache
  try {
    const dbResult = await rawDb.execute(rawSql`
      SELECT distance_km, duration_min FROM maps_cache
      WHERE cache_type = 'distance' AND cache_key = ${cacheKey}
        AND expires_at > NOW()
      LIMIT 1
    `);
    if (dbResult.rows.length) {
      const r = dbResult.rows[0] as any;
      const result: DistanceResult = {
        distanceKm: Number(r.distance_km),
        durationMinutes: Number(r.duration_min),
        source: "cache",
      };
      distanceCache.set(cacheKey, result);
      return result;
    }
  } catch { /* DB miss */ }

  // Layer 3: Google Distance Matrix API
  const apiKey = await getGoogleMapsKey();
  if (apiKey) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originLat},${originLng}&destinations=${destLat},${destLng}&key=${apiKey}`;
      const r = await fetch(url, { 
        signal: controller.signal,
        headers: { 'Referer': 'https://jagopro.org' }
      });
      if (r.ok) {
        const data = await r.json() as any;
        const element = data?.rows?.[0]?.elements?.[0];
        if (element?.status === "OK") {
          const result: DistanceResult = {
            distanceKm: Math.round((element.distance.value / 1000) * 100) / 100,
            durationMinutes: Math.round(element.duration.value / 60),
            source: "google",
          };
          distanceCache.set(cacheKey, result);
          persistToDbCache("distance", cacheKey, originLat, originLng, null, JSON.stringify({
            distance_km: result.distanceKm,
            duration_min: result.durationMinutes,
          }), 15);
          return result;
        }
      }
    } catch { /* API failed */ }
    finally { clearTimeout(timeout); }
  }

  // Layer 4: Haversine fallback
  return haversineFallback(originLat, originLng, destLat, destLng);
}

// ── 3. ROUTE / POLYLINE with cache ──────────────────────────────────────────

/**
 * Get directions route with polyline.
 * Memory cache → DB cache → Google Directions API → null
 */
export async function getRouteWithCache(
  originLat: number, originLng: number,
  destLat: number, destLng: number
): Promise<RouteResult | null> {
  const cacheKey = `route:${originLat.toFixed(4)},${originLng.toFixed(4)}:${destLat.toFixed(4)},${destLng.toFixed(4)}`;

  // Layer 1: Memory
  const memCached = routeCache.get(cacheKey);
  if (memCached) return { ...memCached, source: "cache" };

  // Layer 2: DB
  try {
    const dbResult = await rawDb.execute(rawSql`
      SELECT data_json FROM maps_cache
      WHERE cache_type = 'route' AND cache_key = ${cacheKey}
        AND expires_at > NOW()
      LIMIT 1
    `);
    if (dbResult.rows.length) {
      const r = dbResult.rows[0] as any;
      const parsed = typeof r.data_json === "string" ? JSON.parse(r.data_json) : r.data_json;
      const result: RouteResult = { ...parsed, source: "cache" };
      routeCache.set(cacheKey, result);
      return result;
    }
  } catch { /* DB miss */ }

  // Layer 3: Google Directions API
  const apiKey = await getGoogleMapsKey();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&key=${apiKey}`;
    const r = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Referer': 'https://jagopro.org' }
    });
    if (!r.ok) return null;
    const data = await r.json() as any;

    if (data?.status !== "OK" || !data.routes?.length) return null;

    const route = data.routes[0];
    const leg = route.legs?.[0];

    const result: RouteResult = {
      polyline: route.overview_polyline?.points || "",
      distanceKm: Math.round((leg?.distance?.value || 0) / 1000 * 100) / 100,
      durationMinutes: Math.round((leg?.duration?.value || 0) / 60),
      steps: (leg?.steps || []).slice(0, 20).map((s: any) => ({
        instruction: (s.html_instructions || "").replace(/<[^>]*>/g, ""),
        distanceKm: Math.round((s.distance?.value || 0) / 1000 * 100) / 100,
        durationMinutes: Math.round((s.duration?.value || 0) / 60),
      })),
      source: "google",
    };

    routeCache.set(cacheKey, result);
    persistToDbCache("route", cacheKey, originLat, originLng, null, JSON.stringify({
      polyline: result.polyline,
      distanceKm: result.distanceKm,
      durationMinutes: result.durationMinutes,
      steps: result.steps,
    }), 10);

    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Haversine fallback ───────────────────────────────────────────────────────

function haversineFallback(
  lat1: number, lng1: number, lat2: number, lng2: number
): DistanceResult {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const distKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  // Estimate duration: assume 25 km/h in city
  const durationMin = Math.round((distKm / 25) * 60);

  return {
    distanceKm: Math.round(distKm * 100) / 100,
    durationMinutes: durationMin,
    source: "haversine",
  };
}

// ── DB persistence layer ────────────────────────────────────────────────────

function persistToDbCache(
  cacheType: string,
  cacheKey: string,
  lat: number,
  lng: number,
  formattedAddr: string | null,
  dataJson: string | null,
  ttlMinutes: number
): void {
  rawDb.execute(rawSql`
    INSERT INTO maps_cache (cache_type, cache_key, lat, lng, formatted_address, data_json, distance_km, duration_min, expires_at)
    VALUES (
      ${cacheType}, ${cacheKey}, ${lat}, ${lng}, ${formattedAddr},
      ${dataJson}::jsonb, 
      ${dataJson ? (JSON.parse(dataJson).distance_km || null) : null},
      ${dataJson ? (JSON.parse(dataJson).duration_min || null) : null},
      NOW() + INTERVAL '${rawSql.raw(String(ttlMinutes))} minutes'
    )
    ON CONFLICT (cache_type, cache_key) DO UPDATE SET
      lat = EXCLUDED.lat, lng = EXCLUDED.lng,
      formatted_address = EXCLUDED.formatted_address,
      data_json = EXCLUDED.data_json,
      distance_km = EXCLUDED.distance_km,
      duration_min = EXCLUDED.duration_min,
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW()
  `).catch((e) => console.error("[MAPS-CACHE] DB persist error:", e.message));
}

// ── Cache stats ─────────────────────────────────────────────────────────────

export function getCacheStats() {
  return {
    geocode: { memoryEntries: geocodeCache.size },
    distance: { memoryEntries: distanceCache.size },
    route: { memoryEntries: routeCache.size },
  };
}

/**
 * Clear all in-memory caches.
 */
export function clearAllCaches(): void {
  geocodeCache.clear();
  distanceCache.clear();
  routeCache.clear();
}

// ── DB table initialization ─────────────────────────────────────────────────

export async function initMapsCacheTables(): Promise<void> {
  try {
    await assertSchemaObjectsOrThrow({
      tables: ["maps_cache"],
    });

    await rawDb.execute(rawSql`DELETE FROM maps_cache WHERE expires_at < NOW()`).catch(() => {});

    console.log("[MAPS-CACHE] Schema verified");
  } catch (e: any) {
    console.error("[MAPS-CACHE] Table init error:", e.message);
  }
}

let cacheCleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startCacheCleanup(): void {
  if (cacheCleanupInterval) return;
  cacheCleanupInterval = setInterval(async () => {
    try {
      await rawDb.execute(rawSql`DELETE FROM maps_cache WHERE expires_at < NOW()`);
    } catch { /* ignore */ }
  }, 30 * 60 * 1000);
  console.log("[MAPS-CACHE] Cleanup job started (30 min interval)");
}
