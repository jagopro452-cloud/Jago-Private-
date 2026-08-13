/**
 * Advanced Mobility Intelligence Systems
 *
 * 1. Demand Heatmap System — real-time demand zones with intensity (green/yellow/red)
 * 2. Surge Pricing Engine — dynamic pricing based on demand/supply/weather/peak hours
 * 3. Driver Behavior Scoring — composite score (rating + acceptance + completion + on-time)
 * 4. Fraud Detection — suspicious pattern flagging
 * 5. Driver Earnings Forecast — estimated earnings based on demand/surge/history
 * 6. Driver Rebalancing — push drivers toward high-demand zones
 * 7. Real-Time Operations Dashboard — live KPIs for admin
 */

import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { assertSchemaObjectsOrThrow } from "./schema-health";
import { io } from "./socket";
import { notifyUser } from "./notification-service";
import { activeDriverEligibilitySql } from "./driver-state";

// ════════════════════════════════════════════════════════════════════════════
//  1. DEMAND HEATMAP SYSTEM
// ════════════════════════════════════════════════════════════════════════════

export interface HeatmapZone {
  zoneId: string;
  zoneName: string;
  centerLat: number;
  centerLng: number;
  demandIntensity: "low" | "medium" | "high";
  color: "green" | "yellow" | "red";
  requestsLast10Min: number;
  driversOnline: number;
  activeTrips: number;
  demandRatio: number;
  surgeMultiplier: number;
}

/**
 * Compute demand heatmap using:
 * - trips requested in last 10 minutes
 * - drivers online
 * - active trips
 */
export async function computeDemandHeatmap(): Promise<HeatmapZone[]> {
  const zones: HeatmapZone[] = [];

  try {
    const data = await rawDb.execute(rawSql`
      SELECT
        z.id, z.name, z.latitude, z.longitude, COALESCE(z.surge_factor, 1.0) as surge_factor,
        COALESCE(r10.cnt, 0) as requests_10min,
        COALESCE(donline.cnt, 0) as drivers_online,
        COALESCE(active.cnt, 0) as active_trips
      FROM zones z
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as cnt FROM trip_requests t
        WHERE t.created_at > NOW() - INTERVAL '10 minutes'
          AND t.current_status IN ('searching', 'driver_assigned', 'accepted', 'arrived', 'on_the_way')
          AND SQRT(POW((t.pickup_lat - z.latitude)*111.32, 2) + POW((t.pickup_lng - z.longitude)*111.32*COS(RADIANS(z.latitude)), 2)) < 5
      ) r10 ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as cnt FROM driver_locations dl
        JOIN users u ON u.id = dl.driver_id
        WHERE dl.is_online = true AND u.is_active = true AND u.current_trip_id IS NULL
          AND SQRT(POW((dl.lat - z.latitude)*111.32, 2) + POW((dl.lng - z.longitude)*111.32*COS(RADIANS(z.latitude)), 2)) < 5
      ) donline ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as cnt FROM trip_requests t
        WHERE t.current_status IN ('accepted', 'arrived', 'on_the_way')
          AND SQRT(POW((t.pickup_lat - z.latitude)*111.32, 2) + POW((t.pickup_lng - z.longitude)*111.32*COS(RADIANS(z.latitude)), 2)) < 5
      ) active ON TRUE
      WHERE z.is_active = true
      ORDER BY z.name
    `);

    for (const row of data.rows) {
      const r = row as any;
      const requests = Number(r.requests_10min) || 0;
      const drivers = Number(r.drivers_online) || 0;
      const activeTrips = Number(r.active_trips) || 0;
      const surgeFactor = Number(r.surge_factor) || 1.0;

      const demandRatio = drivers > 0 ? requests / drivers : (requests > 0 ? 10.0 : 0);

      let demandIntensity: HeatmapZone["demandIntensity"] = "low";
      let color: HeatmapZone["color"] = "green";
      let surgeMultiplier = 1.0;

      if (demandRatio > 2.0 || (requests >= 5 && drivers < 2)) {
        demandIntensity = "high";
        color = "red";
        surgeMultiplier = Math.min(surgeFactor * 1.5, 3.0);
      } else if (demandRatio > 1.0 || requests >= 3) {
        demandIntensity = "medium";
        color = "yellow";
        surgeMultiplier = Math.min(surgeFactor * 1.2, 2.0);
      } else {
        surgeMultiplier = surgeFactor;
      }

      zones.push({
        zoneId: r.id,
        zoneName: r.name || `Zone`,
        centerLat: Number(r.latitude) || 0,
        centerLng: Number(r.longitude) || 0,
        demandIntensity,
        color,
        requestsLast10Min: requests,
        driversOnline: drivers,
        activeTrips,
        demandRatio: Math.round(demandRatio * 100) / 100,
        surgeMultiplier: Math.round(surgeMultiplier * 100) / 100,
      });
    }
  } catch (e: any) {
    console.error("[HEATMAP] Error:", e.message);
  }

  return zones;
}

// ════════════════════════════════════════════════════════════════════════════
//  2. SURGE PRICING ENGINE
// ════════════════════════════════════════════════════════════════════════════

export interface SurgeConfig {
  id?: string;
  zoneId: string | null;
  serviceType: string;       // 'all', 'bike', 'auto', 'cab', 'parcel', etc.
  minMultiplier: number;     // floor (default 1.0)
  maxMultiplier: number;     // cap (default 3.0)
  demandThreshold: number;   // demand/supply ratio to trigger surge
  peakHoursEnabled: boolean;
  peakHourStart: number;     // 0-23
  peakHourEnd: number;       // 0-23
  peakHourMultiplier: number;
  weatherMultiplier: number; // extra on bad weather
  manualSurge: number | null;// admin override (null = auto)
  isActive: boolean;
}

const DEFAULT_SURGE: SurgeConfig = {
  zoneId: null,
  serviceType: "all",
  minMultiplier: 1.0,
  maxMultiplier: 3.0,
  demandThreshold: 1.5,
  peakHoursEnabled: true,
  peakHourStart: 8,
  peakHourEnd: 10,
  peakHourMultiplier: 1.3,
  weatherMultiplier: 1.0,
  manualSurge: null,
  isActive: true,
};

/**
 * Calculate the surge multiplier for a specific location and service type.
 * Formula: surge_multiplier = clamp(demand/supply * factors, 1.0, 3.0)
 */
export async function calculateSurgeMultiplier(
  pickupLat: number,
  pickupLng: number,
  serviceType: string = "all"
): Promise<{ multiplier: number; reason: string; components: Record<string, number> }> {
  let baseSurge = 1.0;
  let reason = "Normal pricing";
  const components: Record<string, number> = { demand: 1.0, peak: 1.0, weather: 1.0, manual: 0 };

  try {
    // 1. Load surge config from DB (nearest zone or global)
    const configRes = await rawDb.execute(rawSql`
      SELECT * FROM surge_configs
      WHERE is_active = true
        AND (service_type = ${serviceType} OR service_type = 'all')
      ORDER BY
        CASE WHEN service_type = ${serviceType} THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT 1
    `);

    const cfg = configRes.rows.length
      ? mapSurgeConfig(configRes.rows[0] as any)
      : DEFAULT_SURGE;

    // Check manual override first
    if (cfg.manualSurge && cfg.manualSurge > 0) {
      const clamped = Math.min(Math.max(cfg.manualSurge, cfg.minMultiplier), cfg.maxMultiplier);
      return {
        multiplier: Math.round(clamped * 100) / 100,
        reason: "Admin-set surge pricing",
        components: { ...components, manual: clamped },
      };
    }

    // 2. Demand/supply ratio in 5km radius
    const nearby = await rawDb.execute(rawSql`
      SELECT
        (SELECT COUNT(*) FROM trip_requests
         WHERE current_status IN ('searching', 'driver_assigned')
           AND created_at > NOW() - INTERVAL '10 minutes'
           AND SQRT(POW((pickup_lat - ${Number(pickupLat)})*111.32, 2) + POW((pickup_lng - ${Number(pickupLng)})*111.32*COS(RADIANS(${Number(pickupLat)})), 2)) < 5
        ) as demand,
        (SELECT COUNT(*) FROM driver_locations dl
         JOIN users u ON u.id = dl.driver_id
         WHERE dl.is_online = true AND u.is_active = true AND u.current_trip_id IS NULL
           AND SQRT(POW((dl.lat - ${Number(pickupLat)})*111.32, 2) + POW((dl.lng - ${Number(pickupLng)})*111.32*COS(RADIANS(${Number(pickupLat)})), 2)) < 5
        ) as supply
    `);

    const demand = Number((nearby.rows[0] as any)?.demand) || 0;
    const supply = Number((nearby.rows[0] as any)?.supply) || 1;
    const demandRatio = demand / Math.max(supply, 1);

    if (demandRatio > cfg.demandThreshold) {
      components.demand = Math.min(demandRatio / cfg.demandThreshold, 2.0);
      baseSurge = 1.0 + (components.demand - 1.0) * 0.8;
      reason = `High demand (${demand} requests, ${supply} drivers)`;
    }

    // 3. Peak hour check
    const hour = new Date().getHours();
    if (cfg.peakHoursEnabled) {
      const isInPeakRange = cfg.peakHourStart <= cfg.peakHourEnd
        ? (hour >= cfg.peakHourStart && hour < cfg.peakHourEnd)
        : (hour >= cfg.peakHourStart || hour < cfg.peakHourEnd);
      if (isInPeakRange) {
        components.peak = cfg.peakHourMultiplier;
        baseSurge *= cfg.peakHourMultiplier;
        reason += " + Peak hours";
      }
    }

    // 4. Weather multiplier (stored/updated externally — default 1.0)
    if (cfg.weatherMultiplier > 1.0) {
      components.weather = cfg.weatherMultiplier;
      baseSurge *= cfg.weatherMultiplier;
      reason += " + Bad weather";
    }

    // Clamp
    const clamped = Math.min(Math.max(baseSurge, cfg.minMultiplier), cfg.maxMultiplier);

    return {
      multiplier: Math.round(clamped * 100) / 100,
      reason: clamped > 1.05 ? reason : "Normal pricing",
      components,
    };
  } catch (e: any) {
    console.error("[SURGE] Error:", e.message);
    return { multiplier: 1.0, reason: "Normal pricing", components };
  }
}

function mapSurgeConfig(row: any): SurgeConfig {
  return {
    id: row.id,
    zoneId: row.zone_id,
    serviceType: row.service_type || "all",
    minMultiplier: Number(row.min_multiplier) || 1.0,
    maxMultiplier: Number(row.max_multiplier) || 3.0,
    demandThreshold: Number(row.demand_threshold) || 1.5,
    peakHoursEnabled: row.peak_hours_enabled !== false,
    peakHourStart: Number(row.peak_hour_start) ?? 8,
    peakHourEnd: Number(row.peak_hour_end) ?? 10,
    peakHourMultiplier: Number(row.peak_hour_multiplier) || 1.3,
    weatherMultiplier: Number(row.weather_multiplier) || 1.0,
    manualSurge: row.manual_surge ? Number(row.manual_surge) : null,
    isActive: row.is_active !== false,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  3. DRIVER BEHAVIOR SCORING
// ════════════════════════════════════════════════════════════════════════════

export interface DriverBehaviorScore {
  driverId: string;
  overallScore: number;       // 0-100
  ratingScore: number;        // 30%
  acceptanceRate: number;     // 25%
  completionRate: number;     // 25%
  onTimeArrival: number;      // 20%
  grade: "A" | "B" | "C" | "D" | "F";
  totalTrips: number;
  updatedAt: string;
}

const BEHAVIOR_WEIGHTS = {
  rating: 0.30,
  acceptance: 0.25,
  completion: 0.25,
  onTime: 0.20,
};

/**
 * Calculate and persist driver behavior score.
 * score = rating(30%) + acceptance_rate(25%) + completion_rate(25%) + on_time_arrival(20%)
 */
export async function calculateDriverBehaviorScore(driverId: string): Promise<DriverBehaviorScore | null> {
  try {
    const stats = await rawDb.execute(rawSql`
      SELECT
        u.rating,
        COALESCE(ds.total_trips, 0) as total_trips,
        COALESCE(ds.completed_trips, 0) as completed_trips,
        COALESCE(ds.cancelled_trips, 0) as cancelled_trips,
        COALESCE(ds.completion_rate, 0.8) as completion_rate,
        COALESCE(ds.avg_response_time_sec, 60) as avg_response_time_sec,
        -- acceptance_rate = accepted trips / total offered trips
        COALESCE((
          SELECT COUNT(*) FILTER(WHERE current_status NOT IN ('cancelled'))::float
            / GREATEST(COUNT(*), 1)
          FROM trip_requests WHERE driver_id = ${driverId}::uuid
        ), 0.8) as acceptance_rate,
        -- on-time arrival: trips where driver arrived within 2 min of ETA
        COALESCE((
          SELECT COUNT(*) FILTER(
            WHERE driver_accepted_at IS NOT NULL
              AND driver_arrived_at IS NOT NULL
              AND EXTRACT(EPOCH FROM (driver_arrived_at - driver_accepted_at)) < 600
          )::float / GREATEST(COUNT(*) FILTER(WHERE driver_arrived_at IS NOT NULL), 1)
          FROM trip_requests WHERE driver_id = ${driverId}::uuid
        ), 0.7) as on_time_rate
      FROM users u
      LEFT JOIN driver_stats ds ON ds.driver_id = u.id
      WHERE u.id = ${driverId}::uuid
    `);

    if (!stats.rows.length) return null;
    const r = stats.rows[0] as any;

    const rating = Math.min(Number(r.rating) || 3.0, 5.0);
    const acceptanceRate = Math.min(Number(r.acceptance_rate) || 0.8, 1.0);
    const completionRate = Math.min(Number(r.completion_rate) || 0.8, 1.0);
    const onTimeRate = Math.min(Number(r.on_time_rate) || 0.7, 1.0);

    // Normalize rating to 0-1 scale (rating is 1-5)
    const ratingNorm = (rating - 1) / 4;

    const overallRaw =
      ratingNorm * BEHAVIOR_WEIGHTS.rating +
      acceptanceRate * BEHAVIOR_WEIGHTS.acceptance +
      completionRate * BEHAVIOR_WEIGHTS.completion +
      onTimeRate * BEHAVIOR_WEIGHTS.onTime;

    const overallScore = Math.round(overallRaw * 100);

    let grade: DriverBehaviorScore["grade"] = "F";
    if (overallScore >= 85) grade = "A";
    else if (overallScore >= 70) grade = "B";
    else if (overallScore >= 55) grade = "C";
    else if (overallScore >= 40) grade = "D";

    // Persist to driver_behavior_scores table
    await rawDb.execute(rawSql`
      INSERT INTO driver_behavior_scores (driver_id, overall_score, rating_score, acceptance_rate, completion_rate, on_time_arrival, grade, total_trips, updated_at)
      VALUES (${driverId}::uuid, ${overallScore}, ${Math.round(ratingNorm * 100)}, ${Math.round(acceptanceRate * 100)}, ${Math.round(completionRate * 100)}, ${Math.round(onTimeRate * 100)}, ${grade}, ${Number(r.total_trips) || 0}, NOW())
      ON CONFLICT (driver_id) DO UPDATE SET
        overall_score = EXCLUDED.overall_score,
        rating_score = EXCLUDED.rating_score,
        acceptance_rate = EXCLUDED.acceptance_rate,
        completion_rate = EXCLUDED.completion_rate,
        on_time_arrival = EXCLUDED.on_time_arrival,
        grade = EXCLUDED.grade,
        total_trips = EXCLUDED.total_trips,
        updated_at = NOW()
    `);

    return {
      driverId,
      overallScore,
      ratingScore: Math.round(ratingNorm * 100),
      acceptanceRate: Math.round(acceptanceRate * 100),
      completionRate: Math.round(completionRate * 100),
      onTimeArrival: Math.round(onTimeRate * 100),
      grade,
      totalTrips: Number(r.total_trips) || 0,
      updatedAt: new Date().toISOString(),
    };
  } catch (e: any) {
    console.error("[BEHAVIOR] Score calc error:", e.message);
    return null;
  }
}

/**
 * Refresh behavior scores for all active drivers (batch job).
 */
export async function refreshAllBehaviorScores(): Promise<number> {
  try {
    const drivers = await rawDb.execute(rawSql`
      SELECT id FROM users WHERE user_type = 'driver' AND is_active = true
    `);
    let count = 0;
    for (const row of drivers.rows) {
      await calculateDriverBehaviorScore((row as any).id);
      count++;
    }
    console.log(`[BEHAVIOR] Refreshed scores for ${count} drivers`);
    return count;
  } catch (e: any) {
    console.error("[BEHAVIOR] Batch refresh error:", e.message);
    return 0;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  4. FRAUD DETECTION SYSTEM
// ════════════════════════════════════════════════════════════════════════════

export interface FraudFlag {
  id?: string;
  userId: string;
  userType: "driver" | "customer";
  flagType: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  evidence: Record<string, any>;
  status: "pending" | "reviewed" | "dismissed" | "confirmed";
  createdAt: string;
}

/**
 * Run fraud detection checks for a user.
 * Patterns:
 * - Same driver + same customer repeatedly (possible collusion)
 * - Abnormally short ride distances (fake rides)
 * - Too many cancellations (abuse)
 * - Abnormal ride distance (GPS spoofing)
 */
export async function detectFraudPatterns(userId: string, userType: "driver" | "customer"): Promise<FraudFlag[]> {
  const flags: FraudFlag[] = [];

  try {
    // 1. Same driver + same customer repeated (collusion check)
    const collusionQuery = userType === "driver"
      ? rawSql`
        SELECT customer_id as pair_id, COUNT(*) as trip_count
        FROM trip_requests
        WHERE driver_id = ${userId}::uuid AND current_status = 'completed'
          AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY customer_id
        HAVING COUNT(*) >= 5
      `
      : rawSql`
        SELECT driver_id as pair_id, COUNT(*) as trip_count
        FROM trip_requests
        WHERE customer_id = ${userId}::uuid AND current_status = 'completed'
          AND created_at > NOW() - INTERVAL '7 days'
        GROUP BY driver_id
        HAVING COUNT(*) >= 5
      `;

    const collusion = await rawDb.execute(collusionQuery);
    for (const row of collusion.rows) {
      const r = row as any;
      flags.push({
        userId,
        userType,
        flagType: "repeated_pair",
        severity: Number(r.trip_count) >= 10 ? "high" : "medium",
        description: `${Number(r.trip_count)} trips with same ${userType === "driver" ? "customer" : "driver"} in 7 days`,
        evidence: { pairId: r.pair_id, tripCount: Number(r.trip_count) },
        status: "pending",
        createdAt: new Date().toISOString(),
      });
    }

    // 2. Abnormally short rides (fake short rides)
    if (userType === "driver") {
      const shortRides = await rawDb.execute(rawSql`
        SELECT COUNT(*) as cnt FROM trip_requests
        WHERE driver_id = ${userId}::uuid
          AND current_status = 'completed'
          AND estimated_distance IS NOT NULL
          AND estimated_distance < 0.5
          AND created_at > NOW() - INTERVAL '7 days'
      `);
      const shortCount = Number((shortRides.rows[0] as any)?.cnt) || 0;
      if (shortCount >= 5) {
        flags.push({
          userId,
          userType,
          flagType: "fake_short_rides",
          severity: shortCount >= 10 ? "high" : "medium",
          description: `${shortCount} rides under 0.5km in 7 days`,
          evidence: { shortRideCount: shortCount },
          status: "pending",
          createdAt: new Date().toISOString(),
        });
      }
    }

    // 3. Too many cancellations
    const cancellations = await rawDb.execute(rawSql`
      SELECT COUNT(*) as cnt FROM trip_requests
      WHERE ${userType === "driver" ? rawSql`driver_id` : rawSql`customer_id`} = ${userId}::uuid
        AND current_status = 'cancelled'
        AND cancelled_by = ${userType}
        AND created_at > NOW() - INTERVAL '7 days'
    `);
    const cancelCount = Number((cancellations.rows[0] as any)?.cnt) || 0;
    if (cancelCount >= 10) {
      flags.push({
        userId,
        userType,
        flagType: "excessive_cancellations",
        severity: cancelCount >= 20 ? "high" : "medium",
        description: `${cancelCount} cancellations in 7 days`,
        evidence: { cancellationCount: cancelCount },
        status: "pending",
        createdAt: new Date().toISOString(),
      });
    }

    // 4. Abnormal ride distances (GPS spoofing indicator)
    if (userType === "driver") {
      const abnormalDist = await rawDb.execute(rawSql`
        SELECT COUNT(*) as cnt FROM trip_requests
        WHERE driver_id = ${userId}::uuid
          AND current_status = 'completed'
          AND estimated_distance IS NOT NULL
          AND actual_distance IS NOT NULL
          AND actual_distance > 0
          AND ABS(estimated_distance - actual_distance) / GREATEST(estimated_distance, 1) > 0.5
          AND created_at > NOW() - INTERVAL '7 days'
      `);
      const abnormalCount = Number((abnormalDist.rows[0] as any)?.cnt) || 0;
      if (abnormalCount >= 3) {
        flags.push({
          userId,
          userType,
          flagType: "distance_mismatch",
          severity: abnormalCount >= 7 ? "critical" : "high",
          description: `${abnormalCount} rides with >50% distance mismatch in 7 days`,
          evidence: { abnormalDistanceCount: abnormalCount },
          status: "pending",
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Persist new flags
    for (const flag of flags) {
      // Avoid duplicating flags for the same type+user in the last 24 hours
      const existing = await rawDb.execute(rawSql`
        SELECT id FROM fraud_flags
        WHERE user_id = ${flag.userId}::uuid
          AND flag_type = ${flag.flagType}
          AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1
      `);
      if (!existing.rows.length) {
        await rawDb.execute(rawSql`
          INSERT INTO fraud_flags (user_id, user_type, flag_type, severity, description, evidence, status)
          VALUES (${flag.userId}::uuid, ${flag.userType}, ${flag.flagType}, ${flag.severity}, ${flag.description}, ${JSON.stringify(flag.evidence)}::jsonb, 'pending')
        `);
      }
    }
  } catch (e: any) {
    console.error("[FRAUD] Detection error:", e.message);
  }

  return flags;
}

/**
 * Run fraud scan for all active drivers and customers with threshold trip counts.
 */
export async function runFraudScan(): Promise<number> {
  let flagCount = 0;
  try {
    // Scan active drivers with >5 trips in last 7 days
    const drivers = await rawDb.execute(rawSql`
      SELECT DISTINCT driver_id FROM trip_requests
      WHERE driver_id IS NOT NULL AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY driver_id HAVING COUNT(*) >= 5
    `);
    for (const row of drivers.rows) {
      const flags = await detectFraudPatterns((row as any).driver_id, "driver");
      flagCount += flags.length;
    }

    // Scan customers with >5 trips
    const customers = await rawDb.execute(rawSql`
      SELECT DISTINCT customer_id FROM trip_requests
      WHERE customer_id IS NOT NULL AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY customer_id HAVING COUNT(*) >= 5
    `);
    for (const row of customers.rows) {
      const flags = await detectFraudPatterns((row as any).customer_id, "customer");
      flagCount += flags.length;
    }

    console.log(`[FRAUD] Scan complete — ${flagCount} new flags`);
  } catch (e: any) {
    console.error("[FRAUD] Scan error:", e.message);
  }
  return flagCount;
}

// ════════════════════════════════════════════════════════════════════════════
//  5. DRIVER EARNINGS FORECAST
// ════════════════════════════════════════════════════════════════════════════

export interface EarningsForecast {
  driverId: string;
  zoneName: string;
  estimatedMinEarnings: number;
  estimatedMaxEarnings: number;
  demandLevel: string;
  surgeMultiplier: number;
  timeframeHours: number;
  message: string;
}

/**
 * Estimate driver earnings for the next 2 hours based on:
 * - Current demand
 * - Surge multiplier
 * - Historical earnings in that zone
 */
export async function forecastDriverEarnings(
  driverId: string,
  lat: number,
  lng: number
): Promise<EarningsForecast> {
  const DEFAULT_RESULT: EarningsForecast = {
    driverId,
    zoneName: "Your Area",
    estimatedMinEarnings: 0,
    estimatedMaxEarnings: 0,
    demandLevel: "low",
    surgeMultiplier: 1.0,
    timeframeHours: 2,
    message: "Keep driving for ride requests",
  };

  try {
    // Find nearest zone
    const zoneRes = await rawDb.execute(rawSql`
      SELECT id, name, COALESCE(surge_factor, 1.0) as surge_factor
      FROM zones WHERE is_active = true
      ORDER BY SQRT(POW((latitude - ${Number(lat)})*111.32, 2) + POW((longitude - ${Number(lng)})*111.32*COS(RADIANS(${Number(lat)})), 2)) ASC
      LIMIT 1
    `);
    const zone = zoneRes.rows[0] as any;
    const zoneName = zone?.name || "Your Area";

    // Get surge multiplier
    const surgeResult = await calculateSurgeMultiplier(lat, lng);
    const surge = surgeResult.multiplier;

    // Historical earnings: avg fare per completed trip in last 7 days within 5km
    const histRes = await rawDb.execute(rawSql`
      SELECT
        COALESCE(AVG(estimated_fare), 100) as avg_fare,
        COALESCE(COUNT(*), 0) as trip_count,
        COALESCE(AVG(EXTRACT(EPOCH FROM (ride_ended_at - ride_started_at)) / 3600), 0.5) as avg_trip_hours
      FROM trip_requests
      WHERE driver_id = ${driverId}::uuid
        AND current_status = 'completed'
        AND created_at > NOW() - INTERVAL '7 days'
    `);

    const avgFare = Number((histRes.rows[0] as any)?.avg_fare) || 100;
    const tripCount = Number((histRes.rows[0] as any)?.trip_count) || 0;
    const avgTripHours = Number((histRes.rows[0] as any)?.avg_trip_hours) || 0.5;

    // Estimate trips per 2 hours based on history + demand
    const tripsPerHour = avgTripHours > 0 ? 1 / avgTripHours : 1.5;
    const tripsIn2Hrs = Math.round(tripsPerHour * 2);

    // Get current demand level
    const demandRes = await rawDb.execute(rawSql`
      SELECT COUNT(*) as demand FROM trip_requests
      WHERE current_status IN ('searching', 'driver_assigned')
        AND created_at > NOW() - INTERVAL '10 minutes'
        AND SQRT(POW((pickup_lat - ${Number(lat)})*111.32, 2) + POW((pickup_lng - ${Number(lng)})*111.32*COS(RADIANS(${Number(lat)})), 2)) < 5
    `);
    const demand = Number((demandRes.rows[0] as any)?.demand) || 0;
    let demandLevel = "low";
    if (demand >= 5) demandLevel = "high";
    else if (demand >= 2) demandLevel = "medium";

    // Earnings estimate
    const baseFare = avgFare * surge;
    const minMulti = demandLevel === "high" ? 0.8 : demandLevel === "medium" ? 0.5 : 0.3;
    const maxMulti = demandLevel === "high" ? 1.2 : demandLevel === "medium" ? 0.9 : 0.6;

    const estimatedMin = Math.round(baseFare * tripsIn2Hrs * minMulti);
    const estimatedMax = Math.round(baseFare * tripsIn2Hrs * maxMulti);

    const message = `Estimated earnings next 2 hours: ₹${estimatedMin}–₹${estimatedMax}`;

    return {
      driverId,
      zoneName,
      estimatedMinEarnings: estimatedMin,
      estimatedMaxEarnings: estimatedMax,
      demandLevel,
      surgeMultiplier: surge,
      timeframeHours: 2,
      message,
    };
  } catch (e: any) {
    console.error("[EARNINGS] Forecast error:", e.message);
    return DEFAULT_RESULT;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  6. DRIVER REBALANCING SYSTEM
// ════════════════════════════════════════════════════════════════════════════

export interface RebalancingSuggestion {
  driverId: string;
  targetZoneName: string;
  targetLat: number;
  targetLng: number;
  demandLevel: string;
  distanceKm: number;
  message: string;
}

/**
 * Suggest drivers to move to high-demand zones.
 * Uses demand heatmap data to find nearby high-demand areas.
 */
export async function getRebalancingSuggestion(
  driverId: string,
  driverLat: number,
  driverLng: number
): Promise<RebalancingSuggestion | null> {
  try {
    const heatmap = await computeDemandHeatmap();

    // Find high-demand or medium zones sorted by proximity
    const hotZones = heatmap
      .filter((z) => z.demandIntensity === "high" || (z.demandIntensity === "medium" && z.requestsLast10Min >= 3))
      .map((z) => ({
        ...z,
        distKm: haversineDistance(driverLat, driverLng, z.centerLat, z.centerLng),
      }))
      .filter((z) => z.distKm < 15) // within 15km
      .sort((a, b) => {
        // Prefer high demand over medium, then closer
        const demandOrder = a.demandIntensity === "high" ? 0 : 1;
        const demandOrderB = b.demandIntensity === "high" ? 0 : 1;
        if (demandOrder !== demandOrderB) return demandOrder - demandOrderB;
        return a.distKm - b.distKm;
      });

    if (!hotZones.length) return null;

    const best = hotZones[0];
    return {
      driverId,
      targetZoneName: best.zoneName,
      targetLat: best.centerLat,
      targetLng: best.centerLng,
      demandLevel: best.demandIntensity,
      distanceKm: Math.round(best.distKm * 10) / 10,
      message: `High demand near ${best.zoneName}`,
    };
  } catch (e: any) {
    console.error("[REBALANCE] Error:", e.message);
    return null;
  }
}

/**
 * Push rebalancing notifications to idle drivers in low-demand areas.
 * Called periodically (e.g. every 5 minutes).
 */
export async function pushRebalancingNotifications(): Promise<number> {
  let sent = 0;
  try {
    // Find idle drivers (online, no active trip, in low-demand areas)
    const idleDrivers = await rawDb.execute(rawSql`
      SELECT u.id, dl.lat, dl.lng,
        (SELECT ud.fcm_token FROM user_devices ud WHERE ud.user_id = u.id AND ud.fcm_token IS NOT NULL LIMIT 1) as fcm_token
      FROM users u
      JOIN driver_locations dl ON dl.driver_id = u.id
      WHERE u.user_type = 'driver' AND ${activeDriverEligibilitySql("u")}
        AND dl.is_online = true AND u.current_trip_id IS NULL
      LIMIT 50
    `);

    for (const row of idleDrivers.rows) {
      const d = row as any;
      const suggestion = await getRebalancingSuggestion(d.id, Number(d.lat), Number(d.lng));
      if (suggestion) {
        await notifyUser(d.id, "driver:rebalancing_suggestion", {
          fcmToken: d.fcm_token,
          title: "📍 High Demand Area Nearby",
          body: suggestion.message,
          data: {
            type: "rebalancing_suggestion",
            targetLat: String(suggestion.targetLat),
            targetLng: String(suggestion.targetLng),
            zoneName: suggestion.targetZoneName,
          },
          channelId: "driver_tips",
        });
        sent++;
      }
    }

    if (sent > 0) console.log(`[REBALANCE] Sent ${sent} rebalancing notifications`);
  } catch (e: any) {
    console.error("[REBALANCE] Push error:", e.message);
  }
  return sent;
}

// ════════════════════════════════════════════════════════════════════════════
//  7. REAL-TIME OPERATIONS DASHBOARD
// ════════════════════════════════════════════════════════════════════════════

export interface OperationsDashboard {
  activeRides: number;
  parcelDeliveries: number;
  driversOnline: number;
  pendingRequests: number;
  demandZones: HeatmapZone[];
  liveMarkers: LiveMarker[];
  kpis: {
    totalTripsToday: number;
    totalRevenueToday: number;
    avgTripDurationMin: number;
    cancellationRate: number;
    avgSurgeMultiplier: number;
    fraudFlagsToday: number;
  };
}

export interface LiveMarker {
  id: string;
  type: "driver" | "active_trip" | "searching_trip" | "parcel";
  lat: number;
  lng: number;
  heading?: number;
  label: string;
  status: string;
}

/**
 * Get complete real-time operations dashboard data.
 */
export async function getOperationsDashboard(): Promise<OperationsDashboard> {
  try {
    const [countsRes, kpiRes, markersRes, fraudRes] = await Promise.all([
      // Current counts
      rawDb.execute(rawSql`
        SELECT
          (SELECT COUNT(*) FROM trip_requests WHERE current_status IN ('accepted', 'arrived', 'on_the_way')) as active_rides,
          (SELECT COUNT(*) FROM parcel_orders WHERE current_status IN ('accepted', 'picked_up', 'in_transit')) as parcel_deliveries,
          (SELECT COUNT(*) FROM driver_locations dl JOIN users u ON u.id = dl.driver_id WHERE dl.is_online = true AND u.is_active = true) as drivers_online,
          (SELECT COUNT(*) FROM trip_requests WHERE current_status IN ('searching', 'driver_assigned')) as pending_requests
      `),
      // Today's KPIs
      rawDb.execute(rawSql`
        SELECT
          (SELECT COUNT(*) FROM trip_requests WHERE created_at::date = CURRENT_DATE) as trips_today,
          (SELECT COALESCE(SUM(estimated_fare), 0) FROM trip_requests WHERE current_status = 'completed' AND created_at::date = CURRENT_DATE) as revenue_today,
          (SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (ride_ended_at - ride_started_at)) / 60), 0) FROM trip_requests WHERE current_status = 'completed' AND created_at::date = CURRENT_DATE AND ride_started_at IS NOT NULL AND ride_ended_at IS NOT NULL) as avg_duration_min,
          (SELECT CASE WHEN COUNT(*) > 0 THEN COUNT(*) FILTER(WHERE current_status = 'cancelled')::float / COUNT(*) ELSE 0 END FROM trip_requests WHERE created_at::date = CURRENT_DATE) as cancel_rate
      `),
      // Live markers — drivers + active trips
      rawDb.execute(rawSql`
        (
          SELECT dl.driver_id as id, 'driver' as type, dl.lat, dl.lng, dl.heading, u.full_name as label, 'online' as status
          FROM driver_locations dl
          JOIN users u ON u.id = dl.driver_id
          WHERE dl.is_online = true AND u.is_active = true
          LIMIT 200
        )
        UNION ALL
        (
          SELECT t.id::text, 'active_trip' as type, t.pickup_lat as lat, t.pickup_lng as lng, NULL as heading,
            COALESCE(c.full_name, 'Customer') as label, t.current_status as status
          FROM trip_requests t
          LEFT JOIN users c ON c.id = t.customer_id
          WHERE t.current_status IN ('searching', 'accepted', 'arrived', 'on_the_way')
          LIMIT 100
        )
      `),
      // Fraud flags today
      rawDb.execute(rawSql`
        SELECT COUNT(*) as cnt FROM fraud_flags WHERE created_at::date = CURRENT_DATE
      `),
    ]);

    const c = countsRes.rows[0] as any;
    const k = kpiRes.rows[0] as any;

    const demandZones = await computeDemandHeatmap();

    const liveMarkers: LiveMarker[] = markersRes.rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      lat: Number(r.lat),
      lng: Number(r.lng),
      heading: r.heading ? Number(r.heading) : undefined,
      label: r.label || "",
      status: r.status || "",
    }));

    return {
      activeRides: Number(c.active_rides) || 0,
      parcelDeliveries: Number(c.parcel_deliveries) || 0,
      driversOnline: Number(c.drivers_online) || 0,
      pendingRequests: Number(c.pending_requests) || 0,
      demandZones,
      liveMarkers,
      kpis: {
        totalTripsToday: Number(k.trips_today) || 0,
        totalRevenueToday: Number(k.revenue_today) || 0,
        avgTripDurationMin: Math.round(Number(k.avg_duration_min) || 0),
        cancellationRate: Math.round((Number(k.cancel_rate) || 0) * 100),
        avgSurgeMultiplier: demandZones.length
          ? Math.round((demandZones.reduce((s, z) => s + z.surgeMultiplier, 0) / demandZones.length) * 100) / 100
          : 1.0,
        fraudFlagsToday: Number((fraudRes.rows[0] as any)?.cnt) || 0,
      },
    };
  } catch (e: any) {
    console.error("[OPS-DASH] Error:", e.message);
    return {
      activeRides: 0,
      parcelDeliveries: 0,
      driversOnline: 0,
      pendingRequests: 0,
      demandZones: [],
      liveMarkers: [],
      kpis: { totalTripsToday: 0, totalRevenueToday: 0, avgTripDurationMin: 0, cancellationRate: 0, avgSurgeMultiplier: 1.0, fraudFlagsToday: 0 },
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  BACKGROUND JOBS
// ════════════════════════════════════════════════════════════════════════════

let rebalancingInterval: ReturnType<typeof setInterval> | null = null;
let fraudScanInterval: ReturnType<typeof setInterval> | null = null;
let behaviorRefreshInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start all intelligence background jobs.
 */
export function startIntelligenceJobs(): void {
  // Rebalancing notifications — every 5 minutes
  if (!rebalancingInterval) {
    rebalancingInterval = setInterval(() => {
      pushRebalancingNotifications().catch((e) => console.error("[REBALANCE] Job error:", e.message));
    }, 5 * 60 * 1000);
    console.log("[INTELLIGENCE] Rebalancing job started (5 min interval)");
  }

  // Fraud scan — every 30 minutes
  if (!fraudScanInterval) {
    fraudScanInterval = setInterval(() => {
      runFraudScan().catch((e) => console.error("[FRAUD] Job error:", e.message));
    }, 30 * 60 * 1000);
    console.log("[INTELLIGENCE] Fraud scan job started (30 min interval)");
  }

  // Driver behavior scores — every 15 minutes
  if (!behaviorRefreshInterval) {
    behaviorRefreshInterval = setInterval(() => {
      refreshAllBehaviorScores().catch((e) => console.error("[BEHAVIOR] Job error:", e.message));
    }, 15 * 60 * 1000);
    console.log("[INTELLIGENCE] Behavior scoring job started (15 min interval)");
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  DB TABLES INITIALIZATION
// ════════════════════════════════════════════════════════════════════════════

export async function initIntelligenceTables(): Promise<void> {
  try {
    await assertSchemaObjectsOrThrow({
      tables: ["surge_configs", "driver_behavior_scores", "fraud_flags"],
    });

    console.log("[INTELLIGENCE] Schema verified");
  } catch (e: any) {
    console.error("[INTELLIGENCE] Table init error:", e.message);
  }
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
