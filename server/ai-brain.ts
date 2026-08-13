/**
 * AI Mobility Brain — Central Decision Engine
 * 
 * Real-time platform analytics running every 10 seconds:
 * - Metrics collection (requests, drivers, wait times, cancellations)
 * - Demand analysis per zone (grid-based)
 * - Driver rebalancing suggestions
 * - Smart surge pricing
 * - Anomaly detection triggers
 * 
 * Wraps and extends intelligence.ts systems into a unified brain.
 */

import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { io } from "./socket";
import {
  computeDemandHeatmap,
  getOperationsDashboard,
  type HeatmapZone,
} from "./intelligence";

// ════════════════════════════════════════════════════════════════════════════
//  IN-MEMORY METRICS STORE (replaces Redis for single-server deployment)
// ════════════════════════════════════════════════════════════════════════════

interface PlatformMetrics {
  timestamp: string;
  rideRequestsLast5Min: number;
  parcelRequestsLast5Min: number;
  driversOnline: number;
  driversBusy: number;
  driversIdle: number;
  averageWaitTimeSec: number;
  cancellationRate: number;
  activeTrips: number;
  activeParcels: number;
  zoneDemand: ZoneDemand[];
  surgeZones: SurgeZone[];
  driverDistribution: DriverDistribution[];
  predictedDemand: PredictedDemand[];
}

interface ZoneDemand {
  zoneId: string;
  zoneName: string;
  lat: number;
  lng: number;
  demandLevel: 'low' | 'medium' | 'high';
  demandRatio: number;
  requestCount: number;
  driverCount: number;
  surgeMultiplier: number;
}

interface SurgeZone {
  zoneId: string;
  zoneName: string;
  lat: number;
  lng: number;
  multiplier: number;
  reason: string;
}

interface DriverDistribution {
  zoneId: string;
  zoneName: string;
  lat: number;
  lng: number;
  online: number;
  busy: number;
  idle: number;
}

interface PredictedDemand {
  zoneId: string;
  zoneName: string;
  currentDemand: number;
  predictedNext30Min: number;
  trend: 'rising' | 'stable' | 'falling';
}

// Current brain state
let currentMetrics: PlatformMetrics | null = null;
let metricsHistory: PlatformMetrics[] = []; // Last 30 snapshots (5 minutes)
let brainInterval: ReturnType<typeof setInterval> | null = null;
let brainRunning = false;

// ════════════════════════════════════════════════════════════════════════════
//  METRICS COLLECTION
// ════════════════════════════════════════════════════════════════════════════

async function collectMetrics(): Promise<PlatformMetrics> {
  const now = new Date().toISOString();

  // Parallel queries for performance
  const [rideReqs, parcelReqs, driverStats, waitTime, cancelRate, trips, parcels] = await Promise.all([
    // Ride requests last 5 minutes
    rawDb.execute(rawSql`
      SELECT COUNT(*)::int as cnt FROM trip_requests
      WHERE created_at > NOW() - INTERVAL '5 minutes'
    `).catch(() => ({ rows: [{ cnt: 0 }] })),

    // Parcel requests last 5 minutes
    rawDb.execute(rawSql`
      SELECT COUNT(*)::int as cnt FROM parcel_orders
      WHERE created_at > NOW() - INTERVAL '5 minutes'
    `).catch(() => ({ rows: [{ cnt: 0 }] })),

    // Driver status counts
    rawDb.execute(rawSql`
      SELECT
        COUNT(*) FILTER (WHERE dl.is_online = true)::int as online,
        COUNT(*) FILTER (WHERE dl.is_online = true AND u.current_trip_id IS NOT NULL)::int as busy,
        COUNT(*) FILTER (WHERE dl.is_online = true AND u.current_trip_id IS NULL)::int as idle
      FROM driver_locations dl
      JOIN users u ON u.id = dl.driver_id
      WHERE dl.is_online = true
    `).catch(() => ({ rows: [{ online: 0, busy: 0, idle: 0 }] })),

    // Average wait time (last 1 hour completed trips)
    rawDb.execute(rawSql`
      SELECT COALESCE(
        AVG(EXTRACT(EPOCH FROM (
          CASE WHEN accepted_at IS NOT NULL THEN accepted_at ELSE updated_at END - created_at
        )))::int, 0
      ) as avg_wait
      FROM trip_requests
      WHERE current_status IN ('completed', 'accepted', 'arrived', 'on_the_way')
        AND created_at > NOW() - INTERVAL '1 hour'
    `).catch(() => ({ rows: [{ avg_wait: 0 }] })),

    // Cancellation rate (last 1 hour)
    rawDb.execute(rawSql`
      SELECT
        COUNT(*) FILTER (WHERE current_status = 'cancelled')::int as cancelled,
        COUNT(*)::int as total
      FROM trip_requests
      WHERE created_at > NOW() - INTERVAL '1 hour'
    `).catch(() => ({ rows: [{ cancelled: 0, total: 1 }] })),

    // Active trips
    rawDb.execute(rawSql`
      SELECT COUNT(*)::int as cnt FROM trip_requests
      WHERE current_status IN ('searching', 'driver_assigned', 'accepted', 'arrived', 'on_the_way')
    `).catch(() => ({ rows: [{ cnt: 0 }] })),

    // Active parcels
    rawDb.execute(rawSql`
      SELECT COUNT(*)::int as cnt FROM parcel_orders
      WHERE current_status IN ('searching', 'driver_assigned', 'picked_up', 'in_transit')
    `).catch(() => ({ rows: [{ cnt: 0 }] })),
  ]);

  const dStats = driverStats.rows[0] as any;
  const cancelData = cancelRate.rows[0] as any;
  const cancelTotal = Number(cancelData.total) || 1;

  // Get zone demand from heatmap
  let heatmapZones: HeatmapZone[] = [];
  try {
    heatmapZones = await computeDemandHeatmap();
  } catch {}

  const zoneDemand: ZoneDemand[] = heatmapZones.map(z => ({
    zoneId: z.zoneId,
    zoneName: z.zoneName,
    lat: z.centerLat,
    lng: z.centerLng,
    demandLevel: z.demandIntensity,
    demandRatio: z.demandRatio,
    requestCount: z.requestsLast10Min,
    driverCount: z.driversOnline,
    surgeMultiplier: z.surgeMultiplier,
  }));

  const surgeZones: SurgeZone[] = heatmapZones
    .filter(z => z.surgeMultiplier > 1.1)
    .map(z => ({
      zoneId: z.zoneId,
      zoneName: z.zoneName,
      lat: z.centerLat,
      lng: z.centerLng,
      multiplier: z.surgeMultiplier,
      reason: z.demandRatio > 2 ? 'High demand' : z.demandRatio > 1.5 ? 'Medium demand' : 'Peak hours',
    }));

  const driverDistribution: DriverDistribution[] = heatmapZones.map(z => ({
    zoneId: z.zoneId,
    zoneName: z.zoneName,
    lat: z.centerLat,
    lng: z.centerLng,
    online: z.driversOnline,
    busy: z.activeTrips,
    idle: Math.max(0, z.driversOnline - z.activeTrips),
  }));

  // Simple trend prediction based on history
  const predictedDemand: PredictedDemand[] = heatmapZones.map(z => {
    const prevMetric = metricsHistory.length >= 6
      ? metricsHistory[metricsHistory.length - 6]?.zoneDemand?.find(zd => zd.zoneId === z.zoneId)
      : null;
    const prevCount = prevMetric?.requestCount ?? z.requestsLast10Min;
    const trend: 'rising' | 'stable' | 'falling' =
      z.requestsLast10Min > prevCount * 1.2 ? 'rising' :
      z.requestsLast10Min < prevCount * 0.8 ? 'falling' : 'stable';
    const predictedNext = trend === 'rising'
      ? Math.round(z.requestsLast10Min * 1.3)
      : trend === 'falling'
        ? Math.round(z.requestsLast10Min * 0.7)
        : z.requestsLast10Min;

    return {
      zoneId: z.zoneId,
      zoneName: z.zoneName,
      currentDemand: z.requestsLast10Min,
      predictedNext30Min: predictedNext,
      trend,
    };
  });

  return {
    timestamp: now,
    rideRequestsLast5Min: Number((rideReqs.rows[0] as any).cnt) || 0,
    parcelRequestsLast5Min: Number((parcelReqs.rows[0] as any).cnt) || 0,
    driversOnline: Number(dStats.online) || 0,
    driversBusy: Number(dStats.busy) || 0,
    driversIdle: Number(dStats.idle) || 0,
    averageWaitTimeSec: Number((waitTime.rows[0] as any).avg_wait) || 0,
    cancellationRate: Math.round((Number(cancelData.cancelled) / cancelTotal) * 100),
    activeTrips: Number((trips.rows[0] as any).cnt) || 0,
    activeParcels: Number((parcels.rows[0] as any).cnt) || 0,
    zoneDemand,
    surgeZones,
    driverDistribution,
    predictedDemand,
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  BRAIN TICK — runs every 10 seconds
// ════════════════════════════════════════════════════════════════════════════

async function brainTick(): Promise<void> {
  try {
    const metrics = await collectMetrics();
    currentMetrics = metrics;

    // Keep rolling 30-snapshot history (~5 minutes)
    metricsHistory.push(metrics);
    if (metricsHistory.length > 30) metricsHistory.shift();

    // Broadcast to admin dashboard via Socket.IO
    if (io) {
      io.to('admin:ai-dashboard').emit('brain:metrics', {
        metrics: {
          rideRequestsLast5Min: metrics.rideRequestsLast5Min,
          parcelRequestsLast5Min: metrics.parcelRequestsLast5Min,
          driversOnline: metrics.driversOnline,
          driversBusy: metrics.driversBusy,
          driversIdle: metrics.driversIdle,
          averageWaitTimeSec: metrics.averageWaitTimeSec,
          cancellationRate: metrics.cancellationRate,
          activeTrips: metrics.activeTrips,
          activeParcels: metrics.activeParcels,
        },
        zoneDemand: metrics.zoneDemand,
        surgeZones: metrics.surgeZones,
        driverDistribution: metrics.driverDistribution,
        predictedDemand: metrics.predictedDemand,
        timestamp: metrics.timestamp,
      });
    }
  } catch (err) {
    console.error("[AI-BRAIN] Tick error:", err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  START/STOP BRAIN
// ════════════════════════════════════════════════════════════════════════════

export function startAIMobilityBrain(): void {
  if (brainRunning) return;
  brainRunning = true;
  console.log("[AI-BRAIN] Starting AI Mobility Brain (10s interval)");

  // Run immediately
  brainTick().catch(() => {});

  // Then every 10 seconds
  brainInterval = setInterval(() => {
    brainTick().catch(() => {});
  }, 10_000);
}

export function stopAIMobilityBrain(): void {
  if (brainInterval) {
    clearInterval(brainInterval);
    brainInterval = null;
  }
  brainRunning = false;
  console.log("[AI-BRAIN] Stopped");
}

// ════════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ════════════════════════════════════════════════════════════════════════════

export function getCurrentMetrics(): PlatformMetrics | null {
  return currentMetrics;
}

export function getMetricsHistory(): PlatformMetrics[] {
  return metricsHistory;
}

export function getBrainStatus(): { running: boolean; lastTick: string | null; historySize: number } {
  return {
    running: brainRunning,
    lastTick: currentMetrics?.timestamp || null,
    historySize: metricsHistory.length,
  };
}

/**
 * Get comprehensive AI dashboard data for admin panel.
 */
export async function getAIDashboardData(): Promise<{
  metrics: PlatformMetrics | null;
  operationsDashboard: any;
  brainStatus: any;
}> {
  let opsDashboard = null;
  try {
    opsDashboard = await getOperationsDashboard();  
  } catch {}

  return {
    metrics: currentMetrics,
    operationsDashboard: opsDashboard,
    brainStatus: getBrainStatus(),
  };
}
