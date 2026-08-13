
import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { activeDriverEligibilitySql } from "./driver-state";
import { scoreDriverForDispatch } from "./dispatch-score";
import { getMatchingDriverCategoryIds, uuidArraySql } from "./vehicle-matching";

// ----------------------------------------------------------------------------
//  JAGO Pro AI Intelligence Layer
//  - Smart Suggestions (frequent destinations, predicted rides, time-based)
//  - AI Driver Matching (distance + rating + response speed + traffic)
//  - AI Safety Monitor (route deviation, abnormal stops, inactivity)
//  - AI Demand Heatmap (demand prediction, driver notifications)
//  - Enhanced NLP for voice booking
// ----------------------------------------------------------------------------

function camelize(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v,
    ])
  );
}

function formatDbError(err: any): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err.message && typeof err.message === "string" && err.message.trim().length > 0) return err.message;
  if (err.cause?.message && typeof err.cause.message === "string") return err.cause.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// -- 1. ENHANCED NLP INTENT PARSER ------------------------------------------
export interface ParsedVoiceIntent {
  intent: "book_ride" | "send_parcel" | "find_drivers" | "check_status" | "cancel_ride" | "unknown";
  vehicleType: string | null;
  pickup: string | null;
  destination: string | null;
  confidence: number;
  entities: Record<string, string>;
}

const INTENT_PATTERNS: Array<{ pattern: RegExp; intent: ParsedVoiceIntent["intent"]; confidence: number }> = [
  // English
  { pattern: /\b(book|ride|go|take me|drop me|need a ride|get me a|cab|taxi|travel|i want a|i need a)\b/i, intent: "book_ride", confidence: 0.85 },
  { pattern: /\b(send|parcel|deliver|package|courier|dispatch|ship)\b/i, intent: "send_parcel", confidence: 0.9 },
  { pattern: /\b(find|nearby|available|drivers|pilots|who is near|show drivers)\b/i, intent: "find_drivers", confidence: 0.85 },
  { pattern: /\b(status|where is|track|eta|how long|when will)\b/i, intent: "check_status", confidence: 0.8 },
  { pattern: /\b(cancel|stop|abort|end ride|don't want)\b/i, intent: "cancel_ride", confidence: 0.9 },
  // Telugu (transliterated)
  { pattern: /\b(book\s*cheyyi|vellaali|vellu|ride\s*kavali|cab\s*kavali|taxi\s*kavali|auto\s*kavali|veyyi)\b/i, intent: "book_ride", confidence: 0.9 },
  { pattern: /\b(parcel\s*pampinchu|courier\s*pampinchu|send\s*cheyyi|deliver\s*cheyyi)\b/i, intent: "send_parcel", confidence: 0.9 },
  { pattern: /\b(cancel\s*cheyyi|vaddhu|aapandi|venda)\b/i, intent: "cancel_ride", confidence: 0.9 },
  // Hindi (transliterated)
  { pattern: /\b(book\s*karo|jana\s*hai|mujhe\s*jana|cab\s*chahiye|ride\s*chahiye|auto\s*bulao)\b/i, intent: "book_ride", confidence: 0.9 },
  { pattern: /\b(parcel\s*bhejo|deliver\s*karo|saman\s*bhejo)\b/i, intent: "send_parcel", confidence: 0.9 },
  { pattern: /\b(cancel\s*karo|nahi\s*chahiye|band\s*karo)\b/i, intent: "cancel_ride", confidence: 0.9 },
];

const VEHICLE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  // SUV � matches our "SUV / XL" category
  { pattern: /\b(suv|xl|innova|ertiga|fortuner|big\s*car|large\s*car)\b/i, type: "SUV" },
  // Sedan � matches our "Sedan" category
  { pattern: /\b(sedan|swift|dzire|ciaz|city|verna|prime\s*car)\b/i, type: "Sedan" },
  // Mini Car � matches our "Mini Car" category
  { pattern: /\b(mini\s*car|micro|go|mini|hatchback|economy|small\s*car|mini\s*cab)\b/i, type: "Mini Car" },
  // Auto
  { pattern: /\b(auto|rickshaw|three\s*wheeler|tuk|tuk\s*tuk|auto\s*rickshaw)\b/i, type: "Auto" },
  // Bike � matches our "Bike" category
  { pattern: /\b(bike|two\s*wheeler|motorcycle|scooty|moto|rapido|bike\s*ride)\b/i, type: "Bike" },
  // Parcel/Delivery � matches "Bike Delivery"
  { pattern: /\b(parcel|package|courier|delivery|send\s*parcel)\b/i, type: "Bike Delivery" },
  // Cargo
  { pattern: /\b(cargo|truck|lorry|goods|tata\s*ace|tempo|bolero|mini\s*truck)\b/i, type: "Tata Ace" },
  // Pool
  { pattern: /\b(pool|share|shared\s*ride|carpool|split)\b/i, type: "Mini Pool" },
  // Telugu vehicle names
  { pattern: /\b(auto\s*kavali|auto\s*veyyi|riksha)\b/i, type: "Auto" },
  { pattern: /\b(bike\s*kavali|bike\s*veyyi|two\s*wheeler\s*kavali)\b/i, type: "Bike" },
  { pattern: /\b(car\s*kavali|cab\s*kavali|taxi\s*kavali)\b/i, type: "Sedan" },
  // Hindi vehicle names
  { pattern: /\b(auto\s*bulao|rickshaw\s*bulao|tuk\s*bulao)\b/i, type: "Auto" },
  { pattern: /\b(bike\s*bulao|motorcycle\s*bulao)\b/i, type: "Bike" },
  { pattern: /\b(car\s*bulao|cab\s*bulao|taxi\s*bulao|gaadi\s*bulao)\b/i, type: "Sedan" },
];

const LOCATION_PREPOSITIONS = /\b(from|at|near|in)\s+/i;
const DESTINATION_PREPOSITIONS = /\b(to|towards|till|until|upto|reach|heading)\s+/i;

export function parseVoiceIntent(text: string): ParsedVoiceIntent {
  const result: ParsedVoiceIntent = {
    intent: "unknown",
    vehicleType: null,
    pickup: null,
    destination: null,
    confidence: 0,
    entities: {},
  };

  for (const { pattern, intent, confidence } of INTENT_PATTERNS) {
    if (pattern.test(text)) {
      if (confidence > result.confidence) {
        result.intent = intent;
        result.confidence = confidence;
      }
    }
  }

  for (const { pattern, type } of VEHICLE_PATTERNS) {
    if (pattern.test(text)) {
      result.vehicleType = type;
      result.entities.vehicle = type;
      break;
    }
  }

  const fromToMatch = text.match(/from\s+(.+?)\s+to\s+(.+?)(?:\s*[.!?,]|\s*$)/i);
  if (fromToMatch) {
    result.pickup = cleanLocationName(fromToMatch[1]);
    result.destination = cleanLocationName(fromToMatch[2]);
  } else {
    const toMatch = text.match(/(?:book|ride|go|take me|drop me|send|deliver|get me a\s+\w+)\s+(?:to|towards)\s+(.+?)(?:\s*[.!?,]|\s*$)/i);
    if (toMatch) {
      result.destination = cleanLocationName(toMatch[1]);
    }
    const fromMatch = text.match(/from\s+(.+?)(?:\s+to\s|\s*[.!?,]|\s*$)/i);
    if (fromMatch) {
      result.pickup = cleanLocationName(fromMatch[1]);
    }
  }

  if (result.destination && result.intent === "unknown") {
    result.intent = "book_ride";
    result.confidence = 0.7;
  }

  return result;
}

function cleanLocationName(name: string): string {
  return name
    .replace(/^(a|an|the|my|our)\s+/i, "")
    .replace(/\b(please|now|quickly|fast|asap|urgently)\b/gi, "")
    .trim();
}


// -- 2. AI DRIVER MATCHING (Intelligent Scoring) ----------------------------
export interface DriverMatchScore {
  driverId: string;
  fullName: string;
  phone: string;
  lat: number;
  lng: number;
  distanceKm: number;
  rating: number;
  totalTrips: number;
  avgResponseTimeSec: number;
  score: number;
  fcmToken?: string;
  driverGender?: string | null;
  scoreBreakdown?: {
    distance: number;
    eta: number;
    behavior: number;
    rating: number;
    responseSpeed: number;
    completionRate: number;
    idleBonus: number;
    final: number;
    etaMinutes?: number;
    locationAgeSeconds?: number;
  };
}

interface FindBestDriversOptions {
  allowUnfiltered?: boolean;
  debugContext?: string;
}

export async function findBestDrivers(
  pickupLat: number,
  pickupLng: number,
  vehicleCategoryId?: string,
  excludeDriverIds: string[] = [],
  limit: number = 5,
  options: FindBestDriversOptions = {},
): Promise<DriverMatchScore[]> {
  if (!vehicleCategoryId && !options.allowUnfiltered) {
    console.error(
      `[AI_MATCH] Refusing unfiltered driver query context=${options.debugContext || "default"} ` +
        `pickup=${pickupLat},${pickupLng}`,
    );
    return [];
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const safeIds = excludeDriverIds.filter(id => uuidRe.test(id));
  const excludeClause = safeIds.length > 0
    ? rawSql`AND u.id NOT IN (${rawSql.raw(safeIds.map(id => `'${id}'::uuid`).join(","))})`
    : rawSql``;
  const matchingCategoryIds = await getMatchingDriverCategoryIds(vehicleCategoryId);

  const vcFilter = matchingCategoryIds?.length
    ? rawSql`AND dd.vehicle_category_id = ANY(${uuidArraySql(matchingCategoryIds)})`
    : vehicleCategoryId
      ? rawSql`AND dd.vehicle_category_id = ${vehicleCategoryId}::uuid`
      : rawSql``;

  const drivers = await rawDb.execute(rawSql`
    SELECT
      u.id, u.full_name, u.phone, u.rating,
      dl.lat, dl.lng,
      EXTRACT(EPOCH FROM (NOW() - dl.updated_at)) as location_age_seconds,
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
    JOIN driver_details dd ON dd.user_id = u.id
    LEFT JOIN vehicle_categories vc ON vc.id = dd.vehicle_category_id
    LEFT JOIN driver_stats ds ON ds.driver_id = u.id
    LEFT JOIN driver_behavior_scores dbs ON dbs.driver_id = u.id
    WHERE u.user_type='driver' AND ${activeDriverEligibilitySql("u")}
      AND dl.is_online=true AND u.current_trip_id IS NULL
      AND COALESCE(dd.availability_status, 'offline') = 'online'
      AND dl.updated_at > NOW() - INTERVAL '2 minutes'
      AND (dl.lat <> 0 OR dl.lng <> 0)
      ${vcFilter}
      ${excludeClause}
      AND SQRT(
        POW((dl.lat - ${Number(pickupLat)}) * 111.32, 2) +
        POW((dl.lng - ${Number(pickupLng)}) * 111.32 * COS(RADIANS(${Number(pickupLat)})), 2)
      ) < 25
    ORDER BY distance_km ASC
    LIMIT ${limit * 2}
  `);

  if (!drivers.rows.length) {
    try {
      const diag = await rawDb.execute(rawSql`
        SELECT
          (SELECT COUNT(*) FROM users WHERE user_type='driver' AND is_active=true AND is_locked=false) as total_active_drivers,
          (SELECT COUNT(*) FROM driver_locations WHERE is_online=true) as online_drivers,
          (SELECT COUNT(*) FROM driver_locations WHERE is_online=true AND updated_at > NOW() - INTERVAL '2 minutes') as recent_online,
          (SELECT COUNT(*) FROM driver_locations WHERE is_online=true AND (lat <> 0 OR lng <> 0)) as online_with_gps,
          (SELECT COUNT(*) FROM users u JOIN driver_details dd ON dd.user_id=u.id
            WHERE u.user_type='driver' AND ${activeDriverEligibilitySql("u")}
              ${matchingCategoryIds?.length ? rawSql`AND dd.vehicle_category_id = ANY(${uuidArraySql(matchingCategoryIds)})` : vehicleCategoryId ? rawSql`AND dd.vehicle_category_id = ${vehicleCategoryId}::uuid` : rawSql``}
          ) as matching_category
      `);
      const d = (diag.rows[0] as any) || {};
      console.log(`[DISPATCH_NO_MATCH] pickup=${pickupLat},${pickupLng} vehicleCategoryId=${vehicleCategoryId || 'any'} totals=${JSON.stringify(d)}`);
    } catch (_) {}
    return [];
  }

  const scored: DriverMatchScore[] = drivers.rows.map((row: any) => {
    const d = camelize(row);
    const distKm = Number(d.distanceKm) || 99;
    const rating = Number(d.rating) || 3.0;
    const avgResp = Number(d.avgResponseTimeSec) || 60;
    const completionRate = Number(d.completionRate) || 0.8;
    const behaviorScore = Number(d.behaviorScore) || 50;
    const scoreResult = scoreDriverForDispatch({
      distanceKm: distKm,
      rating,
      avgResponseTimeSec: avgResp,
      completionRate,
      behaviorScore,
      locationAgeSeconds: Number(d.locationAgeSeconds) || 0,
    });

    return {
      driverId: d.id,
      fullName: d.fullName || "Pilot",
      phone: d.phone || "",
      lat: Number(d.lat),
      lng: Number(d.lng),
      distanceKm: Math.round(distKm * 100) / 100,
      rating: Math.round(rating * 10) / 10,
      totalTrips: Number(d.totalTrips) || 0,
      avgResponseTimeSec: Math.round(avgResp),
      score: scoreResult.score,
      scoreBreakdown: scoreResult.scoreBreakdown,
      fcmToken: d.fcmToken || undefined,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}


// -- 3. AI SMART SUGGESTIONS ------------------------------------------------
export interface SmartSuggestion {
  type: "frequent_destination" | "predicted_ride" | "time_based" | "saved_place";
  title: string;
  subtitle: string;
  destination: string;
  destLat: number;
  destLng: number;
  confidence: number;
  vehicleCategoryId?: string;
  icon: string;
}

export async function getSmartSuggestions(userId: string, currentHour?: number): Promise<SmartSuggestion[]> {
  const suggestions: SmartSuggestion[] = [];
  const hour = currentHour ?? new Date().getHours();
  const dayOfWeek = new Date().getDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  try {
    const frequentDests = await rawDb.execute(rawSql`
      SELECT
        destination_address, destination_lat, destination_lng,
        vehicle_category_id,
        COUNT(*) as trip_count,
        MAX(created_at) as last_trip
      FROM trip_requests
      WHERE customer_id = ${userId}::uuid
        AND current_status = 'completed'
        AND destination_address IS NOT NULL
        AND destination_address != ''
      GROUP BY destination_address, destination_lat, destination_lng, vehicle_category_id
      ORDER BY trip_count DESC, last_trip DESC
      LIMIT 5
    `);

    for (const row of frequentDests.rows) {
      const r = row as any;
      const count = Number(r.trip_count);
      if (count >= 2) {
        suggestions.push({
          type: "frequent_destination",
          title: truncateAddr(r.destination_address),
          subtitle: `Visited ${count} times`,
          destination: r.destination_address,
          destLat: Number(r.destination_lat),
          destLng: Number(r.destination_lng),
          confidence: Math.min(0.5 + count * 0.1, 0.95),
          vehicleCategoryId: r.vehicle_category_id,
          icon: "??",
        });
      }
    }

    const timeBased = await rawDb.execute(rawSql`
      SELECT
        destination_address, destination_lat, destination_lng,
        vehicle_category_id,
        COUNT(*) as trip_count,
        AVG(EXTRACT(HOUR FROM created_at)) as avg_hour
      FROM trip_requests
      WHERE customer_id = ${userId}::uuid
        AND current_status = 'completed'
        AND destination_address IS NOT NULL
        AND EXTRACT(DOW FROM created_at) BETWEEN ${isWeekday ? 1 : 0} AND ${isWeekday ? 5 : 0}
      GROUP BY destination_address, destination_lat, destination_lng, vehicle_category_id
      HAVING COUNT(*) >= 3
        AND ABS(AVG(EXTRACT(HOUR FROM created_at)) - ${hour}) < 2
      ORDER BY trip_count DESC
      LIMIT 3
    `);

    for (const row of timeBased.rows) {
      const r = row as any;
      const avgHour = Math.round(Number(r.avg_hour));
      const alreadyExists = suggestions.some(s => s.destination === r.destination_address);
      if (!alreadyExists) {
        const periodLabel = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
        suggestions.push({
          type: "predicted_ride",
          title: truncateAddr(r.destination_address),
          subtitle: `You usually go here ${periodLabel}. Book now?`,
          destination: r.destination_address,
          destLat: Number(r.destination_lat),
          destLng: Number(r.destination_lng),
          confidence: 0.85,
          vehicleCategoryId: r.vehicle_category_id,
          icon: "??",
        });
      }
    }

    const savedPlaces = await rawDb.execute(rawSql`
      SELECT label, address, lat, lng FROM saved_places
      WHERE user_id = ${userId}::uuid AND address IS NOT NULL
      LIMIT 5
    `);

    for (const row of savedPlaces.rows) {
      const r = row as any;
      const alreadyExists = suggestions.some(s => s.destLat === Number(r.lat) && s.destLng === Number(r.lng));
      if (!alreadyExists && r.label) {
        const isRelevant = (r.label === "Work" && hour >= 7 && hour <= 10) ||
          (r.label === "Home" && hour >= 17 && hour <= 22);
        if (isRelevant) {
          suggestions.push({
            type: "time_based",
            title: r.label,
            subtitle: `Head to ${r.label.toLowerCase()} now?`,
            destination: r.address,
            destLat: Number(r.lat),
            destLng: Number(r.lng),
            confidence: 0.9,
            icon: r.label === "Home" ? "??" : "??",
          });
        }
      }
    }
  } catch (e: any) {
    console.error("[AI] Smart suggestions error:", e.message);
  }

  suggestions.sort((a, b) => b.confidence - a.confidence);
  return suggestions.slice(0, 5);
}

function truncateAddr(addr: string): string {
  if (!addr) return "";
  const parts = addr.split(",");
  return parts.length > 2 ? parts.slice(0, 2).join(",").trim() : addr.trim();
}


// -- 4. AI SAFETY MONITOR --------------------------------------------------
export interface SafetyAlert {
  type: "route_deviation" | "abnormal_stop" | "inactivity" | "speed_anomaly" | "sos";
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  tripId: string;
  driverId?: string;
  customerId?: string;
  lat?: number;
  lng?: number;
}

interface TripWaypoint {
  lat: number;
  lng: number;
  timestamp: number;
  speed?: number;
}

const SAFETY_THRESHOLDS = {
  routeDeviationKm: 2.0,
  abnormalStopMinutes: 10,
  inactivityMinutes: 15,
  maxSpeedKmh: 120,
  minExpectedSpeedKmh: 5,
};

export function checkRouteDeviation(
  currentLat: number,
  currentLng: number,
  pickupLat: number,
  pickupLng: number,
  destLat: number,
  destLng: number,
  tripId: string
): SafetyAlert | null {
  const distToRoute = pointToLineDistance(
    currentLat, currentLng,
    pickupLat, pickupLng,
    destLat, destLng
  );

  if (distToRoute > SAFETY_THRESHOLDS.routeDeviationKm) {
    return {
      type: "route_deviation",
      severity: distToRoute > 5 ? "high" : "medium",
      message: `Vehicle deviated ${distToRoute.toFixed(1)}km from expected route`,
      tripId,
      lat: currentLat,
      lng: currentLng,
    };
  }
  return null;
}

export function checkAbnormalStop(
  waypoints: TripWaypoint[],
  tripId: string
): SafetyAlert | null {
  if (waypoints.length < 3) return null;

  const recent = waypoints.slice(-6);
  const allStopped = recent.every(w => (w.speed ?? 0) < 2);

  if (allStopped && recent.length >= 3) {
    const elapsedMin = (recent[recent.length - 1].timestamp - recent[0].timestamp) / 60000;
    if (elapsedMin >= SAFETY_THRESHOLDS.abnormalStopMinutes) {
      return {
        type: "abnormal_stop",
        severity: elapsedMin > 20 ? "high" : "medium",
        message: `Vehicle stopped for ${Math.round(elapsedMin)} minutes at an unusual location`,
        tripId,
        lat: recent[recent.length - 1].lat,
        lng: recent[recent.length - 1].lng,
      };
    }
  }
  return null;
}

export function checkSpeedAnomaly(
  speed: number,
  tripId: string,
  lat: number,
  lng: number
): SafetyAlert | null {
  const speedKmh = speed * 3.6;
  if (speedKmh > SAFETY_THRESHOLDS.maxSpeedKmh) {
    return {
      type: "speed_anomaly",
      severity: speedKmh > 150 ? "critical" : "high",
      message: `Excessive speed detected: ${Math.round(speedKmh)} km/h`,
      tripId,
      lat,
      lng,
    };
  }
  return null;
}

function pointToLineDistance(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const A = px - ax;
  const B = py - ay;
  const C = bx - ax;
  const D = by - ay;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = lenSq !== 0 ? dot / lenSq : -1;

  let xx, yy;
  if (param < 0) { xx = ax; yy = ay; }
  else if (param > 1) { xx = bx; yy = by; }
  else { xx = ax + param * C; yy = ay + param * D; }

  const dx = (px - xx) * 111.32;
  const dy = (py - yy) * 111.32 * Math.cos(px * Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy);
}


// -- 5. AI DEMAND HEATMAP --------------------------------------------------
export interface DemandZone {
  zoneName: string;
  centerLat: number;
  centerLng: number;
  demandLevel: "low" | "medium" | "high" | "surge";
  activeRequests: number;
  availableDrivers: number;
  surgeMultiplier: number;
  prediction: string;
}

export async function getDemandHeatmap(): Promise<DemandZone[]> {
  const zones: DemandZone[] = [];

  try {
    const zoneData = await rawDb.execute(rawSql`
      SELECT
        z.id, z.name, z.latitude, z.longitude, z.surge_factor,
        COALESCE(active.cnt, 0) as active_requests,
        COALESCE(drivers.cnt, 0) as available_drivers,
        COALESCE(recent.cnt, 0) as recent_trips_1h
      FROM zones z
      LEFT JOIN (
        SELECT
          (SELECT zz.id FROM zones zz
           ORDER BY SQRT(POW(zz.latitude - t.pickup_lat, 2) + POW(zz.longitude - t.pickup_lng, 2)) ASC
           LIMIT 1) as zone_id,
          COUNT(*) as cnt
        FROM trip_requests t
        WHERE t.current_status = 'searching'
        GROUP BY zone_id
      ) active ON active.zone_id = z.id
      LEFT JOIN (
        SELECT
          (SELECT zz.id FROM zones zz
           ORDER BY SQRT(POW(zz.latitude - dl.lat, 2) + POW(zz.longitude - dl.lng, 2)) ASC
           LIMIT 1) as zone_id,
          COUNT(*) as cnt
        FROM driver_locations dl
        JOIN users u ON u.id = dl.driver_id
        WHERE dl.is_online = true AND u.current_trip_id IS NULL AND u.is_active = true
        GROUP BY zone_id
      ) drivers ON drivers.zone_id = z.id
      LEFT JOIN (
        SELECT
          (SELECT zz.id FROM zones zz
           ORDER BY SQRT(POW(zz.latitude - t.pickup_lat, 2) + POW(zz.longitude - t.pickup_lng, 2)) ASC
           LIMIT 1) as zone_id,
          COUNT(*) as cnt
        FROM trip_requests t
        WHERE t.created_at > NOW() - INTERVAL '1 hour'
          AND t.current_status IN ('completed', 'searching', 'accepted', 'arrived', 'on_the_way')
        GROUP BY zone_id
      ) recent ON recent.zone_id = z.id
      WHERE z.is_active = true
      ORDER BY z.name
    `);

    for (const row of zoneData.rows) {
      const r = row as any;
      const activeReqs = Number(r.active_requests) || 0;
      const availDrivers = Number(r.available_drivers) || 0;
      const recentTrips = Number(r.recent_trips_1h) || 0;
      const surgeFactor = Number(r.surge_factor) || 1.0;

      const supplyDemandRatio = availDrivers > 0 ? activeReqs / availDrivers : activeReqs > 0 ? 99 : 0;

      let demandLevel: DemandZone["demandLevel"] = "low";
      let surgeMultiplier = 1.0;

      if (supplyDemandRatio > 3 || (activeReqs >= 5 && availDrivers < 2)) {
        demandLevel = "surge";
        surgeMultiplier = Math.min(surgeFactor * 1.5, 3.0);
      } else if (supplyDemandRatio > 1.5 || activeReqs >= 3) {
        demandLevel = "high";
        surgeMultiplier = Math.min(surgeFactor * 1.2, 2.0);
      } else if (activeReqs >= 1 || recentTrips >= 3) {
        demandLevel = "medium";
        surgeMultiplier = surgeFactor;
      }

      let prediction = "Normal demand expected";
      const hour = new Date().getHours();
      if (hour >= 8 && hour <= 10) prediction = "Morning rush � demand rising";
      else if (hour >= 17 && hour <= 20) prediction = "Evening rush � high demand expected";
      else if (hour >= 22 || hour < 6) prediction = "Night hours � low demand";
      else if (recentTrips > 5) prediction = "Trending up � demand increasing";

      zones.push({
        zoneName: r.name || `Zone ${r.id}`,
        centerLat: Number(r.latitude) || 0,
        centerLng: Number(r.longitude) || 0,
        demandLevel,
        activeRequests: activeReqs,
        availableDrivers: availDrivers,
        surgeMultiplier: Math.round(surgeMultiplier * 100) / 100,
        prediction,
      });
    }
  } catch (e: any) {
    console.error("[AI] Demand heatmap error:", e.message);
  }

  return zones;
}


// -- 6. DRIVER STATS UPDATER ----------------------------------------------
export async function updateDriverStats(driverId: string): Promise<void> {
  try {
    await rawDb.execute(rawSql`
      INSERT INTO driver_stats (driver_id, total_trips, completed_trips, cancelled_trips, avg_response_time_sec, completion_rate, avg_rating, updated_at)
      SELECT
        ${driverId}::uuid,
        COUNT(*) as total_trips,
        COUNT(*) FILTER (WHERE current_status = 'completed') as completed_trips,
        COUNT(*) FILTER (WHERE current_status = 'cancelled') as cancelled_trips,
        COALESCE(
          AVG(
            CASE WHEN driver_accepted_at IS NOT NULL AND created_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (driver_accepted_at - created_at))
            END
          ), 60
        ) as avg_response_time_sec,
        CASE WHEN COUNT(*) > 0
          THEN COUNT(*) FILTER (WHERE current_status = 'completed')::float / COUNT(*)
          ELSE 0.8
        END as completion_rate,
        COALESCE((SELECT rating FROM users WHERE id = ${driverId}::uuid), 4.0) as avg_rating,
        NOW()
      FROM trip_requests
      WHERE driver_id = ${driverId}::uuid
      ON CONFLICT (driver_id) DO UPDATE SET
        total_trips = EXCLUDED.total_trips,
        completed_trips = EXCLUDED.completed_trips,
        cancelled_trips = EXCLUDED.cancelled_trips,
        avg_response_time_sec = EXCLUDED.avg_response_time_sec,
        completion_rate = EXCLUDED.completion_rate,
        avg_rating = EXCLUDED.avg_rating,
        updated_at = NOW()
    `);
  } catch (e: any) {
    console.error("[AI] Update driver stats error:", e.message);
  }
}


// -- 7. TRIP WAYPOINT TRACKER (for safety monitoring) -----------------------
const tripWaypoints = new Map<string, TripWaypoint[]>();

export function recordWaypoint(tripId: string, lat: number, lng: number, speed?: number): void {
  if (!tripWaypoints.has(tripId)) {
    tripWaypoints.set(tripId, []);
  }
  const waypoints = tripWaypoints.get(tripId)!;
  waypoints.push({ lat, lng, timestamp: Date.now(), speed });
  if (waypoints.length > 100) {
    waypoints.splice(0, waypoints.length - 100);
  }
}

export function getTripWaypoints(tripId: string): TripWaypoint[] {
  return tripWaypoints.get(tripId) || [];
}

export function clearTripWaypoints(tripId: string): void {
  tripWaypoints.delete(tripId);
}


// -- 8. DB TABLES INITIALIZATION ------------------------------------------
export async function initAiTables(): Promise<void> {
  try {
    const { assertSchemaObjectsOrThrow } = await import("./schema-health");
    await assertSchemaObjectsOrThrow({
      tables: ["driver_stats", "ai_safety_alerts", "demand_predictions"],
      indexes: [
        { table: "driver_stats", pattern: "%driver_id%", description: "driver_stats driver index" },
        { table: "ai_safety_alerts", pattern: "%trip_id%", description: "ai_safety_alerts trip index" },
        { table: "ai_safety_alerts", pattern: "%resolved%created_at%", description: "ai_safety_alerts unresolved index" },
      ],
    });
    console.log("[AI] Tables verified");
  } catch (e: any) {
    console.error("[AI] Table init error:", formatDbError(e));
  }
}


// -- 9. BATCH DRIVER STATS REFRESH ----------------------------------------
export async function refreshAllDriverStats(): Promise<void> {
  try {
    const drivers = await rawDb.execute(rawSql`
      SELECT DISTINCT driver_id FROM trip_requests WHERE driver_id IS NOT NULL
    `);
    for (const row of drivers.rows) {
      await updateDriverStats((row as any).driver_id);
    }
    console.log(`[AI] Refreshed stats for ${drivers.rows.length} drivers`);
  } catch (e: any) {
    console.error("[AI] Refresh all driver stats error:", formatDbError(e));
  }
}


// -- 10. GHOST DRIVER AUTO-OFFLINE JOB ------------------------------------
// Drivers inactive > 5 minutes (no location ping) are marked offline automatically.
// This prevents ghost drivers appearing in matching even after app crash / network loss.
export async function autoOfflineInactiveDrivers(): Promise<void> {
  try {
    const r = await rawDb.execute(rawSql`
      UPDATE driver_locations dl
      SET is_online = false
      FROM users u
      WHERE dl.driver_id = u.id
        AND dl.is_online = true
        AND dl.updated_at < NOW() - INTERVAL '5 minutes'
        AND u.current_trip_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM trip_requests tr
          WHERE tr.driver_id = dl.driver_id
            AND tr.current_status IN ('accepted', 'arrived', 'on_the_way', 'payment_pending')
        )
      RETURNING dl.driver_id
    `);
    if (r.rows.length > 0) {
      const ids = (r.rows as any[]).map(row => row.driver_id);
      // Also update users table
      for (const driverId of ids) {
        await rawDb.execute(rawSql`
          UPDATE users SET is_online = false WHERE id = ${driverId}::uuid
        `).catch(() => { });
      }
      console.log(`[AI] Auto-offlined ${r.rows.length} inactive drivers: ${ids.join(', ')}`);
    }
  } catch (e: any) {
    console.error("[AI] Auto-offline error:", formatDbError(e));
  }
}


