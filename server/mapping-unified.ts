/**
 * Unified Mapping Architecture — Production-Grade (Uber/Ola/Porter Level)
 *
 * Extends maps-cache.ts with:
 * 1. Places Autocomplete (with session tokens for cost optimization)
 * 2. Reverse Geocoding (lat/lng → address)
 * 3. Multi-waypoint Directions (for multi-drop parcels)
 * 4. Short Location Name extraction (e.g., "Benz Circle" from full address)
 * 5. Real-time ETA estimation with traffic
 * 6. Address component parsing (area, city, state, pincode)
 * 7. Nearby places search (for POI suggestions)
 *
 * Note: Geocode, Distance, Route caching is handled in maps-cache.ts.
 * This module adds higher-level mapping features used by the app UI.
 */

import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { assertSchemaObjectsOrThrow } from "./schema-health";
import { getDistanceWithCache, getRouteWithCache, geocodeWithCache } from "./maps-cache";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PlacePrediction {
  placeId: string;
  mainText: string;        // "Benz Circle"
  secondaryText: string;   // "Vijayawada, Andhra Pradesh"
  fullDescription: string; // "Benz Circle, Vijayawada, Andhra Pradesh, India"
  types: string[];
  lat?: number;
  lng?: number;
}

export interface ReverseGeocodeResult {
  formattedAddress: string;
  shortName: string;        // First locality component
  area: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export interface MultiWaypointRoute {
  legs: Array<{
    originAddress: string;
    destAddress: string;
    distanceKm: number;
    durationMinutes: number;
    polyline: string;
    steps?: RouteStep[];
  }>;
  totalDistanceKm: number;
  totalDurationMinutes: number;
  overviewPolyline: string;
  waypointOrder: number[];
  steps: RouteStep[];
}

export interface RouteStep {
  instruction: string;
  plainInstruction: string;
  maneuver: string;
  distanceMeters: number;
  durationSeconds: number;
  startLocation: { lat: number; lng: number };
  endLocation: { lat: number; lng: number };
  polyline: string;
  roadName: string;
}

export interface ETAResult {
  etaMinutes: number;
  distanceKm: number;
  trafficCondition: "light" | "moderate" | "heavy";
  updatedAt: string;
}

export interface NearbyPlace {
  name: string;
  address: string;
  lat: number;
  lng: number;
  type: string;
  distance_km: number;
}

// ── API Key helper (shared with maps-cache) ──────────────────────────────────

let cachedApiKey: string | null = null;
let apiKeyFetchedAt = 0;

function stripHtml(input: string): string {
  return input
    .replace(/<div[^>]*>/gi, " ")
    .replace(/<\/div>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapRouteStep(step: any): RouteStep {
  return {
    instruction: step?.html_instructions || "",
    plainInstruction: stripHtml(step?.html_instructions || ""),
    maneuver: step?.maneuver || "continue",
    distanceMeters: Number(step?.distance?.value || 0),
    durationSeconds: Number(step?.duration?.value || 0),
    startLocation: {
      lat: Number(step?.start_location?.lat || 0),
      lng: Number(step?.start_location?.lng || 0),
    },
    endLocation: {
      lat: Number(step?.end_location?.lat || 0),
      lng: Number(step?.end_location?.lng || 0),
    },
    polyline: step?.polyline?.points || "",
    roadName: stripHtml(step?.html_instructions || "").split(" onto ").pop()?.trim() || "",
  };
}

async function getGoogleMapsKey(): Promise<string | null> {
  if (cachedApiKey && Date.now() - apiKeyFetchedAt < 5 * 60 * 1000) return cachedApiKey;
  try {
    const envKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (envKey) {
      cachedApiKey = envKey;
      apiKeyFetchedAt = Date.now();
      return cachedApiKey;
    }

    const r = await rawDb.execute(rawSql`
      SELECT value FROM business_settings WHERE key_name IN ('google_maps_key', 'GOOGLE_MAPS_API_KEY') LIMIT 1
    `);
    const val = (r.rows[0] as any)?.value?.trim();
    if (val) { cachedApiKey = val; apiKeyFetchedAt = Date.now(); return cachedApiKey; }
    
    return cachedApiKey;
  } catch { return cachedApiKey; }
}

// ── In-memory caches for mapping data ────────────────────────────────────────

interface CacheEntry<T> { value: T; expiresAt: number; }

class SimpleCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): T | undefined {
    const e = this.cache.get(key);
    if (!e) return undefined;
    if (e.expiresAt < Date.now()) { this.cache.delete(key); return undefined; }
    return e.value;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  get size(): number { return this.cache.size; }
}

const reverseGeocodeCache = new SimpleCache<ReverseGeocodeResult>(2000, 60 * 60 * 1000);  // 1 hour
const placesCache = new SimpleCache<PlacePrediction[]>(1000, 5 * 60 * 1000);               // 5 min
const etaCache = new SimpleCache<ETAResult>(3000, 2 * 60 * 1000);                          // 2 min

export interface LocationSelectionPayload {
  placeId?: string;
  queryText?: string;
  placeLabel: string;
  placeAddress?: string;
  lat?: number;
  lng?: number;
}

export async function ensureLocationIntelligenceSchema(): Promise<void> {
  await assertSchemaObjectsOrThrow({
    tables: ["landmark_aliases", "location_search_history", "pickup_quality_scores"],
  });
}

function normalizeLocationQuery(query: string): string {
  let normalized = (query || "")
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ");

  const replacements: Array<[RegExp, string]> = [
    [/\bvja\b/g, "vijayawada"],
    [/\bvijywada\b/g, "vijayawada"],
    [/\bbusstand\b/g, "bus stand"],
    [/\bstn\b/g, "station"],
    [/\brly\b/g, "railway"],
    [/\bjn\b/g, "junction"],
    [/\bopp\b/g, "opposite"],
    [/\bnear by\b/g, "near"],
    [/\bmy home\b/g, "home"],
  ];

  for (const [pattern, value] of replacements) {
    normalized = normalized.replace(pattern, value);
  }

  return normalized.replace(/\s+/g, " ").trim();
}

function locationScore(
  place: PlacePrediction,
  normalizedQuery: string,
  lat?: number,
  lng?: number,
): number {
  const hay = `${place.mainText} ${place.secondaryText} ${place.fullDescription}`.toLowerCase();
  let score = 0;

  if (place.mainText.toLowerCase() === normalizedQuery) score += 240;
  if (place.mainText.toLowerCase().startsWith(normalizedQuery)) score += 180;
  if (hay.startsWith(normalizedQuery)) score += 140;
  if (hay.includes(normalizedQuery)) score += 80;

  if (place.placeId.startsWith("history:")) score += 170;
  else if (place.placeId.startsWith("alias:")) score += 150;
  else if (place.placeId.startsWith("local:")) score += 120;
  else if (place.placeId.startsWith("nom:")) score += 40;
  else score += 70;

  if (lat != null && lng != null && place.lat != null && place.lng != null) {
    const distanceKm = haversineKm(lat, lng, place.lat, place.lng);
    score += Math.max(0, 80 - Math.min(distanceKm, 40) * 2);
  }

  return score;
}

async function searchLandmarkAliases(
  normalizedQuery: string,
  lat?: number,
  lng?: number,
): Promise<PlacePrediction[]> {
  try {
    const r = await rawDb.execute(rawSql`
      SELECT alias, canonical_name, canonical_address, latitude, longitude, popularity_score
      FROM landmark_aliases
      WHERE is_active = true
        AND (
          normalized_alias LIKE ${"%" + normalizedQuery + "%"}
          OR canonical_name ILIKE ${"%" + normalizedQuery + "%"}
          OR COALESCE(canonical_address, '') ILIKE ${"%" + normalizedQuery + "%"}
        )
      ORDER BY popularity_score DESC, canonical_name ASC
      LIMIT 8
    `);

    return r.rows
      .map((row: any) => ({
        placeId: `alias:${row.alias}`,
        mainText: row.canonical_name || row.alias || "",
        secondaryText: row.canonical_address || "",
        fullDescription: row.canonical_address || row.canonical_name || "",
        types: ["landmark_alias"],
        lat: row.latitude != null ? Number(row.latitude) : undefined,
        lng: row.longitude != null ? Number(row.longitude) : undefined,
      }))
      .sort((a, b) => locationScore(b, normalizedQuery, lat, lng) - locationScore(a, normalizedQuery, lat, lng))
      .slice(0, 6);
  } catch {
    return [];
  }
}

async function searchRecentLocationHistory(
  userId: string | undefined,
  normalizedQuery: string,
  lat?: number,
  lng?: number,
): Promise<PlacePrediction[]> {
  if (!userId) return [];
  try {
    const r = await rawDb.execute(rawSql`
      SELECT place_id, place_label, place_address, latitude, longitude, use_count, last_used_at
      FROM location_search_history
      WHERE user_id = ${userId}::uuid
        AND (
          normalized_query LIKE ${"%" + normalizedQuery + "%"}
          OR place_label ILIKE ${"%" + normalizedQuery + "%"}
          OR COALESCE(place_address, '') ILIKE ${"%" + normalizedQuery + "%"}
        )
      ORDER BY use_count DESC, last_used_at DESC
      LIMIT 8
    `);

    return r.rows
      .map((row: any) => ({
        placeId: `history:${row.place_id || row.place_label}`,
        mainText: row.place_label || "",
        secondaryText: row.place_address || "",
        fullDescription: row.place_address || row.place_label || "",
        types: ["recent_search"],
        lat: row.latitude != null ? Number(row.latitude) : undefined,
        lng: row.longitude != null ? Number(row.longitude) : undefined,
      }))
      .sort((a, b) => locationScore(b, normalizedQuery, lat, lng) - locationScore(a, normalizedQuery, lat, lng))
      .slice(0, 6);
  } catch {
    return [];
  }
}

function mergeAndRankPredictions(
  normalizedQuery: string,
  groups: PlacePrediction[][],
  lat?: number,
  lng?: number,
): PlacePrediction[] {
  const deduped = new Map<string, PlacePrediction>();
  for (const group of groups) {
    for (const place of group) {
      const key = `${place.mainText}|${place.secondaryText}|${place.fullDescription}`.toLowerCase().trim();
      if (!deduped.has(key)) deduped.set(key, place);
    }
  }
  return Array.from(deduped.values())
    .sort((a, b) => locationScore(b, normalizedQuery, lat, lng) - locationScore(a, normalizedQuery, lat, lng))
    .slice(0, 10);
}

export async function recordLocationSelection(
  userId: string,
  payload: LocationSelectionPayload,
): Promise<void> {
  if (!userId || !payload.placeLabel?.trim()) return;

  const queryText = payload.queryText?.trim() || payload.placeLabel.trim();
  const normalizedQuery = normalizeLocationQuery(queryText);

  const existing = await rawDb.execute(rawSql`
    SELECT id FROM location_search_history
    WHERE user_id = ${userId}::uuid
      AND normalized_query = ${normalizedQuery}
      AND place_label = ${payload.placeLabel}
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));

  if (existing.rows.length) {
    await rawDb.execute(rawSql`
      UPDATE location_search_history
      SET use_count = use_count + 1,
          last_used_at = NOW(),
          updated_at = NOW(),
          place_address = COALESCE(${payload.placeAddress || null}, place_address),
          latitude = COALESCE(${payload.lat ?? null}, latitude),
          longitude = COALESCE(${payload.lng ?? null}, longitude)
      WHERE id = ${(existing.rows[0] as any).id}::uuid
    `).catch(() => {});
    return;
  }

  await rawDb.execute(rawSql`
    INSERT INTO location_search_history
      (user_id, place_id, query_text, normalized_query, place_label, place_address, latitude, longitude)
    VALUES
      (${userId}::uuid,
       ${payload.placeId || null},
       ${queryText},
       ${normalizedQuery},
       ${payload.placeLabel},
       ${payload.placeAddress || null},
       ${payload.lat ?? null},
       ${payload.lng ?? null})
  `).catch(() => {});
}

// ── 1. PLACES AUTOCOMPLETE ──────────────────────────────────────────────────

/**
 * Search places with Google Places Autocomplete.
 * Uses session tokens to group autocomplete+select into one billing session.
 * Falls back to open geocoders when Google is unavailable instead of stale local filler data.
 */
export async function searchPlaces(
  query: string,
  sessionToken?: string,
  lat?: number,
  lng?: number,
  radius?: number,
  userId?: string
): Promise<PlacePrediction[]> {
  if (!query || query.length < 2) return [];

  const normalizedQuery = normalizeLocationQuery(query);
  const cacheKey = `places:${normalizedQuery}:${lat?.toFixed(2)}:${lng?.toFixed(2)}:${userId || "anon"}`;
  const cached = placesCache.get(cacheKey);
  if (cached) return cached;

  const [recentMatches, aliasMatches, popularMatches] = await Promise.all([
    searchRecentLocationHistory(userId, normalizedQuery, lat, lng),
    searchLandmarkAliases(normalizedQuery, lat, lng),
    searchPopularLocations(normalizedQuery),
  ]);

  const mergeAndStore = (groups: PlacePrediction[][]): PlacePrediction[] => {
    const merged = mergeAndRankPredictions(normalizedQuery, groups, lat, lng);
    placesCache.set(cacheKey, merged);
    return merged;
  };

  const apiKey = await getGoogleMapsKey();
  if (!apiKey) {
    const fallback = await searchNominatimFallback(normalizedQuery, lat, lng);
    return mergeAndStore([recentMatches, aliasMatches, popularMatches, fallback]);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(normalizedQuery)}&key=${apiKey}`;
    url += `&components=country:in&region=in`;

    if (lat && lng) {
      url += `&location=${lat},${lng}&radius=${radius || 50000}`;
      url += `&strictbounds=true`;
    }
    if (sessionToken) {
      url += `&sessiontoken=${encodeURIComponent(sessionToken)}`;
    }

    console.log(`[mapping] Fetching from Google: ${url.replace(apiKey, "REDACTED")}`);
    const r = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Referer': 'https://jagopro.org' }
    });
    if (!r.ok) {
        console.error(`[mapping] Google API returned status ${r.status}`);
        const fallback = await searchNominatimFallback(normalizedQuery, lat, lng);
        return mergeAndStore([recentMatches, aliasMatches, popularMatches, fallback]);
    }
    const data = await r.json() as any;
    console.log(`[mapping] Google response status: ${data.status}`);

    if (data?.status !== "OK") {
      console.warn(`[mapping-unified:searchPlaces] Google API Status: ${data?.status}, Msg: ${data?.error_message || 'none'}. Falling back to Nominatim/Local.`);
      const fallback = await searchNominatimFallback(normalizedQuery, lat, lng);
      return mergeAndStore([recentMatches, aliasMatches, popularMatches, fallback]);
    }

    if (!data.predictions?.length) {
      console.log(`[mapping-unified:searchPlaces] Google returned 0 results. Trying Nominatim fallback.`);
      const fallback = await searchNominatimFallback(normalizedQuery, lat, lng);
      return mergeAndStore([recentMatches, aliasMatches, popularMatches, fallback]);
    }

    const googleResults: PlacePrediction[] = data.predictions
      .filter((p: any) => {
        const hay = `${p.description || ""} ${p.structured_formatting?.secondary_text || ""}`.toLowerCase();
        return hay.includes("india") || (!hay.includes("usa") && !hay.includes("united states"));
      })
      .map((p: any) => ({
      placeId: p.place_id,
      mainText: p.structured_formatting?.main_text || p.description?.split(",")[0] || "",
      secondaryText: p.structured_formatting?.secondary_text || "",
      fullDescription: p.description || "",
      description: p.description || "", // Backward compatibility
      types: p.types || [],
    }));

    return mergeAndStore([recentMatches, aliasMatches, popularMatches, googleResults]);
  } catch (e: any) {
    console.error(`[mapping-unified:searchPlaces] Failed:`, e.message || e);
    const fallback = await searchNominatimFallback(normalizedQuery, lat, lng);
    return mergeAndStore([recentMatches, aliasMatches, popularMatches, fallback]);
  } finally {
    clearTimeout(timeout);
  }
}

async function searchNominatimFallback(query: string, lat?: number, lng?: number): Promise<PlacePrediction[]> {
  try {
    const nomController = new AbortController();
    const nomTimeout = setTimeout(() => nomController.abort(), 4000);
    const indiaQuery = query.toLowerCase().includes('india') ? query : `${query}, India`;
    let nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(indiaQuery)}&countrycodes=in&addressdetails=1&limit=15`;
    if (lat && lng) {
      const left = (lng - 1.2).toFixed(4);
      const right = (lng + 1.2).toFixed(4);
      const top = (lat + 1.2).toFixed(4);
      const bottom = (lat - 1.2).toFixed(4);
      nomUrl += `&viewbox=${left},${top},${right},${bottom}&bounded=1`;
    }
    
    const nr = await fetch(nomUrl, {
      signal: nomController.signal,
      headers: { "User-Agent": "JagoPro/1.0 (ride-hailing app)" }
    });
    
    clearTimeout(nomTimeout);
    
    if (nr.ok) {
      const nd = await nr.json() as any[];
      if (Array.isArray(nd) && nd.length > 0) {
        const results: PlacePrediction[] = nd.map((p: any) => {
          const parts = (p.display_name || "").split(",");
          const main = p.name || parts[0];
          const sec = parts.slice(1).join(",").trim();
          return {
            placeId: `nom:${p.place_id}`,
            mainText: main,
            secondaryText: sec,
            fullDescription: p.display_name || "",
            description: p.display_name || "", // Backward compatibility
            types: [p.type || "point_of_interest"],
            lat: parseFloat(p.lat) || 0,
            lng: parseFloat(p.lon) || 0,
          };
        });
        
        // Deduplicate nominatim results by mainText
        const unique = new Map<string, PlacePrediction>();
        for (const res of results) {
          const key = (res.mainText + res.secondaryText).toLowerCase();
          if (!unique.has(key)) unique.set(key, res);
        }
        return Array.from(unique.values())
          .filter((res) => {
            const hay = `${res.fullDescription} ${res.secondaryText}`.toLowerCase();
            return hay.includes('india');
          })
          .slice(0, 8);
      }
    }
  } catch(e) {
    console.error("[mapping-unified] Nominatim fallback failed:", e);
  }
  return [];
}

/**
 * Get place details (lat/lng) from place_id.
 * This is the step after autocomplete selection — billed together with session token.
 */
export async function getPlaceDetails(
  placeId: string,
  sessionToken?: string
): Promise<{ lat: number; lng: number; address: string; shortName: string } | null> {
  const apiKey = await getGoogleMapsKey();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    let url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=geometry,formatted_address,name,address_components&key=${apiKey}`;
    if (sessionToken) url += `&sessiontoken=${encodeURIComponent(sessionToken)}`;

    const r = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Referer': 'https://jagopro.org' }
    });
    if (!r.ok) return null;
    const data = await r.json() as any;

    if (data?.status !== "OK" || !data.result?.geometry?.location) return null;

    const loc = data.result.geometry.location;
    return {
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      address: data.result.formatted_address || "",
      shortName: data.result.name || extractShortName(data.result.formatted_address || ""),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Legacy admin-maintained fallback: still available for internal tooling, but
// customer-facing search should prefer live geocoders to avoid stale filler results.
async function searchPopularLocations(query: string): Promise<PlacePrediction[]> {
  try {
    const r = await rawDb.execute(rawSql`
      SELECT DISTINCT name, full_address, latitude, longitude
      FROM popular_locations
      WHERE is_active = true
        AND (LOWER(name) LIKE ${"%" + query.toLowerCase() + "%"}
             OR LOWER(full_address) LIKE ${"%" + query.toLowerCase() + "%"})
      ORDER BY name ASC
      LIMIT 10
    `);
    const rawResults = r.rows.map((row: any) => ({
      placeId: `local:${row.name}`,
      mainText: row.name,
      secondaryText: row.full_address || "",
      fullDescription: `${row.name}, ${row.full_address || ""}`,
      description: `${row.name}, ${row.full_address || ""}`, // Backward compatibility
      types: ["popular_location"],
      lat: parseFloat(String(row.latitude)) || 0,
      lng: parseFloat(String(row.longitude)) || 0,
    }));

    // Deduplicate by name to prevent multiple results for the same location
    const unique = new Map<string, PlacePrediction>();
    for (const res of rawResults) {
      if (!unique.has(res.mainText.toLowerCase())) {
        unique.set(res.mainText.toLowerCase(), res);
      }
    }
    return Array.from(unique.values());
  } catch {
    return [];
  }
}

// ── 2. REVERSE GEOCODING ────────────────────────────────────────────────────

/**
 * Convert lat/lng to address with component parsing.
 * Memory cache → DB cache → Google API
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<ReverseGeocodeResult | null> {
  const key = `rev:${lat.toFixed(5)},${lng.toFixed(5)}`;

  // Layer 1: Memory
  const cached = reverseGeocodeCache.get(key);
  if (cached) return cached;

  // Layer 2: DB
  try {
    const dbr = await rawDb.execute(rawSql`
      SELECT data_json FROM maps_cache
      WHERE cache_type = 'reverse_geocode'
        AND cache_key = ${key}
        AND expires_at > NOW()
      LIMIT 1
    `);
    if (dbr.rows.length) {
      const parsed = typeof (dbr.rows[0] as any).data_json === "string"
        ? JSON.parse((dbr.rows[0] as any).data_json)
        : (dbr.rows[0] as any).data_json;
      reverseGeocodeCache.set(key, parsed);
      return parsed;
    }
  } catch {}

  // Layer 3: Google API
  const apiKey = await getGoogleMapsKey();
  if (apiKey) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
      const r = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Referer': 'https://jagopro.org' }
    });
      if (r.ok) {
        const data = await r.json() as any;
        if (data?.status === "OK" && data.results?.length) {
          const top = data.results[0];
          const components = top.address_components || [];
          const result: ReverseGeocodeResult = {
            formattedAddress: top.formatted_address || "",
            shortName: extractShortName(top.formatted_address || ""),
            area: findComponent(components, "sublocality_level_1", "sublocality", "neighborhood") || "",
            city: findComponent(components, "locality", "administrative_area_level_2") || "",
            state: findComponent(components, "administrative_area_level_1") || "",
            pincode: findComponent(components, "postal_code") || "",
            country: findComponent(components, "country") || "India",
          };
          reverseGeocodeCache.set(key, result);
          rawDb.execute(rawSql`
            INSERT INTO maps_cache (cache_type, cache_key, lat, lng, formatted_address, data_json, expires_at)
            VALUES ('reverse_geocode', ${key}, ${lat}, ${lng}, ${result.formattedAddress}, ${JSON.stringify(result)}::jsonb, NOW() + INTERVAL '60 minutes')
            ON CONFLICT (cache_type, cache_key) DO UPDATE SET
              data_json = EXCLUDED.data_json, expires_at = EXCLUDED.expires_at, updated_at = NOW()
          `).catch(() => {});
          return result;
        }
      }
    } catch {}
    finally { clearTimeout(timeout); }
  }

  // Layer 4: Nominatim fallback (free, no key required)
  try {
    const nomController = new AbortController();
    const nomTimeout = setTimeout(() => nomController.abort(), 4000);
    try {
      const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`;
      const nr = await fetch(nomUrl, {
        signal: nomController.signal,
        headers: { "User-Agent": "JagoPro/1.0 (ride-hailing app)" },
      });
      if (nr.ok) {
        const nd = await nr.json() as any;
        if (nd?.display_name) {
          const addr = nd.address || {};
          const result: ReverseGeocodeResult = {
            formattedAddress: nd.display_name,
            shortName: addr.suburb || addr.neighbourhood || addr.city || addr.town || "",
            area: addr.suburb || addr.neighbourhood || addr.quarter || "",
            city: addr.city || addr.town || addr.village || addr.county || "",
            state: addr.state || "",
            pincode: addr.postcode || "",
            country: addr.country || "India",
          };
          reverseGeocodeCache.set(key, result);
          return result;
        }
      }
    } finally { clearTimeout(nomTimeout); }
  } catch {}

  return null;
}

function findComponent(components: any[], ...types: string[]): string {
  for (const type of types) {
    const c = components.find((c: any) => c.types?.includes(type));
    if (c) return c.long_name || c.short_name || "";
  }
  return "";
}

// ── 3. SHORT LOCATION NAME EXTRACTION ───────────────────────────────────────

/**
 * Extract a short, human-friendly name from a full address.
 * "Near Benz Circle, MG Road, Vijayawada, AP 520010" → "Benz Circle"
 */
export function extractShortName(fullAddress: string): string {
  if (!fullAddress) return "";
  const parts = fullAddress.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return fullAddress;

  // Remove generic prefixes
  let first = parts[0]
    .replace(/^(near|opp|opposite|beside|behind|in front of|next to)\s+/i, "")
    .replace(/^\d+[\s,/-]+/, ""); // Remove house numbers

  // If too long, truncate
  if (first.length > 40) first = first.substring(0, 40).trim();

  return first || parts[0];
}

// ── 4. MULTI-WAYPOINT DIRECTIONS ────────────────────────────────────────────

/**
 * Get directions with multiple waypoints (for multi-drop parcels).
 * Supports waypoint optimization (reordering for shortest route).
 */
export async function getMultiWaypointRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  waypoints: Array<{ lat: number; lng: number }>,
  optimize: boolean = true
): Promise<MultiWaypointRoute | null> {
  const apiKey = await getGoogleMapsKey();
  if (!apiKey) {
    if (!waypoints.length) {
      const route = await getRouteWithCache(origin.lat, origin.lng, destination.lat, destination.lng);
      if (!route) return null;
      const fallbackStep: RouteStep = {
        instruction: "Head to destination",
        plainInstruction: "Head to destination",
        maneuver: "continue",
        distanceMeters: Math.round(route.distanceKm * 1000),
        durationSeconds: Math.round(route.durationMinutes * 60),
        startLocation: { lat: origin.lat, lng: origin.lng },
        endLocation: { lat: destination.lat, lng: destination.lng },
        polyline: route.polyline,
        roadName: "",
      };
      return {
        legs: [{
          originAddress: "",
          destAddress: "",
          distanceKm: route.distanceKm,
          durationMinutes: route.durationMinutes,
          polyline: route.polyline,
          steps: [fallbackStep],
        }],
        totalDistanceKm: route.distanceKm,
        totalDurationMinutes: route.durationMinutes,
        overviewPolyline: route.polyline,
        waypointOrder: [],
        steps: [fallbackStep],
      };
    }
    return haversineMultiRoute(origin, destination, waypoints);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const wpParam = waypoints
      .map((w) => `${w.lat},${w.lng}`)
      .join("|");
    const optimizeParam = optimize ? "optimize:true|" : "";

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&waypoints=${optimizeParam}${wpParam}&key=${apiKey}`;
    const r = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Referer': 'https://jagopro.org' }
    });
    if (!r.ok) return haversineMultiRoute(origin, destination, waypoints);
    const data = await r.json() as any;

    if (data?.status !== "OK" || !data.routes?.length) {
      return haversineMultiRoute(origin, destination, waypoints);
    }

    const route = data.routes[0];
    const legs = (route.legs || []).map((leg: any) => {
      const steps = (leg.steps || []).map((step: any) => mapRouteStep(step));
      return {
        originAddress: leg.start_address || "",
        destAddress: leg.end_address || "",
        distanceKm: Math.round((leg.distance?.value || 0) / 1000 * 100) / 100,
        durationMinutes: Math.round((leg.duration?.value || 0) / 60),
        polyline: leg.steps?.map((s: any) => s.polyline?.points || "").join("") || "",
        steps,
      };
    });

    const totalDist = legs.reduce((sum: number, l: any) => sum + l.distanceKm, 0);
    const totalDur = legs.reduce((sum: number, l: any) => sum + l.durationMinutes, 0);
    const steps = legs.flatMap((leg: any) => leg.steps || []);

    return {
      legs,
      totalDistanceKm: Math.round(totalDist * 100) / 100,
      totalDurationMinutes: totalDur,
      overviewPolyline: route.overview_polyline?.points || "",
      waypointOrder: route.waypoint_order || [],
      steps,
    };
  } catch {
    return haversineMultiRoute(origin, destination, waypoints);
  } finally {
    clearTimeout(timeout);
  }
}

function haversineMultiRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  waypoints: Array<{ lat: number; lng: number }>
): MultiWaypointRoute {
  const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const allPoints = [origin, ...waypoints, destination];
  const legs = [];
  let totalDist = 0;
  let totalDur = 0;

  for (let i = 0; i < allPoints.length - 1; i++) {
    const d = haversineKm(allPoints[i].lat, allPoints[i].lng, allPoints[i + 1].lat, allPoints[i + 1].lng);
    const dur = Math.round((d / 25) * 60);
    legs.push({
      originAddress: "",
      destAddress: "",
      distanceKm: Math.round(d * 100) / 100,
      durationMinutes: dur,
      polyline: "",
      steps: [{
        instruction: "Continue to next stop",
        plainInstruction: "Continue to next stop",
        maneuver: "continue",
        distanceMeters: Math.round(d * 1000),
        durationSeconds: dur * 60,
        startLocation: { lat: allPoints[i].lat, lng: allPoints[i].lng },
        endLocation: { lat: allPoints[i + 1].lat, lng: allPoints[i + 1].lng },
        polyline: "",
        roadName: "",
      }],
    });
    totalDist += d;
    totalDur += dur;
  }

  return {
    legs,
    totalDistanceKm: Math.round(totalDist * 100) / 100,
    totalDurationMinutes: totalDur,
    overviewPolyline: "",
    waypointOrder: waypoints.map((_, i) => i),
    steps: legs.flatMap((leg: any) => leg.steps || []),
  };
}

// ── 5. REAL-TIME ETA ────────────────────────────────────────────────────────

/**
 * Calculate real-time ETA with traffic consideration.
 * Uses Google Distance Matrix with departure_time for traffic data.
 */
export async function getRealTimeETA(
  driverLat: number,
  driverLng: number,
  destLat: number,
  destLng: number
): Promise<ETAResult> {
  const key = `eta:${driverLat.toFixed(3)},${driverLng.toFixed(3)}:${destLat.toFixed(3)},${destLng.toFixed(3)}`;

  // Short TTL cache
  const cached = etaCache.get(key);
  if (cached) return cached;

  const apiKey = await getGoogleMapsKey();
  if (!apiKey) {
    // Haversine fallback
    const dist = haversineKm(driverLat, driverLng, destLat, destLng);
    const eta = Math.round((dist / 25) * 60);
    return { etaMinutes: eta, distanceKm: Math.round(dist * 100) / 100, trafficCondition: "moderate", updatedAt: new Date().toISOString() };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${driverLat},${driverLng}&destinations=${destLat},${destLng}&departure_time=now&traffic_model=best_guess&key=${apiKey}`;
    const r = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Referer': 'https://jagopro.org' }
    });
    if (!r.ok) throw new Error("API failed");
    const data = await r.json() as any;
    const el = data?.rows?.[0]?.elements?.[0];

    if (el?.status !== "OK") throw new Error("No result");

    const distKm = Math.round((el.distance.value / 1000) * 100) / 100;
    const durationInTrafficSec = el.duration_in_traffic?.value || el.duration.value;
    const normalDurationSec = el.duration.value;
    const etaMin = Math.round(durationInTrafficSec / 60);

    // Determine traffic condition
    const trafficRatio = durationInTrafficSec / normalDurationSec;
    const condition = trafficRatio < 1.15 ? "light" : trafficRatio < 1.4 ? "moderate" : "heavy";

    const result: ETAResult = {
      etaMinutes: etaMin,
      distanceKm: distKm,
      trafficCondition: condition as "light" | "moderate" | "heavy",
      updatedAt: new Date().toISOString(),
    };

    etaCache.set(key, result);
    return result;
  } catch {
    const dist = haversineKm(driverLat, driverLng, destLat, destLng);
    return { etaMinutes: Math.round((dist / 25) * 60), distanceKm: Math.round(dist * 100) / 100, trafficCondition: "moderate", updatedAt: new Date().toISOString() };
  } finally {
    clearTimeout(timeout);
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── 6. NEARBY PLACES SEARCH ─────────────────────────────────────────────────

/**
 * Search for nearby places (gas stations, restaurants, etc.)
 */
export async function searchNearbyPlaces(
  lat: number,
  lng: number,
  type: string = "point_of_interest",
  radius: number = 2000
): Promise<NearbyPlace[]> {
  const apiKey = await getGoogleMapsKey();
  if (!apiKey) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=${encodeURIComponent(type)}&key=${apiKey}`;
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) return [];
    const data = await r.json() as any;
    if (data?.status !== "OK") return [];

    return (data.results || []).slice(0, 15).map((p: any) => ({
      name: p.name || "",
      address: p.vicinity || "",
      lat: p.geometry?.location?.lat || 0,
      lng: p.geometry?.location?.lng || 0,
      type: (p.types || [])[0] || type,
      distance_km: haversineKm(lat, lng, p.geometry?.location?.lat || 0, p.geometry?.location?.lng || 0),
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ── 7. MAPPING STATS ────────────────────────────────────────────────────────

export function getMappingStats() {
  return {
    reverseGeocodeCache: reverseGeocodeCache.size,
    placesCache: placesCache.size,
    etaCache: etaCache.size,
  };
}
