import type { Server as SocketIOServer } from "socket.io";
import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";

type SocketUserType = "driver" | "customer" | "admin" | "system";
type DriverSocketState = "connected" | "reconnecting" | "inactive_socket";

export interface RealtimeOpsConfig {
  trackingFreshnessTimeoutSec: number;
  frozenMovementTimeoutSec: number;
  socketHeartbeatTimeoutSec: number;
  reconnectStormThreshold: number;
  recoveryCooldownSec: number;
  replayLimit: number;
  heartbeatCadenceSec: number;
  gpsUpdateCadenceSec: number;
}

interface DriverSocketTelemetry {
  userId: string;
  socketId?: string;
  state: DriverSocketState;
  connectedAt: number;
  lastHeartbeatAt: number;
  lastLocationAt?: number;
  reconnectCount: number;
  lastDisconnectAt?: number;
  lastDisconnectReason?: string;
  currentTripId?: string;
  lastLat?: number;
  lastLng?: number;
  repeatedLocationCount: number;
  frozenSinceAt?: number;
  lastRecoveryAt?: number;
  lastRecoverySource?: string;
}

interface TripRuntimeTelemetry {
  tripId: string;
  lastLifecycleStatus?: string;
  lastLifecycleAt?: number;
  lastRecoveryAt?: number;
  lastRecoveryEvent?: string;
  recoveryCount: number;
  duplicateSuppressionCount: number;
  waitingStartedAt?: number;
}

type AlertSeverity = "warning" | "critical";

interface AdminOpsAlert {
  id: string;
  tripId: string;
  driverId: string | null;
  customerId: string | null;
  type: string;
  severity: AlertSeverity;
  message: string;
  lastKnownLocation: { lat: number; lng: number } | null;
  lastSuccessfulHeartbeat: string | null;
  recoveryAttempts: number;
  createdAt: string;
}

const CONFIG_KEY_MAP = {
  trackingFreshnessTimeoutSec: "ops_tracking_freshness_timeout_sec",
  frozenMovementTimeoutSec: "ops_frozen_movement_timeout_sec",
  socketHeartbeatTimeoutSec: "ops_socket_heartbeat_timeout_sec",
  reconnectStormThreshold: "ops_reconnect_storm_threshold",
  recoveryCooldownSec: "ops_recovery_cooldown_sec",
  replayLimit: "ops_socket_replay_limit",
  heartbeatCadenceSec: "ops_heartbeat_cadence_sec",
  gpsUpdateCadenceSec: "ops_gps_update_cadence_sec",
} as const satisfies Record<keyof RealtimeOpsConfig, string>;

const DEFAULT_CONFIG: RealtimeOpsConfig = {
  trackingFreshnessTimeoutSec: 25,
  frozenMovementTimeoutSec: 90,
  socketHeartbeatTimeoutSec: 40,
  reconnectStormThreshold: 4,
  recoveryCooldownSec: 45,
  replayLimit: 6,
  heartbeatCadenceSec: 15,
  gpsUpdateCadenceSec: 5,
};

const driverSocketTelemetry = new Map<string, DriverSocketTelemetry>();
const tripRuntimeTelemetry = new Map<string, TripRuntimeTelemetry>();
const recoveryDedupe = new Map<string, number>();
const activeAlertCache = new Set<string>();

let adminOpsIo: SocketIOServer | null = null;
let emitTimer: NodeJS.Timeout | null = null;

function nowIso() {
  return new Date().toISOString();
}

function numberOrFallback(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toMs(seconds: number) {
  return Math.max(1, seconds) * 1000;
}

function statusToLifecycleEvent(status: string) {
  switch (status) {
    case "searching":
      return "ride_searching";
    case "driver_assigned":
      return "driver_assigned";
    case "accepted":
      return "trip_accepted";
    case "arrived":
      return "driver_arrived";
    case "on_the_way":
    case "ongoing":
      return "trip_started";
    case "completed":
      return "trip_completed";
    case "payment_pending":
      return "trip_payment_pending";
    case "cancelled":
      return "trip_cancelled";
    default:
      return `trip_status_${status}`;
  }
}

function runtimeForTrip(tripId: string) {
  const existing = tripRuntimeTelemetry.get(tripId);
  if (existing) return existing;
  const created: TripRuntimeTelemetry = {
    tripId,
    recoveryCount: 0,
    duplicateSuppressionCount: 0,
  };
  tripRuntimeTelemetry.set(tripId, created);
  return created;
}

function driverTelemetryFor(userId: string) {
  const existing = driverSocketTelemetry.get(userId);
  if (existing) return existing;
  const created: DriverSocketTelemetry = {
    userId,
    state: "connected",
    connectedAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    reconnectCount: 0,
    repeatedLocationCount: 0,
  };
  driverSocketTelemetry.set(userId, created);
  return created;
}

function queueSnapshot(reason = "update") {
  if (!adminOpsIo) return;
  if (emitTimer) clearTimeout(emitTimer);
  emitTimer = setTimeout(() => {
    emitTimer = null;
    emitRealtimeOpsSnapshot(reason).catch(() => {});
  }, 250);
}

function parseJsonSafe(value: unknown) {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function isRecoveryEvent(eventType: string) {
  return /(recover|rehydrat|rejoin|replay|reconnect|restore|reconcile|reopen)/i.test(eventType);
}

function ageSeconds(timestamp: string | Date | null | undefined) {
  if (!timestamp) return null;
  const value = new Date(timestamp).getTime();
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.round((Date.now() - value) / 1000));
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return "n/a";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remaining}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function buildAlertKey(alert: Omit<AdminOpsAlert, "id" | "createdAt">) {
  return [
    alert.tripId,
    alert.type,
    alert.lastSuccessfulHeartbeat || "no-heartbeat",
    alert.recoveryAttempts,
  ].join(":");
}

export function registerRealtimeOpsIO(io: SocketIOServer) {
  adminOpsIo = io;
}

export async function appendTripStatus(tripId: string, status: string, source = "system", note?: string) {
  if (!tripId) return;
  await rawDb.execute(rawSql`
    INSERT INTO trip_status (trip_id, status, source, note)
    VALUES (${tripId}::uuid, ${status}, ${source}, ${note || null})
  `);
}

export async function logRideLifecycleEvent(
  tripId: string,
  eventType: string,
  actorId?: string,
  actorType = "system",
  meta: Record<string, unknown> = {},
) {
  if (!tripId) return;
  await rawDb.execute(rawSql`
    INSERT INTO ride_events (trip_id, event_type, actor_id, actor_type, meta)
    VALUES (${tripId}::uuid, ${eventType}, ${actorId || null}::uuid, ${actorType}, ${JSON.stringify(meta)}::jsonb)
  `);
}

export async function loadRealtimeOpsConfig(): Promise<RealtimeOpsConfig> {
  const config = { ...DEFAULT_CONFIG };
  const keys = Object.values(CONFIG_KEY_MAP);
  const rows = await rawDb.execute(rawSql`
    SELECT key_name, value
    FROM business_settings
    WHERE key_name = ANY(${keys}::text[])
  `).catch(() => ({ rows: [] as any[] }));

  for (const row of rows.rows as any[]) {
    for (const [prop, keyName] of Object.entries(CONFIG_KEY_MAP) as [keyof RealtimeOpsConfig, string][]) {
      if (row.key_name === keyName) {
        config[prop] = numberOrFallback(row.value, config[prop]);
      }
    }
  }

  return config;
}

export async function saveRealtimeOpsConfig(
  patch: Partial<RealtimeOpsConfig>,
  adminEmail?: string | null,
) {
  const sanitizedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<RealtimeOpsConfig>;
  const next = { ...(await loadRealtimeOpsConfig()), ...sanitizedPatch };
  for (const [prop, keyName] of Object.entries(CONFIG_KEY_MAP) as [keyof RealtimeOpsConfig, string][]) {
    await rawDb.execute(rawSql`
      INSERT INTO business_settings (key_name, value, settings_type)
      VALUES (${keyName}, ${String(next[prop])}, 'operations_runtime')
      ON CONFLICT (key_name)
      DO UPDATE SET value=${String(next[prop])}, updated_at=NOW()
    `);
  }

  if (adminEmail) {
    await rawDb.execute(rawSql`
      INSERT INTO admin_logs (admin_email, action, entity_type, details)
      VALUES (${adminEmail}, 'update_realtime_ops_config', 'operations_runtime', ${JSON.stringify(next)}::jsonb)
    `).catch(() => {});
  }

  queueSnapshot("config_updated");
  return next;
}

export async function noteTripLifecycle(params: {
  tripId: string;
  status: string;
  actorId?: string;
  actorType?: string;
  note?: string;
  meta?: Record<string, unknown>;
}) {
  const { tripId, status, actorId, actorType = "system", note, meta = {} } = params;
  if (!tripId || !status) return;
  const runtime = runtimeForTrip(tripId);
  runtime.lastLifecycleStatus = status;
  runtime.lastLifecycleAt = Date.now();
  if (status === "arrived" && !runtime.waitingStartedAt) {
    runtime.waitingStartedAt = Date.now();
  }
  if (status !== "arrived") {
    runtime.waitingStartedAt = undefined;
  }
  await appendTripStatus(tripId, status, actorType, note);
  await logRideLifecycleEvent(tripId, statusToLifecycleEvent(status), actorId, actorType, meta);
  queueSnapshot(`lifecycle:${status}`);
}

export async function noteRecoveryAudit(params: {
  tripId: string;
  eventType: string;
  actorId?: string;
  actorType?: string;
  meta?: Record<string, unknown>;
  dedupeKey?: string;
  dedupeWindowMs?: number;
}) {
  const {
    tripId,
    eventType,
    actorId,
    actorType = "system",
    meta = {},
    dedupeKey,
    dedupeWindowMs = 45_000,
  } = params;
  if (!tripId || !eventType) return;

  const key = dedupeKey || `${tripId}:${eventType}:${actorId || "system"}`;
  const last = recoveryDedupe.get(key) || 0;
  const now = Date.now();
  if (now - last < dedupeWindowMs) {
    const runtime = runtimeForTrip(tripId);
    runtime.duplicateSuppressionCount += 1;
    queueSnapshot("duplicate_suppressed");
    return;
  }

  recoveryDedupe.set(key, now);
  const runtime = runtimeForTrip(tripId);
  runtime.lastRecoveryAt = now;
  runtime.lastRecoveryEvent = eventType;
  runtime.recoveryCount += 1;
  await logRideLifecycleEvent(tripId, eventType, actorId, actorType, {
    ...meta,
    recovery: true,
    recordedAt: nowIso(),
  });
  queueSnapshot(`recovery:${eventType}`);
}

export function noteSocketConnected(params: {
  userId: string;
  userType: SocketUserType;
  socketId: string;
  tripId?: string | null;
  reconnectSource?: string;
}) {
  const { userId, userType, socketId, tripId, reconnectSource } = params;
  if (userType !== "driver") return;
  const telemetry = driverTelemetryFor(userId);
  const wasRecovering = telemetry.state !== "connected";
  telemetry.socketId = socketId;
  telemetry.connectedAt = Date.now();
  telemetry.lastHeartbeatAt = Date.now();
  telemetry.state = "connected";
  if (tripId) telemetry.currentTripId = tripId;
  if (wasRecovering) {
    telemetry.reconnectCount += 1;
    telemetry.lastRecoveryAt = Date.now();
    telemetry.lastRecoverySource = reconnectSource || "socket_connect";
  }
  queueSnapshot("socket_connected");
}

export function noteSocketActivity(params: {
  userId: string;
  userType: SocketUserType;
  tripId?: string | null;
}) {
  const { userId, userType, tripId } = params;
  if (userType !== "driver") return;
  const telemetry = driverTelemetryFor(userId);
  telemetry.lastHeartbeatAt = Date.now();
  telemetry.state = "connected";
  if (tripId) telemetry.currentTripId = tripId;
  queueSnapshot("socket_activity");
}

export function noteSocketDisconnected(params: {
  userId: string;
  userType: SocketUserType;
  tripId?: string | null;
  reason?: string;
}) {
  const { userId, userType, tripId, reason } = params;
  if (userType !== "driver") return;
  const telemetry = driverTelemetryFor(userId);
  telemetry.state = "reconnecting";
  telemetry.lastDisconnectAt = Date.now();
  telemetry.lastDisconnectReason = reason;
  if (tripId) telemetry.currentTripId = tripId;
  queueSnapshot("socket_disconnected");
}

export function noteSocketBecameInactive(userId: string) {
  const telemetry = driverTelemetryFor(userId);
  telemetry.state = "inactive_socket";
  queueSnapshot("socket_inactive");
}

export function noteDriverLocation(params: {
  driverId: string;
  tripId?: string | null;
  lat: number;
  lng: number;
}) {
  const { driverId, tripId, lat, lng } = params;
  const telemetry = driverTelemetryFor(driverId);
  telemetry.lastHeartbeatAt = Date.now();
  telemetry.lastLocationAt = Date.now();
  telemetry.state = "connected";
  if (tripId) telemetry.currentTripId = tripId;
  if (telemetry.lastLat != null && telemetry.lastLng != null) {
    const moved = Math.abs(telemetry.lastLat - lat) > 0.00001 || Math.abs(telemetry.lastLng - lng) > 0.00001;
    if (moved) {
      telemetry.repeatedLocationCount = 0;
      telemetry.frozenSinceAt = undefined;
    } else {
      telemetry.repeatedLocationCount += 1;
      telemetry.frozenSinceAt = telemetry.frozenSinceAt || Date.now();
    }
  }
  telemetry.lastLat = lat;
  telemetry.lastLng = lng;
  queueSnapshot("location");
}

function deriveOperationalState(args: {
  ride: any;
  socketTelemetry?: DriverSocketTelemetry;
  runtime: TripRuntimeTelemetry;
  config: RealtimeOpsConfig;
}) {
  const { ride, socketTelemetry, runtime, config } = args;
  const locationAgeSec = ageSeconds(ride.driver_location_updated_at);
  const socketAgeSec = socketTelemetry ? Math.round((Date.now() - socketTelemetry.lastHeartbeatAt) / 1000) : null;
  const frozenAgeSec = socketTelemetry?.frozenSinceAt ? Math.round((Date.now() - socketTelemetry.frozenSinceAt) / 1000) : null;
  const reconnectCount = socketTelemetry?.reconnectCount || 0;

  if (socketTelemetry?.state === "reconnecting") return "reconnecting";
  if (socketTelemetry?.state === "inactive_socket" || (socketAgeSec != null && socketAgeSec > config.socketHeartbeatTimeoutSec)) {
    return "inactive_socket";
  }
  if (runtime.lastRecoveryAt && Date.now() - runtime.lastRecoveryAt <= toMs(config.recoveryCooldownSec)) {
    return "recovered";
  }
  if (locationAgeSec != null && locationAgeSec > config.trackingFreshnessTimeoutSec) {
    return "stale_tracking";
  }
  if (frozenAgeSec != null && frozenAgeSec > config.frozenMovementTimeoutSec) {
    return "frozen_tracking";
  }
  if ((ride.driver_lat == null || ride.driver_lng == null) && ride.driver_id) {
    return "weak_signal";
  }
  if (reconnectCount >= config.reconnectStormThreshold) {
    return "reconnect_storm";
  }
  return "healthy";
}

function buildAlertsForRide(args: {
  ride: any;
  operationalState: string;
  socketTelemetry?: DriverSocketTelemetry;
  runtime: TripRuntimeTelemetry;
  config: RealtimeOpsConfig;
}) {
  const { ride, operationalState, socketTelemetry, runtime, config } = args;
  const alerts: AdminOpsAlert[] = [];
  const lastKnownLocation = ride.driver_lat != null && ride.driver_lng != null
    ? { lat: Number(ride.driver_lat), lng: Number(ride.driver_lng) }
    : null;
  const lastSuccessfulHeartbeat = socketTelemetry ? new Date(socketTelemetry.lastHeartbeatAt).toISOString() : null;

  const pushAlert = (type: string, severity: AlertSeverity, message: string) => {
    const key = buildAlertKey({
      tripId: ride.id,
      driverId: ride.driver_id || null,
      customerId: ride.customer_id || null,
      type,
      severity,
      message,
      lastKnownLocation,
      lastSuccessfulHeartbeat,
      recoveryAttempts: runtime.recoveryCount,
    });
    alerts.push({
      id: key,
      tripId: ride.id,
      driverId: ride.driver_id || null,
      customerId: ride.customer_id || null,
      type,
      severity,
      message,
      lastKnownLocation,
      lastSuccessfulHeartbeat,
      recoveryAttempts: runtime.recoveryCount,
      createdAt: nowIso(),
    });
  };

  const locationAgeSec = ageSeconds(ride.driver_location_updated_at);
  if (operationalState === "stale_tracking" && locationAgeSec != null) {
    pushAlert("stale_tracking", "critical", `Tracking stale for ${formatDuration(locationAgeSec)}.`);
  }
  if (operationalState === "inactive_socket") {
    pushAlert("inactive_socket", "critical", "Driver socket heartbeat is missing.");
  }
  if (operationalState === "frozen_tracking") {
    pushAlert("frozen_tracking", "critical", "Driver movement appears frozen during an active ride.");
  }
  if (operationalState === "reconnecting") {
    pushAlert("reconnecting", "warning", "Driver socket is reconnecting.");
  }
  if ((socketTelemetry?.reconnectCount || 0) >= config.reconnectStormThreshold) {
    pushAlert("reconnect_storm", "critical", "Repeated reconnect loop detected.");
  }
  if ((runtime.recoveryCount || 0) > config.replayLimit) {
    pushAlert("recovery_replay_limit", "critical", "Trip recovery count exceeded replay limit.");
  }

  return alerts;
}

export async function buildRealtimeOpsSnapshot() {
  const config = await loadRealtimeOpsConfig();
  const ridesR = await rawDb.execute(rawSql`
    SELECT
      t.id,
      t.ref_id,
      t.trip_type,
      t.current_status,
      t.created_at,
      t.updated_at,
      t.driver_accepted_at,
      t.driver_arriving_at,
      t.ride_started_at,
      t.customer_id,
      t.driver_id,
      t.pickup_address,
      t.destination_address,
      t.pickup_lat,
      t.pickup_lng,
      t.destination_lat,
      t.destination_lng,
      t.pickup_otp,
      t.delivery_otp,
      vc.name AS vehicle_name,
      vc.waiting_charge_per_min,
      c.full_name AS customer_name,
      c.phone AS customer_phone,
      d.full_name AS driver_name,
      d.phone AS driver_phone,
      d.is_online AS driver_user_online,
      dl.lat AS driver_lat,
      dl.lng AS driver_lng,
      dl.heading AS driver_heading,
      dl.speed AS driver_speed,
      dl.updated_at AS driver_location_updated_at
    FROM trip_requests t
    LEFT JOIN users c ON c.id = t.customer_id
    LEFT JOIN users d ON d.id = t.driver_id
    LEFT JOIN driver_locations dl ON dl.driver_id = t.driver_id
    LEFT JOIN vehicle_categories vc ON vc.id = t.vehicle_category_id
    WHERE t.current_status IN ('searching', 'driver_assigned', 'accepted', 'arrived', 'on_the_way', 'ongoing', 'payment_pending')
    ORDER BY t.updated_at DESC
  `);

  const eventsR = await rawDb.execute(rawSql`
    SELECT re.trip_id, re.event_type, re.actor_type, re.meta, re.created_at
    FROM ride_events re
    JOIN trip_requests t ON t.id = re.trip_id
    WHERE t.current_status IN ('searching', 'driver_assigned', 'accepted', 'arrived', 'on_the_way', 'ongoing', 'payment_pending')
      AND re.created_at > NOW() - INTERVAL '24 hours'
    ORDER BY re.created_at DESC
    LIMIT 600
  `).catch(() => ({ rows: [] as any[] }));

  const recentEventsByTrip = new Map<string, any[]>();
  for (const row of eventsR.rows as any[]) {
    const tripId = String(row.trip_id);
    const list = recentEventsByTrip.get(tripId) || [];
    if (list.length < 10) {
      list.push({
        eventType: row.event_type,
        actorType: row.actor_type,
        meta: parseJsonSafe(row.meta),
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      });
    }
    recentEventsByTrip.set(tripId, list);
  }

  const rides = (ridesR.rows as any[]).map((ride) => {
    const socketTelemetry = ride.driver_id ? driverSocketTelemetry.get(String(ride.driver_id)) : undefined;
    const runtime = runtimeForTrip(String(ride.id));
    const operationalState = deriveOperationalState({ ride, socketTelemetry, runtime, config });
    const locationAgeSec = ageSeconds(ride.driver_location_updated_at);
    const socketHeartbeatAgeSec = socketTelemetry ? Math.round((Date.now() - socketTelemetry.lastHeartbeatAt) / 1000) : null;
    const frozenAgeSec = socketTelemetry?.frozenSinceAt ? Math.round((Date.now() - socketTelemetry.frozenSinceAt) / 1000) : null;
    const waitingDurationSec = ride.current_status === "arrived" && ride.driver_arriving_at
      ? ageSeconds(ride.driver_arriving_at)
      : null;
    const waitingCharge = waitingDurationSec != null
      ? Number((numberOrFallback(ride.waiting_charge_per_min, 0) * (waitingDurationSec / 60)).toFixed(2))
      : 0;
    const alerts = buildAlertsForRide({ ride, operationalState, socketTelemetry, runtime, config });
    const rideEvents = recentEventsByTrip.get(String(ride.id)) || [];
    const recoveryEvents = rideEvents.filter((event) => isRecoveryEvent(String(event.eventType)));

    return {
      tripId: ride.id,
      refId: ride.ref_id,
      tripType: ride.trip_type,
      authoritativeStatus: ride.current_status,
      phase: ride.current_status === "accepted" || ride.current_status === "driver_assigned"
        ? "heading_to_pickup"
        : ride.current_status === "on_the_way" || ride.current_status === "ongoing"
          ? "in_progress"
          : ride.current_status,
      operationalState,
      customer: {
        id: ride.customer_id,
        name: ride.customer_name,
        phone: ride.customer_phone,
      },
      driver: {
        id: ride.driver_id,
        name: ride.driver_name,
        phone: ride.driver_phone,
        isOnline: ride.driver_user_online,
      },
      vehicleName: ride.vehicle_name,
      pickupAddress: ride.pickup_address,
      destinationAddress: ride.destination_address,
      pickupLat: ride.pickup_lat != null ? Number(ride.pickup_lat) : null,
      pickupLng: ride.pickup_lng != null ? Number(ride.pickup_lng) : null,
      destinationLat: ride.destination_lat != null ? Number(ride.destination_lat) : null,
      destinationLng: ride.destination_lng != null ? Number(ride.destination_lng) : null,
      driverLat: ride.driver_lat != null ? Number(ride.driver_lat) : null,
      driverLng: ride.driver_lng != null ? Number(ride.driver_lng) : null,
      driverHeading: ride.driver_heading != null ? Number(ride.driver_heading) : null,
      driverSpeed: ride.driver_speed != null ? Number(ride.driver_speed) : null,
      lastLocationTimestamp: ride.driver_location_updated_at instanceof Date
        ? ride.driver_location_updated_at.toISOString()
        : ride.driver_location_updated_at || null,
      lastSocketHeartbeat: socketTelemetry ? new Date(socketTelemetry.lastHeartbeatAt).toISOString() : null,
      trackingFreshnessSec: locationAgeSec,
      socketHeartbeatAgeSec,
      reconnectCount: socketTelemetry?.reconnectCount || 0,
      frozenDurationSec: frozenAgeSec,
      recoveryCount: runtime.recoveryCount,
      duplicateSuppressionCount: runtime.duplicateSuppressionCount,
      waitingDurationSec,
      waitingCharge,
      trackingQualityState: operationalState,
      createdAt: ride.created_at instanceof Date ? ride.created_at.toISOString() : ride.created_at,
      updatedAt: ride.updated_at instanceof Date ? ride.updated_at.toISOString() : ride.updated_at,
      lastRecoveryAt: runtime.lastRecoveryAt ? new Date(runtime.lastRecoveryAt).toISOString() : null,
      lastRecoveryEvent: runtime.lastRecoveryEvent || recoveryEvents[0]?.eventType || null,
      recoveryEvents,
      alerts,
    };
  });

  const alerts = rides.flatMap((ride) => ride.alerts);
  return {
    generatedAt: nowIso(),
    config,
    summary: {
      activeRideCount: rides.filter((ride) => ride.authoritativeStatus !== "searching").length,
      searchingRideCount: rides.filter((ride) => ride.authoritativeStatus === "searching").length,
      reconnectingRideCount: rides.filter((ride) => ride.operationalState === "reconnecting").length,
      recoveredRideCount: rides.filter((ride) => ride.operationalState === "recovered").length,
      staleRideCount: rides.filter((ride) => ride.operationalState === "stale_tracking").length,
      frozenRideCount: rides.filter((ride) => ride.operationalState === "frozen_tracking").length,
      unhealthyRideCount: rides.filter((ride) => ride.operationalState !== "healthy").length,
      alertCount: alerts.length,
    },
    rides,
    alerts,
  };
}

export async function emitRealtimeOpsSnapshot(reason = "update") {
  if (!adminOpsIo) return;
  const snapshot = await buildRealtimeOpsSnapshot();

  for (const alert of snapshot.alerts as AdminOpsAlert[]) {
    if (!activeAlertCache.has(alert.id)) {
      activeAlertCache.add(alert.id);
      adminOpsIo.to("admin:ops").emit("admin:ops_alert", alert);
    }
  }

  const stillActive = new Set((snapshot.alerts as AdminOpsAlert[]).map((alert) => alert.id));
  for (const known of Array.from(activeAlertCache)) {
    if (!stillActive.has(known)) activeAlertCache.delete(known);
  }

  adminOpsIo.to("admin:ops").emit("admin:ops_snapshot", {
    reason,
    ...snapshot,
  });
}
