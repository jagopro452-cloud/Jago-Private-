import { randomInt } from "node:crypto";
import { Server as SocketIOServer, Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { notifyDriverNewRide, notifyCustomerDriverAccepted, notifyCustomerTripCompleted, notifyTripCancelled, sendFcmNotification } from "./fcm";
import {
  onDriverAccepted as dispatchOnDriverAccepted,
  cancelDispatch as dispatchCancelTrip,
  getCurrentOfferedTripForDriver,
  hasActiveDispatch,
  isDriverCurrentlyOfferedTrip,
} from "./dispatch";
import { getRebalancingSuggestion } from "./intelligence";
import { emitParcelLifecycle, notifyAllReceivers, notifyReceiver } from "./parcel-advanced";
import {
  recordWaypoint,
  getTripWaypoints,
  clearTripWaypoints,
  checkRouteDeviation,
  checkAbnormalStop,
  checkSpeedAnomaly,
} from "./ai";
import { parseEnv } from "./config/env";
import { authenticateAppAccessToken } from "./auth/app-session";
import { authenticateAdminAccessToken } from "./auth/admin-session";
import {
  findEligibleDriversForDispatch,
  isDriverEligibleForDispatch,
  resolveDispatchRequirementsFromTrip,
} from "./dispatch-eligibility";
import { assertDriverCanAcceptRideTrip } from "./revenue-policy";
import {
  appendTripStatus,
  emitRealtimeOpsSnapshot,
  logRideLifecycleEvent,
  noteDriverLocation,
  noteRecoveryAudit,
  noteSocketActivity,
  noteSocketBecameInactive,
  noteSocketConnected,
  noteSocketDisconnected,
  registerRealtimeOpsIO,
} from "./realtime-ops";
import { addSocketPresence, hasSocketPresence, removeSocketPresence, touchSocketPresence } from "./socket-presence";

export let io: SocketIOServer;

// Mirrors server/routes.ts's safeErrMsg — never leak raw error text (which can include
// full SQL query text, table/column names, and bound parameter values) to a connected client.
function safeSocketErrMsg(e: any, fallback = "Something went wrong. Please try again."): string {
  if (process.env.NODE_ENV === "production") return fallback;
  return e?.message || fallback;
}

// Track connected sockets: userId → socketId
export async function hasActiveDriverSocket(driverId: string): Promise<boolean> {
  return hasSocketPresence("driver", driverId);
}

async function disconnectDuplicateUserSockets(userId: string, currentSocketId: string) {
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  await Promise.all(
    sockets
      .filter((candidate) => candidate.id !== currentSocketId)
      .map((candidate) => candidate.disconnect(true)),
  );
}

// Grace-period timers: when a driver socket disconnects we wait before marking them offline.
// If they reconnect within the grace window the timer is cancelled and they stay online.
// This prevents momentary network blips from removing drivers from active dispatch searches.
const pendingOfflineTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DRIVER_OFFLINE_GRACE_MS = 90_000; // 90 seconds
const SOCKET_PRESENCE_HEARTBEAT_MS = 45_000;

type ActiveCallSession = {
  sessionId: string;
  tripId: string;
  callerId: string;
  targetId: string;
  startedAt: number;
  connectedAt?: number;
  mode: "ride" | "support";
  scope?: "trip" | "pool";
  module?: "local_pool" | "outstation_pool";
};

const activeCallSessions = new Map<string, ActiveCallSession>();
const RIDE_SAFETY_CALL_STATUSES = new Set(["accepted", "arrived", "on_the_way", "in_progress"]);
const SUPPORT_CALL_TARGET = "__admin_support__";

function isRideSafetyCallStatus(status: unknown): boolean {
  return RIDE_SAFETY_CALL_STATUSES.has(String(status || "").toLowerCase());
}

function isCallSessionParticipant(session: ActiveCallSession, userA: string, userB: string): boolean {
  const pair = new Set([session.callerId, session.targetId]);
  return pair.has(userA) && pair.has(userB);
}

async function getRideSafetyCallTrip(tripId: string, userA: string, userB: string) {
  const tripR = await rawDb.execute(rawSql`
    SELECT id, current_status, customer_id::text AS customer_id, driver_id::text AS driver_id
    FROM trip_requests
    WHERE id=${tripId}::uuid
    LIMIT 1
  `);
  const tripRow = tripR.rows[0] as any;
  if (!tripRow) {
    return { ok: false, message: "Trip not found." };
  }
  if (!isRideSafetyCallStatus(tripRow.current_status)) {
    return { ok: false, message: "Calling is only available during an active ride." };
  }
  const customerId = String(tripRow.customer_id || "");
  const driverId = String(tripRow.driver_id || "");
  const expectedPair = new Set([customerId, driverId]);
  if (!expectedPair.has(userA) || !expectedPair.has(userB)) {
    return { ok: false, message: "Calling is only allowed between the active customer and driver." };
  }
  return { ok: true, tripRow };
}

function normalizePoolModule(value: unknown): "local_pool" | "outstation_pool" | null {
  const module = String(value || "").toLowerCase();
  if (module === "local_pool" || module === "outstation_pool") return module;
  return null;
}

async function getPoolCommunicationContext(moduleInput: unknown, referenceId: string, userA: string, userB: string) {
  const module = normalizePoolModule(moduleInput);
  if (!module || !referenceId) {
    return { ok: false as const, message: "Pool communication reference is missing." };
  }

  if (module === "local_pool") {
    const r = await rawDb.execute(rawSql`
      SELECT
        prr.id,
        prr.status,
        prr.customer_id::text AS customer_id,
        dps.driver_id::text AS driver_id
      FROM pool_ride_requests prr
      JOIN driver_pool_sessions dps ON dps.id = COALESCE(prr.session_id, prr.proposed_session_id)
      WHERE prr.id = ${referenceId}::uuid
      LIMIT 1
    `).catch(() => ({ rows: [] as any[] }));
    const row = r.rows[0] as any;
    if (!row) return { ok: false as const, message: "Local pool booking not found." };
    const participants = new Set([String(row.customer_id || ""), String(row.driver_id || "")]);
    if (!participants.has(userA) || !participants.has(userB)) {
      return { ok: false as const, message: "Pool communication is only allowed between the matched passenger and driver." };
    }
    return {
      ok: true as const,
      module,
      status: String(row.status || ""),
      customerId: String(row.customer_id || ""),
      driverId: String(row.driver_id || ""),
    };
  }

  const r = await rawDb.execute(rawSql`
    SELECT
      opb.id,
      opb.status,
      opb.customer_id::text AS customer_id,
      opr.driver_id::text AS driver_id
    FROM outstation_pool_bookings opb
    JOIN outstation_pool_rides opr ON opr.id = opb.ride_id
    WHERE opb.id = ${referenceId}::uuid
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const row = r.rows[0] as any;
  if (!row) return { ok: false as const, message: "Outstation pool booking not found." };
  const participants = new Set([String(row.customer_id || ""), String(row.driver_id || "")]);
  if (!participants.has(userA) || !participants.has(userB)) {
    return { ok: false as const, message: "Pool communication is only allowed between the booked passenger and driver." };
  }
  return {
    ok: true as const,
    module,
    status: String(row.status || ""),
    customerId: String(row.customer_id || ""),
    driverId: String(row.driver_id || ""),
  };
}

function isPoolChatAllowed(status: string): boolean {
  return new Set(["matched", "picked_up", "dropped", "confirmed", "completed"]).has(String(status || "").toLowerCase());
}

function isPoolCallAllowed(status: string): boolean {
  return new Set(["matched", "picked_up", "confirmed"]).has(String(status || "").toLowerCase());
}

function findCallSessionForUser(userId: string): ActiveCallSession[] {
  return Array.from(activeCallSessions.values()).filter(
    (session) => session.callerId === userId || session.targetId === userId,
  );
}

function isSupportCallTarget(targetUserId: unknown): boolean {
  return String(targetUserId || "") === SUPPORT_CALL_TARGET;
}

function camelize(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
      v,
    ])
  );
}

async function persistSafetyAlert(alert: any, driverId: string) {
  try {
    await rawDb.execute(rawSql`
      INSERT INTO ai_safety_alerts (trip_id, driver_id, alert_type, severity, message, lat, lng)
      VALUES (
        ${alert.tripId}::uuid,
        ${driverId}::uuid,
        ${alert.type},
        ${alert.severity},
        ${alert.message},
        ${alert.lat || 0},
        ${alert.lng || 0}
      )
    `);
  } catch (e: any) {
    console.error("[AI-SAFETY] Failed to persist alert:", e.message);
  }
}

// Verify socket handshake token — prevents room spoofing (connecting as another user).
// Returns verified user identity + role from DB, or null if invalid.
async function verifySocketToken(
  token: string | undefined,
  claimedUserId: string | undefined,
  claimedUserType?: string,
): Promise<{ userId: string; userType: string } | null> {
  if (!token || !claimedUserId) return null;
  try {
    if (String(claimedUserType || "").toLowerCase() === "admin") {
      const session = await authenticateAdminAccessToken(token);
      if (!session || session.adminId !== claimedUserId) return null;
      return { userId: claimedUserId, userType: "admin" };
    }
    const session = await authenticateAppAccessToken(token);
    if (!session) return null;
    if (session.userId !== claimedUserId) return null;
    return { userId: session.userId, userType: session.userType };
  } catch {
    return null;
  }
}

export function setupSocket(httpServer: HttpServer) {
  const env = parseEnv();
  const socketAllowedOrigins = (env.SOCKET_ALLOWED_ORIGINS || (env.NODE_ENV === "production" ? "" : "*"))
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  if (env.NODE_ENV === "production" && !socketAllowedOrigins.length) {
    throw new Error("SOCKET_ALLOWED_ORIGINS is required in production");
  }

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: socketAllowedOrigins.length === 1 ? socketAllowedOrigins[0] : socketAllowedOrigins,
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
  });
  registerRealtimeOpsIO(io);

  io.on("connection", async (socket: Socket) => {
    const claimedUserId = socket.handshake.query.userId as string;
    const token = (socket.handshake.query.token || socket.handshake.auth?.token) as string | undefined;
    const claimedUserType = String(socket.handshake.query.userType || "").toLowerCase();

    if (!claimedUserId) {
      socket.disconnect();
      return;
    }

    // Verify the token matches the claimed userId (prevents room spoofing)
    const verified = await verifySocketToken(token, claimedUserId, claimedUserType);
    if (!verified) {
      console.warn(`[SOCKET] Auth failed for userId=${claimedUserId} — disconnecting`);
      socket.emit("auth:error", { message: "Invalid or expired token. Please reconnect with a valid token." });
      socket.disconnect();
      return;
    }
    const userId = verified.userId;
    const userType = verified.userType;
    if (claimedUserType && claimedUserType !== userType) {
      console.warn(`[SOCKET] Role mismatch for ${userId}: claimed=${claimedUserType}, actual=${userType}`);
    }

    // Join personal room
    socket.join(`user:${userId}`);

    if (userType === "admin") {
      socket.join("admin:ops");
      emitRealtimeOpsSnapshot("admin_connected").catch(() => {});
      console.log(`[SOCKET] Admin ${userId} connected to admin:ops`);
    } else if (userType === "driver") {
      const handleDriverOnline = async (data: { isOnline: boolean; lat?: number; lng?: number }) => {
        try {
          const { isOnline, lat, lng } = data;
          noteSocketActivity({ userId, userType: "driver" });
          const hasValidCoords = lat != null && lng != null && isFinite(lat) && isFinite(lng) && (lat !== 0 || lng !== 0);

          if (hasValidCoords) {
            await rawDb.execute(rawSql`
              INSERT INTO driver_locations (driver_id, lat, lng, is_online, updated_at)
              VALUES (${userId}::uuid, ${lat}, ${lng}, ${isOnline}, NOW())
              ON CONFLICT (driver_id) DO UPDATE
                SET lat=${lat}, lng=${lng}, is_online=${isOnline}, updated_at=NOW()
            `);
          } else {
            await rawDb.execute(rawSql`
              INSERT INTO driver_locations (driver_id, lat, lng, is_online, updated_at)
              VALUES (${userId}::uuid, 0, 0, ${isOnline}, NOW())
              ON CONFLICT (driver_id) DO UPDATE
                SET is_online=${isOnline}, updated_at=NOW()
            `);
          }
          await rawDb.execute(rawSql`
            UPDATE users
            SET is_online=${isOnline},
                current_lat=COALESCE(${lat ?? null}, current_lat),
                current_lng=COALESCE(${lng ?? null}, current_lng)
            WHERE id=${userId}::uuid
          `);
          socket.emit("driver:online_ack", { isOnline });
          if (!isOnline) {
            const pending = pendingOfflineTimers.get(userId);
            if (pending) { clearTimeout(pending); pendingOfflineTimers.delete(userId); }
          }
          console.log(`[SOCKET] Driver ${userId} ${isOnline ? "ONLINE" : "offline"} lat=${lat} lng=${lng}`);

          if (isOnline && hasValidCoords && lat != null && lng != null) {
            await notifyDriverNearbyTrips(userId, lat, lng);
            getRebalancingSuggestion(userId, lat, lng).then((suggestion) => {
              if (suggestion) {
                socket.emit("driver:rebalancing_suggestion", suggestion);
              }
            }).catch(() => { });
          }
        } catch (e: any) {
          console.error("[SOCKET] driver:online error:", e.message);
        }
      };

      // Register this before any awaited bootstrap work so an immediate
      // driver:online emit right after connect does not get dropped.
      socket.on("driver:online", handleDriverOnline);
      (socket.data as any).driverOnlineHandlerMovedEarlier = true;

      await disconnectDuplicateUserSockets(userId, socket.id).catch(() => {});
      addSocketPresence("driver", userId, socket.id).catch(() => {});
      socket.join(`drivers`);

      // Cancel any pending offline timer (driver reconnected within grace window)
      const pendingTimer = pendingOfflineTimers.get(userId);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingOfflineTimers.delete(userId);
        console.log(`[SOCKET] Driver ${userId} reconnected within grace window — offline timer cancelled`);
      }

      // Re-sync driver_locations.is_online with users.is_online.
      // When the app restarts after a crash/kill, is_online may be true in users table
      // but driver_locations.is_online was set false by the previous disconnect handler.
      // This ensures dispatch finds them immediately without waiting for the first location update.
      rawDb.execute(rawSql`
        UPDATE driver_locations SET is_online=true, updated_at=NOW()
        WHERE driver_id=${userId}::uuid
          AND (SELECT is_online FROM users WHERE id=${userId}::uuid LIMIT 1) = true
          AND is_online = false
      `).catch(() => { });

      const currentTripR = await rawDb.execute(rawSql`
        SELECT current_trip_id FROM users WHERE id=${userId}::uuid LIMIT 1
      `).catch(() => ({ rows: [] as any[] }));
      const currentTripId = (currentTripR.rows[0] as any)?.current_trip_id as string | undefined;
      noteSocketConnected({
        userId,
        userType: "driver",
        socketId: socket.id,
        tripId: currentTripId || undefined,
        reconnectSource: pendingTimer ? "grace_window_reconnect" : "fresh_connect",
      });

      console.log(`[SOCKET] Driver ${userId} connected`);
      const driverPresenceHeartbeat = setInterval(() => {
        touchSocketPresence("driver", userId, socket.id).catch(() => {});
      }, SOCKET_PRESENCE_HEARTBEAT_MS);
      socket.once("disconnect", () => clearInterval(driverPresenceHeartbeat));

      // ── Driver: send location update ───────────────────────────────────────
      socket.on("driver:location", async (data: { lat: number; lng: number; heading?: number; speed?: number }) => {
        try {
          const { lat, lng, heading = 0, speed = 0 } = data;
          if (!lat || !lng || !isFinite(lat) || !isFinite(lng)) return; // ignore invalid GPS
          // Update location; also set is_online=true — active location streaming means driver IS online
          await rawDb.execute(rawSql`
            INSERT INTO driver_locations (driver_id, lat, lng, heading, speed, is_online, updated_at)
            VALUES (${userId}::uuid, ${lat}, ${lng}, ${heading}, ${speed}, true, NOW())
            ON CONFLICT (driver_id) DO UPDATE
              SET lat=${lat}, lng=${lng}, heading=${heading}, speed=${speed}, is_online=true, updated_at=NOW()
          `);
          const tripR = await rawDb.execute(rawSql`
            SELECT current_trip_id FROM users WHERE id=${userId}::uuid
          `);
          const tripId = (tripR.rows[0] as any)?.current_trip_id;
          noteSocketActivity({ userId, userType: "driver", tripId });
          noteDriverLocation({ driverId: userId, tripId, lat, lng });
          if (tripId) {
            io.to(`trip:${tripId}`).emit("driver:location_update", { lat, lng, heading, speed, tripId });

            recordWaypoint(tripId, lat, lng, speed);

            const speedAlert = checkSpeedAnomaly(speed, tripId, lat, lng);
            if (speedAlert) {
              persistSafetyAlert(speedAlert, userId);
              io.to(`trip:${tripId}`).emit("safety:alert", speedAlert);
            }

            const waypoints = getTripWaypoints(tripId);
            const stopAlert = checkAbnormalStop(waypoints, tripId);
            if (stopAlert) {
              persistSafetyAlert(stopAlert, userId);
              io.to(`trip:${tripId}`).emit("safety:alert", stopAlert);
            }

            if (waypoints.length % 10 === 0) {
              try {
                const tripData = await rawDb.execute(rawSql`
                  SELECT pickup_lat, pickup_lng, destination_lat, destination_lng, current_status
                  FROM trip_requests WHERE id=${tripId}::uuid
                `);
                if (tripData.rows.length) {
                  const t = tripData.rows[0] as any;
                  if (t.current_status === 'on_the_way' && t.destination_lat && t.destination_lng) {
                    const devAlert = checkRouteDeviation(
                      lat, lng,
                      Number(t.pickup_lat), Number(t.pickup_lng),
                      Number(t.destination_lat), Number(t.destination_lng),
                      tripId
                    );
                    if (devAlert) {
                      persistSafetyAlert(devAlert, userId);
                      io.to(`trip:${tripId}`).emit("safety:alert", devAlert);
                    }
                  }
                }
              } catch { }
            }
          }
        } catch (e: any) {
          console.error("[SOCKET] driver:location error:", e.message);
        }
      });

      // ── Driver: rejoin trip room after reconnect ───────────────────────────
      socket.on("driver:rejoin_trip", async (data: { tripId: string }) => {
        try {
          const { tripId } = data;
          if (!tripId) return;
          // Verify driver still owns this active trip before joining
          const r = await rawDb.execute(rawSql`
            SELECT id FROM trip_requests
            WHERE id=${tripId}::uuid AND driver_id=${userId}::uuid
              AND current_status IN ('accepted','driver_assigned','arrived','on_the_way')
            LIMIT 1
          `);
          if (r.rows.length) {
            socket.join(`trip:${tripId}`);
            noteSocketActivity({ userId, userType: "driver", tripId });
            await noteRecoveryAudit({
              tripId,
              eventType: "socket_trip_rejoined",
              actorId: userId,
              actorType: "driver",
              meta: { source: "driver_rejoin_trip" },
              dedupeKey: `${tripId}:${userId}:socket_trip_rejoined`,
              dedupeWindowMs: 60_000,
            });
            console.log(`[SOCKET] Driver ${userId} rejoined trip room trip:${tripId} after reconnect`);
          }
        } catch (_) { }
      });

      // ── Driver: go online/offline ──────────────────────────────────────────
      socket.on("driver:online", async (data: { isOnline: boolean; lat?: number; lng?: number }) => {
        if ((socket.data as any).driverOnlineHandlerMovedEarlier) {
          return;
        }
        try {
          const { isOnline, lat, lng } = data;
          noteSocketActivity({ userId, userType: "driver" });
          const hasValidCoords = lat != null && lng != null && isFinite(lat) && isFinite(lng) && (lat !== 0 || lng !== 0);

          // UPSERT — creates the row if it doesn't exist (new drivers have no row yet)
          // Only write lat/lng if we have a valid GPS fix; never store 0,0 as it breaks radius search
          if (hasValidCoords) {
            await rawDb.execute(rawSql`
              INSERT INTO driver_locations (driver_id, lat, lng, is_online, updated_at)
              VALUES (${userId}::uuid, ${lat}, ${lng}, ${isOnline}, NOW())
              ON CONFLICT (driver_id) DO UPDATE
                SET lat=${lat}, lng=${lng}, is_online=${isOnline}, updated_at=NOW()
            `);
          } else {
            await rawDb.execute(rawSql`
              INSERT INTO driver_locations (driver_id, lat, lng, is_online, updated_at)
              VALUES (${userId}::uuid, 0, 0, ${isOnline}, NOW())
              ON CONFLICT (driver_id) DO UPDATE
                SET is_online=${isOnline}, updated_at=NOW()
            `);
          }
          await rawDb.execute(rawSql`
            UPDATE users
            SET is_online=${isOnline},
                current_lat=COALESCE(${lat ?? null}, current_lat),
                current_lng=COALESCE(${lng ?? null}, current_lng)
            WHERE id=${userId}::uuid
          `);
          socket.emit("driver:online_ack", { isOnline });
          // If driver explicitly went offline, cancel any pending grace-period timer
          if (!isOnline) {
            const pending = pendingOfflineTimers.get(userId);
            if (pending) { clearTimeout(pending); pendingOfflineTimers.delete(userId); }
          }
          console.log(`[SOCKET] Driver ${userId} ${isOnline ? "ONLINE" : "offline"} lat=${lat} lng=${lng}`);

          // If driver just came online, check for searching trips nearby
          if (isOnline && hasValidCoords && lat != null && lng != null) {
            await notifyDriverNearbyTrips(userId, lat, lng);

            // Send rebalancing suggestion if driver is in a low-demand area
            getRebalancingSuggestion(userId, lat, lng).then((suggestion) => {
              if (suggestion) {
                socket.emit("driver:rebalancing_suggestion", suggestion);
              }
            }).catch(() => { });
          }
        } catch (e: any) {
          console.error("[SOCKET] driver:online error:", e.message);
        }
      });

      // ── Driver: accept trip ────────────────────────────────────────────────
      socket.on("driver:accept_trip", async (data: { tripId: string }) => {
        console.log(`[SOCKET] driver:accept_trip received for trip ${data.tripId} from driver ${userId}`);
        try {
          const { tripId } = data;
          const pickupOtp = randomInt(1000, 10000).toString();
          // Gate driver state before trip claim to prevent bypassing HTTP checks.
          const driverStateR = await rawDb.execute(rawSql`
            SELECT id, user_type, is_locked, current_trip_id, launch_free_active, free_period_end
            FROM users
            WHERE id=${userId}::uuid
            LIMIT 1
          `);
          const driverState = driverStateR.rows[0] as any;
          if (!driverState || driverState.user_type !== 'driver') {
            socket.emit("driver:accept_trip_error", { message: "Only drivers can accept trips" });
            return;
          }
          if (driverState.is_locked) {
            socket.emit("driver:accept_trip_error", {
              message: "Account locked. Clear dues to continue",
              code: "ACCOUNT_LOCKED",
            });
            return;
          }
          if (driverState.current_trip_id) {
            socket.emit("driver:accept_trip_error", { message: "You already have an active trip" });
            return;
          }
          const busyR = await rawDb.execute(rawSql`
            SELECT id FROM trip_requests
            WHERE driver_id=${userId}::uuid
              AND current_status IN ('driver_assigned','accepted','arrived','on_the_way')
            LIMIT 1
          `);
          if (busyR.rows.length) {
            socket.emit("driver:accept_trip_error", { message: "You already have an active trip" });
            return;
          }
          if (hasActiveDispatch(tripId) && !isDriverCurrentlyOfferedTrip(tripId, userId)) {
            socket.emit("driver:accept_trip_error", {
              message: "This ride request is no longer assigned to you.",
              code: "TRIP_NOT_ASSIGNED",
            });
            return;
          }

          // Verify trip is still in searching/driver_assigned state
          const tripR = await rawDb.execute(rawSql`
            SELECT
              t.*,
              u.full_name as customer_name,
              (
                SELECT ud.fcm_token
                FROM user_devices ud
                WHERE ud.user_id = u.id
                  AND ud.fcm_token IS NOT NULL
                ORDER BY ud.updated_at DESC NULLS LAST
                LIMIT 1
              ) as customer_fcm,
              dd.vehicle_category_id,
              dl.lat as driver_lat,
              dl.lng as driver_lng
            FROM trip_requests t
            JOIN users u ON u.id = t.customer_id
            LEFT JOIN driver_details dd ON dd.user_id=${userId}::uuid
            LEFT JOIN driver_locations dl ON dl.driver_id=${userId}::uuid
            WHERE t.id=${tripId}::uuid AND t.current_status IN ('searching','driver_assigned')
          `);
          if (!tripR.rows.length) {
            socket.emit("driver:accept_trip_error", { message: "Trip no longer available" });
            return;
          }
          const trip = camelize(tripR.rows[0]) as any;
          const dispatchRequirements = await resolveDispatchRequirementsFromTrip(tripId);
          if (!dispatchRequirements) {
            socket.emit("driver:accept_trip_error", { message: "Trip no longer available", code: "TRIP_NOT_FOUND" });
            return;
          }
          const driverEligibility = await isDriverEligibleForDispatch(userId, dispatchRequirements);
          if (!driverEligibility.eligible) {
            console.warn("[SOCKET_ACCEPT] dispatch mismatch", {
              tripId,
              driverId: userId,
              reason: driverEligibility.reason || "dispatch_mismatch",
              tripType: dispatchRequirements.tripType,
              platformServiceKey: dispatchRequirements.platformServiceKey,
              vehicleCategoryId: dispatchRequirements.vehicleCategoryId,
            });
            socket.emit("driver:accept_trip_error", {
              message: `Driver not eligible for this booking: ${driverEligibility.reason || "dispatch_mismatch"}`,
              code: "DISPATCH_MISMATCH",
              reason: driverEligibility.reason || "dispatch_mismatch",
            });
            return;
          }

          // P0: subscription gate (matches HTTP accept-trip)
          try {
            await assertDriverCanAcceptRideTrip(userId, dispatchRequirements.tripType);
          } catch (subErr: any) {
            socket.emit("driver:accept_trip_error", {
              message: subErr?.message || "Active subscription required to accept rides.",
              code: subErr?.code || "SUBSCRIPTION_REQUIRED",
            });
            return;
          }

          // Atomically claim the trip — only if still available (prevents race condition)
          const acceptOutcome = await rawDb.transaction(async (tx) => {
            const driverLock = await tx.execute(rawSql`
              SELECT id, current_trip_id
              FROM users
              WHERE id=${userId}::uuid
              FOR UPDATE
            `);
            if (!driverLock.rows.length) {
              return { ok: false as const, message: "Driver account not found" };
            }
            const driverRow = driverLock.rows[0] as any;
            if (driverRow.current_trip_id && String(driverRow.current_trip_id) !== tripId) {
              return { ok: false as const, message: "Driver already has another active trip" };
            }
            const tripLock = await tx.execute(rawSql`
              SELECT *
              FROM trip_requests
              WHERE id=${tripId}::uuid
              FOR UPDATE
            `);
            if (!tripLock.rows.length) {
              return { ok: false as const, message: "Trip no longer available" };
            }
            const tripInfo = tripLock.rows[0] as any;
            if (!["searching", "driver_assigned"].includes(String(tripInfo.current_status || ""))) {
              return { ok: false as const, message: "Trip was already accepted by another pilot" };
            }
            if (tripInfo.driver_id && String(tripInfo.driver_id) !== userId) {
              return { ok: false as const, message: "Trip was already accepted by another pilot" };
            }
            await tx.execute(rawSql`
              UPDATE trip_requests
              SET driver_id=${userId}::uuid,
                  current_status='accepted',
                  driver_accepted_at=NOW(),
                  driver_arriving_at=NOW(),
                  pickup_otp=${pickupOtp},
                  updated_at=NOW()
              WHERE id=${tripId}::uuid
            `);
            await tx.execute(rawSql`
              UPDATE users
              SET current_trip_id=${tripId}::uuid
              WHERE id=${userId}::uuid
            `);
            return { ok: true as const };
          });
          if (!acceptOutcome.ok) {
            socket.emit("driver:accept_trip_error", { message: acceptOutcome.message });
            return;
          }
          await appendTripStatus(tripId, "accepted", "driver", "Driver accepted trip via socket");
          await logRideLifecycleEvent(tripId, "trip_accepted", userId, "driver", {
            via: "socket",
            pickupOtp,
          });
          noteSocketActivity({ userId, userType: "driver", tripId });

          // Notify dispatch engine — clears timers and notifies other drivers
          dispatchOnDriverAccepted(tripId, userId);

          // Get driver info
          const driverR = await rawDb.execute(rawSql`
            SELECT full_name, phone, rating, profile_photo FROM users WHERE id=${userId}::uuid
          `);
          const driver = (camelize(driverR.rows[0]) || {}) as any;

          // Get driver vehicle details
          const vehicleR = await rawDb.execute(rawSql`
            SELECT u.vehicle_number, u.vehicle_model, vc.name as vehicle_category
            FROM users u
            LEFT JOIN driver_details dd ON dd.user_id = u.id
            LEFT JOIN vehicle_categories vc ON vc.id = dd.vehicle_category_id
            WHERE u.id = ${userId}::uuid
            LIMIT 1
          `).catch(() => ({ rows: [] }));
          const vehicle = (vehicleR.rows[0] as any) || {};

          // Notify customer via socket (with full driver + vehicle info)
          io.to(`user:${trip.customerId}`).emit("trip:driver_assigned", {
            tripId,
            pickupOtp,
            status: "accepted",
            currentStatus: "accepted",
            driver: {
              id: userId,
              fullName: driver.fullName,
              phone: driver.phone,
              rating: driver.rating,
              photo: driver.profilePhoto,
              vehicleNumber: vehicle.vehicle_number || '',
              vehicleModel: vehicle.vehicle_model || '',
              vehicleCategory: vehicle.vehicle_category || '',
              lat: trip.driverLat,
              lng: trip.driverLng,
            },
          });
          io.to(`user:${trip.customerId}`).emit("trip:accepted", {
            tripId,
            pickupOtp,
            status: "accepted",
            currentStatus: "accepted",
            driverId: userId,
            driverName: driver.fullName,
            driverPhone: driver.phone,
            driverPhoto: driver.profilePhoto,
            driverRating: driver.rating,
            driverVehicleNumber: vehicle.vehicle_number || '',
            driverVehicleModel: vehicle.vehicle_model || '',
            vehicleName: vehicle.vehicle_category || '',
            driver: {
              id: userId,
              fullName: driver.fullName,
              phone: driver.phone,
              rating: driver.rating,
              photo: driver.profilePhoto,
              vehicleNumber: vehicle.vehicle_number || '',
              vehicleModel: vehicle.vehicle_model || '',
              vehicleCategory: vehicle.vehicle_category || '',
              lat: trip.driverLat,
              lng: trip.driverLng,
            },
          });
          io.to(`trip:${tripId}`).emit("trip:status_update", {
            tripId,
            status: "accepted",
            currentStatus: "accepted",
            otp: pickupOtp,
            driver: {
              id: userId,
              fullName: driver.fullName,
              phone: driver.phone,
              rating: driver.rating,
              photo: driver.profilePhoto,
              vehicleNumber: vehicle.vehicle_number || '',
              vehicleModel: vehicle.vehicle_model || '',
              vehicleCategory: vehicle.vehicle_category || '',
              lat: trip.driverLat,
              lng: trip.driverLng,
            },
          });

          // Notify all other nearby drivers that the trip has been taken
          try {
            const nearbyDrivers = await rawDb.execute(rawSql`
              SELECT dl.driver_id FROM driver_locations dl
              JOIN users u ON u.id = dl.driver_id
              WHERE u.is_online = true AND u.id != ${userId}::uuid
                AND ((dl.lat - ${trip.pickupLat || 0})*(dl.lat - ${trip.pickupLat || 0}) + (dl.lng - ${trip.pickupLng || 0})*(dl.lng - ${trip.pickupLng || 0})) < 0.1
            `);
            for (const row of nearbyDrivers.rows) {
              const dId = (row as any).driver_id;
              io.to(`user:${dId}`).emit("trip:request_taken", { tripId });
            }
          } catch { }

          // FCM fallback (customer may be in background)
          try {
            const custDevR = await rawDb.execute(rawSql`
              SELECT fcm_token FROM user_devices WHERE user_id=${trip.customerId}::uuid AND fcm_token IS NOT NULL LIMIT 1
            `);
            const custFcm = (custDevR.rows[0] as any)?.fcm_token;
            if (custFcm) {
              notifyCustomerDriverAccepted({
                fcmToken: custFcm,
                driverName: driver.fullName,
                tripId,
              }).catch(() => { });
            }
          } catch { }

          // Driver joins the trip room so they receive real-time events (cancellation, status changes)
          socket.join(`trip:${tripId}`);
          emitRealtimeOpsSnapshot("trip_accepted").catch(() => {});
          socket.emit("driver:accept_trip_ok", { tripId, trip });
          console.log(`[SOCKET] Driver ${userId} accepted trip ${tripId}`);
        } catch (e: any) {
          console.error("[SOCKET] driver:accept_trip error:", e.message);
          socket.emit("driver:accept_trip_error", { message: safeSocketErrMsg(e) });
        }
      });

      // ── Driver: respond to ping (FIX #1: Driver verification) ─────────────────
      const handlePingResponse = async (data: { tripId: string }) => {
        try {
          if (!userId) return;
          noteSocketActivity({ userId, userType: "driver", tripId: data?.tripId });
          const { handleDriverPingResponse } = await import("./hardening");
          const success = handleDriverPingResponse(userId);
          if (success) {
            socket.emit("system:ping_ack", { status: "ok" });
          }
        } catch (e: any) {
          console.error("[SOCKET] ping_response error:", e.message);
        }
      };
      socket.on("system:ping_response", handlePingResponse);
      socket.on("ping_response", handlePingResponse);

      // ── Driver: update trip status ─────────────────────────────────────────
      socket.on("driver:trip_status", async (data: { tripId: string; status: string; otp?: string }) => {
        try {
          const { tripId, status, otp } = data;
          noteSocketActivity({ userId, userType: "driver", tripId });
          const allowed = ["accepted", "arrived", "on_the_way", "completed", "cancelled"];
          if (!allowed.includes(status)) {
            socket.emit("error", { message: "Invalid status" });
            return;
          }

          if (status === "on_the_way") {
            await rawDb.execute(rawSql`
              UPDATE trip_requests SET current_status=${status}, ride_started_at=NOW(), updated_at=NOW()
              WHERE id=${tripId}::uuid
            `);
          } else if (status === "completed") {
            // PAYMENT GATE: trip only moves to completed if payment is verified
            const paymentCheckR = await rawDb.execute(rawSql`
              SELECT payment_status, payment_method FROM trip_requests WHERE id=${tripId}::uuid
            `);
            const paymentStatus = (paymentCheckR.rows[0] as any)?.payment_status;
            const paymentMethod = (paymentCheckR.rows[0] as any)?.payment_method;
            // Cash trips: always allow completion (driver collects cash in person)
            // Paid/wallet/online trips: verify payment_status before completing
            const paymentClear = paymentMethod === 'cash' || paymentStatus === 'paid' || paymentStatus === 'cash' || paymentStatus === 'paid_online' || paymentStatus === 'wallet_paid';
            if (paymentClear) {
              // Payment verified (or cash — no pre-verification needed)
              await rawDb.execute(rawSql`
                UPDATE trip_requests SET current_status=${status}, completed_at=NOW(), updated_at=NOW()
                WHERE id=${tripId}::uuid
              `);
            } else {
              // Payment not yet verified — hold trip in payment_pending state
              await rawDb.execute(rawSql`
                UPDATE trip_requests SET current_status='payment_pending', updated_at=NOW()
                WHERE id=${tripId}::uuid
              `);
              // Notify customer to complete payment before trip is marked done
              const pendingTripR = await rawDb.execute(rawSql`
                SELECT customer_id FROM trip_requests WHERE id=${tripId}::uuid
              `);
              if (pendingTripR.rows.length) {
                const customerId = (pendingTripR.rows[0] as any).customer_id;
                io.to(`user:${customerId}`).emit("trip:payment_pending", {
                  tripId,
                  status: "payment_pending",
                  currentStatus: "payment_pending",
                  message: "Ride complete. Awaiting payment confirmation.",
                });
                io.to(`user:${customerId}`).emit("trip:status_update", {
                  tripId,
                  status: "payment_pending",
                  currentStatus: "payment_pending",
                  message: "Ride complete. Awaiting payment confirmation.",
                });
                io.to(`trip:${tripId}`).emit("trip:status_update", {
                  tripId,
                  status: "payment_pending",
                  currentStatus: "payment_pending",
                  message: "Ride complete. Awaiting payment confirmation.",
                });
              }
              socket.emit("driver:trip_status_ok", { tripId, status: "payment_pending" });
              console.log(`[SOCKET] Trip ${tripId} held at payment_pending — payment not verified`);
              return;
            }
          } else {
            await rawDb.execute(rawSql`
              UPDATE trip_requests SET current_status=${status}, updated_at=NOW()
              WHERE id=${tripId}::uuid
            `);
          }

          if (status === "completed" || status === "cancelled") {
            await rawDb.execute(rawSql`UPDATE users SET current_trip_id=NULL WHERE id=${userId}::uuid`);
          }
          await appendTripStatus(tripId, status, "driver", `Driver moved trip to ${status} via socket`);
          await logRideLifecycleEvent(tripId, status === "arrived" ? "driver_arrived" : status === "on_the_way" ? "trip_started" : status === "completed" ? "trip_completed" : status === "cancelled" ? "trip_cancelled" : "trip_status_updated", userId, "driver", {
            via: "socket",
            status,
            otp,
          });

          // Get customer id + fare for FCM
          const tripR = await rawDb.execute(rawSql`SELECT customer_id, estimated_fare, actual_fare FROM trip_requests WHERE id=${tripId}::uuid`);
          if (tripR.rows.length) {
            const customerId = (tripR.rows[0] as any).customer_id;
            const fare = (tripR.rows[0] as any).actual_fare || (tripR.rows[0] as any).estimated_fare || 0;
            // Socket notify (foreground)
            const dObjR = await rawDb.execute(rawSql`
              SELECT u.full_name, u.phone, u.rating, u.profile_photo,
                u.vehicle_number, u.vehicle_model, vc.name as vehicle_category,
                dl.lat, dl.lng
              FROM users u
              LEFT JOIN driver_details dd ON dd.user_id = u.id
              LEFT JOIN vehicle_categories vc ON vc.id = dd.vehicle_category_id
              LEFT JOIN driver_locations dl ON dl.driver_id = u.id
              WHERE u.id = (SELECT driver_id FROM trip_requests WHERE id=${tripId}::uuid)
              LIMIT 1
            `).catch(() => ({ rows: [] }));
            const dObjRaw = dObjR.rows[0] as any;
            const driver = dObjRaw ? {
              id: dObjRaw.id,
              fullName: dObjRaw.full_name,
              phone: dObjRaw.phone,
              rating: dObjRaw.rating,
              photo: dObjRaw.profile_photo,
              vehicleNumber: dObjRaw.vehicle_number || '',
              vehicleModel: dObjRaw.vehicle_model || '',
              vehicleCategory: dObjRaw.vehicle_category || '',
              lat: dObjRaw.lat,
              lng: dObjRaw.lng,
            } : undefined;

            const payload = { tripId, status, otp, driver };
            io.to(`user:${customerId}`).emit("trip:status_update", payload);
            io.to(`trip:${tripId}`).emit("trip:status_update", payload);
            // FCM fallback (background) for key status changes
            if (status === "completed" || status === "cancelled") {
              try {
                const custDevR = await rawDb.execute(rawSql`
                  SELECT fcm_token FROM user_devices WHERE user_id=${customerId}::uuid AND fcm_token IS NOT NULL LIMIT 1
                `);
                const custFcm = (custDevR.rows[0] as any)?.fcm_token;
                if (custFcm) {
                  if (status === "completed") {
                    notifyCustomerTripCompleted({ fcmToken: custFcm, fare: Number(fare), tripId }).catch(() => { });
                  } else {
                    notifyTripCancelled({ fcmToken: custFcm, cancelledBy: "driver", tripId }).catch(() => { });
                  }
                }
              } catch { }
            }
          }

          socket.emit("driver:trip_status_ok", { tripId, status });
          console.log(`[SOCKET] Trip ${tripId} status → ${status}`);
        } catch (e: any) {
          console.error("[SOCKET] driver:trip_status error:", e.message);
        }
      });

      // ── Driver: accept parcel order via socket ─────────────────────────────
      socket.on("driver:accept_parcel", async (data: { orderId: string }) => {
        try {
          const { orderId } = data;
          if (!orderId) return;

          // Atomically claim the parcel order
          const r = await rawDb.execute(rawSql`
            UPDATE parcel_orders
            SET driver_id = ${userId}::uuid, current_status = 'driver_assigned', updated_at = NOW()
            WHERE id = ${orderId}::uuid AND current_status = 'searching' AND driver_id IS NULL
            RETURNING id, customer_id, drop_locations
          `);
          if (!r.rows.length) {
            socket.emit("parcel:accept_error", { orderId, message: "Order already assigned or unavailable" });
            return;
          }
          const order = r.rows[0] as any;
          const driverR = await rawDb.execute(rawSql`SELECT full_name FROM users WHERE id=${userId}::uuid`);
          const driverName = (driverR.rows[0] as any)?.full_name || "Pilot";

          emitParcelLifecycle(orderId, order.customer_id, userId, "driver_assigned", { driverName });
          socket.emit("parcel:accept_ok", { orderId });
          socket.join(`parcel:${orderId}`);
          console.log(`[SOCKET] Driver ${userId} accepted parcel ${orderId}`);
        } catch (e: any) {
          console.error("[SOCKET] driver:accept_parcel error:", e.message);
          socket.emit("parcel:accept_error", { message: safeSocketErrMsg(e) });
        }
      });

      // ── Driver: update parcel status ───────────────────────────────────────
      socket.on("driver:parcel_status", async (data: { orderId: string; status: string }) => {
        try {
          const { orderId, status } = data;
          const allowed = ["picked_up", "in_transit", "delivery_approaching", "cancelled"];
          if (!allowed.includes(status)) {
            socket.emit("parcel:status_error", { message: "Invalid status" });
            return;
          }

          const orderR = await rawDb.execute(rawSql`
            SELECT customer_id, driver_id, drop_locations, current_status
            FROM parcel_orders WHERE id = ${orderId}::uuid AND driver_id = ${userId}::uuid
          `);
          if (!orderR.rows.length) {
            socket.emit("parcel:status_error", { message: "Order not found" });
            return;
          }
          const order = orderR.rows[0] as any;
          const drops: any[] = typeof order.drop_locations === 'string'
            ? JSON.parse(order.drop_locations) : (order.drop_locations || []);

          const dbStatus = status === "picked_up" ? "in_transit" : status;
          await rawDb.execute(rawSql`
            UPDATE parcel_orders SET current_status = ${dbStatus}, updated_at = NOW()
            WHERE id = ${orderId}::uuid
          `);

          const driverR = await rawDb.execute(rawSql`SELECT full_name FROM users WHERE id=${userId}::uuid`);
          const driverName = (driverR.rows[0] as any)?.full_name || "Pilot";

          if (status === "picked_up") {
            emitParcelLifecycle(orderId, order.customer_id, userId, "pickup_started", { driverName });
            // Notify all receivers that parcel has been picked up
            notifyAllReceivers(orderId, drops, "pickup_started", driverName).catch(() => { });
          } else if (status === "delivery_approaching") {
            emitParcelLifecycle(orderId, order.customer_id, userId, "delivery_approaching", { driverName });
            // Notify current drop receiver
            const currentDrop = drops[order.current_drop_index || 0];
            if (currentDrop?.receiverPhone) {
              notifyReceiver({
                receiverPhone: currentDrop.receiverPhone,
                receiverName: currentDrop.receiverName || "Customer",
                eventType: "arriving",
                orderId,
                otp: currentDrop.deliveryOtp,
                driverName,
              }).catch(() => { });
            }
          } else if (status === "cancelled") {
            emitParcelLifecycle(orderId, order.customer_id, userId, "cancelled", { reason: "Driver cancelled" });
          }

          socket.emit("parcel:status_ok", { orderId, status });
          console.log(`[SOCKET] Parcel ${orderId} status → ${status}`);
        } catch (e: any) {
          console.error("[SOCKET] driver:parcel_status error:", e.message);
          socket.emit("parcel:status_error", { message: safeSocketErrMsg(e) });
        }
      });

      // ── Driver: parcel location broadcast (for parcel tracking) ────────────
      socket.on("driver:parcel_location", async (data: { orderId: string; lat: number; lng: number }) => {
        try {
          const { orderId, lat, lng } = data;
          if (!orderId || !lat || !lng) return;
          // Verify driver is assigned to this parcel
          const r = await rawDb.execute(rawSql`
            SELECT customer_id FROM parcel_orders
            WHERE id = ${orderId}::uuid AND driver_id = ${userId}::uuid
              AND current_status IN ('driver_assigned', 'accepted', 'picked_up', 'in_transit')
          `);
          if (!r.rows.length) return;
          const customerId = (r.rows[0] as any).customer_id;
          io.to(`user:${customerId}`).emit("parcel:driver_location", { orderId, lat, lng, timestamp: new Date().toISOString() });
        } catch { }
      });

    } else if (userType === "customer") {
      await disconnectDuplicateUserSockets(userId, socket.id).catch(() => {});
      addSocketPresence("customer", userId, socket.id).catch(() => {});
      console.log(`[SOCKET] Customer ${userId} connected`);
      const customerPresenceHeartbeat = setInterval(() => {
        touchSocketPresence("customer", userId, socket.id).catch(() => {});
      }, SOCKET_PRESENCE_HEARTBEAT_MS);
      socket.once("disconnect", () => clearInterval(customerPresenceHeartbeat));

      // ── Customer: join trip room for tracking ──────────────────────────────
      socket.on("customer:track_trip", async (data: { tripId: string }) => {
        try {
          const { tripId } = data;
          if (!tripId) return;
          const tripR = await rawDb.execute(rawSql`
            SELECT id FROM trip_requests WHERE id=${tripId}::uuid AND customer_id=${userId}::uuid
          `);
          if (!tripR.rows.length) {
            socket.emit("error", { message: "Trip not found" });
            return;
          }
          socket.join(`trip:${tripId}`);
          await noteRecoveryAudit({
            tripId,
            eventType: "customer_trip_tracking_restored",
            actorId: userId,
            actorType: "customer",
            meta: { source: "customer_track_trip" },
            dedupeKey: `${tripId}:${userId}:customer_track_trip`,
            dedupeWindowMs: 60_000,
          });
          console.log(`[SOCKET] Customer ${userId} tracking trip ${tripId}`);
        } catch (e: any) {
          console.error("[SOCKET] customer:track_trip error:", e.message);
        }
      });

      // ── Customer: cancel trip ──────────────────────────────────────────────
      socket.on("customer:cancel_trip", async (data: { tripId: string }) => {
        try {
          const { tripId } = data;
          const tripR = await rawDb.execute(rawSql`
            SELECT driver_id FROM trip_requests
            WHERE id=${tripId}::uuid AND customer_id=${userId}::uuid AND current_status NOT IN ('completed','cancelled')
          `);
          if (!tripR.rows.length) {
            socket.emit("error", { message: "Trip not found or already ended" });
            return;
          }
          const driverId = (tripR.rows[0] as any).driver_id;
          await rawDb.execute(rawSql`
            UPDATE trip_requests SET current_status='cancelled', updated_at=NOW() WHERE id=${tripId}::uuid
          `);
          await appendTripStatus(tripId, "cancelled", "customer", "Customer cancelled via socket");
          await logRideLifecycleEvent(tripId, "trip_cancelled", userId, "customer", {
            via: "socket",
          });
          // Cancel active dispatch session
          dispatchCancelTrip(tripId);
          if (driverId) {
            await rawDb.execute(rawSql`UPDATE users SET current_trip_id=NULL WHERE id=${driverId}::uuid`);
            io.to(`user:${driverId}`).emit("trip:cancelled", { tripId, cancelledBy: "customer" });
          }
          socket.emit("trip:cancelled", { tripId, cancelledBy: "customer" });
        } catch (e: any) {
          console.error("[SOCKET] customer:cancel_trip error:", e.message);
        }
      });

      // ── Customer: track parcel order ───────────────────────────────────────
      socket.on("customer:track_parcel", async (data: { orderId: string }) => {
        try {
          const { orderId } = data;
          if (!orderId) return;
          const r = await rawDb.execute(rawSql`
            SELECT id FROM parcel_orders WHERE id=${orderId}::uuid AND customer_id=${userId}::uuid
          `);
          if (!r.rows.length) {
            socket.emit("parcel:error", { message: "Parcel order not found" });
            return;
          }
          socket.join(`parcel:${orderId}`);
          socket.emit("parcel:tracking_started", { orderId });
          console.log(`[SOCKET] Customer ${userId} tracking parcel ${orderId}`);
        } catch (e: any) {
          console.error("[SOCKET] customer:track_parcel error:", e.message);
        }
      });

      // ── Customer: cancel parcel order ──────────────────────────────────────
      socket.on("customer:cancel_parcel", async (data: { orderId: string; reason?: string }) => {
        try {
          const { orderId, reason } = data;
          if (!orderId) return;
          const r = await rawDb.execute(rawSql`
            UPDATE parcel_orders
            SET current_status = 'cancelled', cancelled_reason = ${reason || 'Customer cancelled via app'}, updated_at = NOW()
            WHERE id = ${orderId}::uuid AND customer_id = ${userId}::uuid
              AND current_status IN ('pending', 'searching')
            RETURNING id, driver_id
          `);
          if (!r.rows.length) {
            socket.emit("parcel:cancel_error", { message: "Cannot cancel this order" });
            return;
          }
          const driverId = (r.rows[0] as any)?.driver_id;
          emitParcelLifecycle(orderId, userId, driverId, "cancelled", { reason: reason || "Customer cancelled" });
          socket.emit("parcel:cancelled", { orderId });
        } catch (e: any) {
          console.error("[SOCKET] customer:cancel_parcel error:", e.message);
        }
      });
    }

    // ── In-app trip chat relay + DB persistence ──────────────────────────────
    socket.on("trip:send_message", async (data: { tripId: string; message: string; senderName: string; senderType: string }) => {
      try {
        const { tripId, message, senderName, senderType } = data;
        if (!tripId || !message?.trim() || message.length > 2000) return;

        const now = new Date();

        // Persist to DB first
        await rawDb.execute(rawSql`
          INSERT INTO trip_messages (trip_id, sender_id, sender_type, sender_name, message, created_at)
          VALUES (${tripId}::uuid, ${userId}::uuid, ${senderType || 'customer'}, ${senderName || ''}, ${message.trim()}, ${now.toISOString()})
        `);

        // Then relay to all participants in the trip room
        io.to(`trip:${tripId}`).emit("trip:new_message", {
          from: userId,
          senderType: senderType || 'customer',
          senderName: senderName || '',
          message: message.trim(),
          timestamp: now.toISOString(),
        });
      } catch (e: any) {
        console.error("[SOCKET] trip:send_message error:", e.message);
      }
    });

    // ── Load chat history on reconnect ────────────────────────────────────────
    socket.on("trip:get_messages", async (data: { tripId: string }) => {
      try {
        const { tripId } = data;
        if (!tripId) return;

        const rows = await rawDb.execute(rawSql`
          SELECT id, trip_id, sender_id, sender_type, sender_name, message, created_at
          FROM trip_messages
          WHERE trip_id = ${tripId}::uuid
          ORDER BY created_at ASC
          LIMIT 200
        `);

        socket.emit("trip:message_history", {
          tripId,
          messages: rows.rows.map((r: any) => ({
            id: r.id,
            from: r.sender_id,
            senderType: r.sender_type,
            senderName: r.sender_name,
            message: r.message,
            timestamp: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
          })),
        });
      } catch (e: any) {
        console.error("[SOCKET] trip:get_messages error:", e.message);
      }
    });

    socket.on("pool:join_chat", async (data: { module: string; referenceId: string }) => {
      try {
        const referenceId = String(data.referenceId || "");
        const ctx = await getPoolCommunicationContext(data.module, referenceId, userId, userId);
        if (!ctx.ok) {
          socket.emit("call:error", { message: ctx.message });
          return;
        }
        if (!isPoolChatAllowed(ctx.status)) {
          socket.emit("call:error", { message: "Pool chat is not available for this ride status." });
          return;
        }
        socket.join(`pool:${ctx.module}:${referenceId}`);
      } catch (e: any) {
        console.error("[SOCKET] pool:join_chat error:", e.message);
      }
    });

    socket.on("pool:send_message", async (data: { module: string; referenceId: string; message: string; senderName: string; senderType: string }) => {
      try {
        const referenceId = String(data.referenceId || "");
        const message = String(data.message || "").trim();
        if (!referenceId || !message || message.length > 2000) return;
        const ctx = await getPoolCommunicationContext(data.module, referenceId, userId, userId);
        if (!ctx.ok) {
          socket.emit("call:error", { message: ctx.message });
          return;
        }
        if (!isPoolChatAllowed(ctx.status)) {
          socket.emit("call:error", { message: "Pool chat is not available for this ride status." });
          return;
        }
        const roomId = `pool:${ctx.module}:${referenceId}`;
        socket.join(roomId);
        const now = new Date();
        await rawDb.execute(rawSql`
          INSERT INTO pool_messages (module, reference_id, sender_id, sender_type, sender_name, message, created_at)
          VALUES (
            ${ctx.module},
            ${referenceId}::uuid,
            ${userId}::uuid,
            ${String(data.senderType || userType || "customer")},
            ${String(data.senderName || "")},
            ${message},
            ${now.toISOString()}
          )
        `);
        io.to(roomId).emit("pool:new_message", {
          module: ctx.module,
          referenceId,
          from: userId,
          senderType: String(data.senderType || userType || "customer"),
          senderName: String(data.senderName || ""),
          message,
          timestamp: now.toISOString(),
        });
      } catch (e: any) {
        console.error("[SOCKET] pool:send_message error:", e.message);
      }
    });

    socket.on("pool:get_messages", async (data: { module: string; referenceId: string }) => {
      try {
        const referenceId = String(data.referenceId || "");
        if (!referenceId) return;
        const ctx = await getPoolCommunicationContext(data.module, referenceId, userId, userId);
        if (!ctx.ok) {
          socket.emit("call:error", { message: ctx.message });
          return;
        }
        const roomId = `pool:${ctx.module}:${referenceId}`;
        socket.join(roomId);
        const rows = await rawDb.execute(rawSql`
          SELECT id, sender_id, sender_type, sender_name, message, created_at
          FROM pool_messages
          WHERE module = ${ctx.module}
            AND reference_id = ${referenceId}::uuid
          ORDER BY created_at ASC
          LIMIT 200
        `);

        socket.emit("pool:message_history", {
          module: ctx.module,
          referenceId,
          messages: rows.rows.map((r: any) => ({
            id: r.id,
            from: r.sender_id,
            senderType: r.sender_type,
            senderName: r.sender_name,
            message: r.message,
            timestamp: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
          })),
        });
      } catch (e: any) {
        console.error("[SOCKET] pool:get_messages error:", e.message);
      }
    });

    // ── In-app call signaling (WebRTC relay) ──────────────────────────────────
    // Only allowed during active trip: accepted → arrived → on_the_way
    // Phone numbers are MASKED — real numbers never exposed over socket

    // Track active call sessions: tripId → { callerId, targetId, startedAt }
    socket.on("call:initiate", async (data: { targetUserId: string; tripId: string; callerName: string; scope?: string; module?: string }) => {
      try {
        const { targetUserId, tripId, callerName } = data;
        if (!targetUserId || !tripId) {
          socket.emit("call:error", { message: "Call session details are missing." });
          return;
        }

        if (userType === "admin") {
          activeCallSessions.set(tripId, {
            sessionId: tripId,
            tripId,
            callerId: userId,
            targetId: targetUserId,
            startedAt: Date.now(),
            mode: "support",
          });
          io.to(`user:${targetUserId}`).emit("call:incoming", {
            callerId: userId,
            callerName,
            tripId,
            callMode: "support",
            maskedPhone: null,
          });
          console.log(`[CALL] admin ${userId} -> ${targetUserId} support session ${tripId}`);
          return;
        }

        if (isSupportCallTarget(targetUserId)) {
          activeCallSessions.set(tripId, {
            sessionId: tripId,
            tripId,
            callerId: userId,
            targetId: SUPPORT_CALL_TARGET,
            startedAt: Date.now(),
            mode: "support",
          });
          io.to("admin:ops").emit("call:incoming", {
            callerId: userId,
            callerName,
            callerType: userType,
            tripId,
            callMode: "support",
            maskedPhone: null,
          });
          console.log(`[CALL] ${userType} ${userId} -> admin support session ${tripId}`);
          return;
        }

        const callScope = data.scope === "pool" ? "pool" : "trip";
        if (callScope === "pool") {
          const poolCtx = await getPoolCommunicationContext(data.module, tripId, userId, targetUserId);
          if (!poolCtx.ok) {
            socket.emit("call:error", { message: poolCtx.message });
            return;
          }
          if (!isPoolCallAllowed(poolCtx.status)) {
            socket.emit("call:error", { message: "Calling is only available before or during the active pooled ride." });
            return;
          }
          const existingPoolSession = activeCallSessions.get(tripId);
          if (existingPoolSession && !isCallSessionParticipant(existingPoolSession, userId, targetUserId)) {
            socket.emit("call:error", { message: "Another call is already active for this pool ride." });
            return;
          }
          activeCallSessions.set(tripId, {
            sessionId: tripId,
            tripId,
            callerId: userId,
            targetId: targetUserId,
            startedAt: Date.now(),
            mode: "ride",
            scope: "pool",
            module: poolCtx.module,
          });
          io.to(`user:${targetUserId}`).emit("call:incoming", {
            callerId: userId,
            callerName,
            tripId,
            callMode: "ride",
            callScope: "pool",
            poolModule: poolCtx.module,
            maskedPhone: null,
          });
          console.log(`[CALL] ${userId} -> ${targetUserId} pool session ${poolCtx.module}:${tripId}`);
          return;
        }

        const tripCheck = await getRideSafetyCallTrip(tripId, userId, targetUserId);
        if (!tripCheck.ok) {
          socket.emit("call:error", { message: tripCheck.message });
          return;
        }

        const existingSession = activeCallSessions.get(tripId);
        if (existingSession && !isCallSessionParticipant(existingSession, userId, targetUserId)) {
          socket.emit("call:error", { message: "Another call is already active for this trip." });
          return;
        }

        await rawDb.execute(rawSql`
          INSERT INTO call_logs (caller_id, receiver_id, trip_id, status, initiated_at)
          VALUES (${userId}::uuid, ${targetUserId}::uuid, ${tripId}::uuid, 'initiated', NOW())
          ON CONFLICT DO NOTHING
        `).catch(() => {});

        activeCallSessions.set(tripId, {
          sessionId: tripId,
          tripId,
          callerId: userId,
          targetId: targetUserId,
          startedAt: Date.now(),
          mode: "ride",
          scope: "trip",
        });

        io.to(`user:${targetUserId}`).emit("call:incoming", {
          callerId: userId,
          callerName,
          tripId,
          callMode: "ride",
          maskedPhone: null,
        });

        try {
          const fcmRow = await rawDb.execute(rawSql`
            SELECT fcm_token FROM users WHERE id=${targetUserId}::uuid AND fcm_token IS NOT NULL LIMIT 1
          `);
          const fcmToken = (fcmRow.rows[0] as any)?.fcm_token;
          if (fcmToken) {
            await sendFcmNotification({
              fcmToken,
              title: "Incoming Call",
              body: `${callerName} is calling you`,
              sound: "trip_alert",
              channelId: "call_alerts",
              data: {
                type: "incoming_call",
                callerId: userId,
                callerName,
                tripId,
              },
            });
          }
        } catch (_) {}

        console.log(`[CALL] ${userId} -> ${targetUserId} ride session ${tripId}`);
      } catch (e: any) {
        socket.emit("call:error", { message: "Call initiation failed" });
      }
    });

    socket.on("call:offer", async (data: { targetUserId: string; tripId: string; sdp: any; scope?: string; module?: string }) => {
      const session = activeCallSessions.get(data.tripId);
      if (!session) {
        socket.emit("call:error", { message: "Call session is no longer active." });
        return;
      }
      if (session.mode === "ride") {
        if (session.scope === "pool") {
          const poolCtx = await getPoolCommunicationContext(session.module, data.tripId, userId, data.targetUserId);
          if (!poolCtx.ok || !isCallSessionParticipant(session, userId, data.targetUserId) || !isPoolCallAllowed(poolCtx.status)) {
            activeCallSessions.delete(data.tripId);
            socket.emit("call:ended", { by: "system", reason: poolCtx.ok ? "Call session ended." : poolCtx.message, callScope: "pool", poolModule: session.module });
            return;
          }
          io.to(`user:${data.targetUserId}`).emit("call:offer", {
            callerId: userId,
            tripId: data.tripId,
            callMode: "ride",
            callScope: "pool",
            poolModule: session.module,
            sdp: data.sdp,
          });
          return;
        }
        const tripCheck = await getRideSafetyCallTrip(data.tripId, userId, data.targetUserId);
        if (!tripCheck.ok || !isCallSessionParticipant(session, userId, data.targetUserId)) {
          activeCallSessions.delete(data.tripId);
          socket.emit("call:ended", { by: "system", reason: tripCheck.message || "Call session ended." });
          return;
        }
        io.to(`user:${data.targetUserId}`).emit("call:offer", {
          callerId: userId,
          tripId: data.tripId,
          callMode: "ride",
          sdp: data.sdp,
        });
        return;
      }

      if (userId === session.callerId) {
        const supportTarget = session.targetId === SUPPORT_CALL_TARGET ? "admin:ops" : `user:${session.targetId}`;
        io.to(supportTarget).emit("call:offer", {
          callerId: userId,
          tripId: data.tripId,
          callMode: "support",
          sdp: data.sdp,
        });
        return;
      }

      if (session.targetId === userId || session.callerId === data.targetUserId) {
        io.to(`user:${session.callerId}`).emit("call:offer", {
          callerId: userId,
          tripId: data.tripId,
          callMode: "support",
          sdp: data.sdp,
        });
        return;
      }

      socket.emit("call:error", { message: "You are not allowed to use this support call session." });
    });

    socket.on("call:answer", async (data: { targetUserId: string; tripId: string; sdp: any; scope?: string; module?: string }) => {
      const session = activeCallSessions.get(data.tripId);
      if (!session) {
        socket.emit("call:error", { message: "Call session is no longer active." });
        return;
      }
      if (session.mode === "ride") {
        if (session.scope === "pool") {
          const poolCtx = await getPoolCommunicationContext(session.module, data.tripId, userId, data.targetUserId);
          if (!poolCtx.ok || !isCallSessionParticipant(session, userId, data.targetUserId) || !isPoolCallAllowed(poolCtx.status)) {
            activeCallSessions.delete(data.tripId);
            socket.emit("call:ended", { by: "system", reason: poolCtx.ok ? "Call session ended." : poolCtx.message, callScope: "pool", poolModule: session.module });
            return;
          }
          session.connectedAt = Date.now();
          io.to(`user:${data.targetUserId}`).emit("call:answer", {
            callerId: userId,
            tripId: data.tripId,
            callMode: "ride",
            callScope: "pool",
            poolModule: session.module,
            sdp: data.sdp,
          });
          return;
        }
        const tripCheck = await getRideSafetyCallTrip(data.tripId, userId, data.targetUserId);
        if (!tripCheck.ok || !isCallSessionParticipant(session, userId, data.targetUserId)) {
          activeCallSessions.delete(data.tripId);
          socket.emit("call:ended", { by: "system", reason: tripCheck.message || "Call session ended." });
          return;
        }
        session.connectedAt = Date.now();
        io.to(`user:${data.targetUserId}`).emit("call:answer", {
          callerId: userId,
          tripId: data.tripId,
          callMode: "ride",
          sdp: data.sdp,
        });
        return;
      }

      if (userType === "admin" && userId !== session.callerId) {
        if (session.targetId !== SUPPORT_CALL_TARGET && session.targetId !== userId) {
          socket.emit("call:error", { message: "Another admin already joined this support call." });
          return;
        }
        session.targetId = userId;
      } else if (session.targetId !== userId && session.callerId !== userId) {
        socket.emit("call:error", { message: "You are not allowed to answer this support call." });
        return;
      }

      session.connectedAt = Date.now();
      const answerTarget = userId === session.callerId ? session.targetId : session.callerId;
      io.to(`user:${answerTarget}`).emit("call:answer", {
        callerId: userId,
        tripId: data.tripId,
        callMode: "support",
        sdp: data.sdp,
      });
    });

    socket.on("call:ice", async (data: { targetUserId: string; tripId: string; candidate: any; scope?: string; module?: string }) => {
      const session = activeCallSessions.get(data.tripId);
      if (!session) {
        socket.emit("call:error", { message: "Call session is no longer active." });
        return;
      }
      if (session.mode === "ride") {
        if (session.scope === "pool") {
          const poolCtx = await getPoolCommunicationContext(session.module, data.tripId, userId, data.targetUserId);
          if (!poolCtx.ok || !isCallSessionParticipant(session, userId, data.targetUserId) || !isPoolCallAllowed(poolCtx.status)) {
            activeCallSessions.delete(data.tripId);
            socket.emit("call:ended", { by: "system", reason: poolCtx.ok ? "Call session ended." : poolCtx.message, callScope: "pool", poolModule: session.module });
            return;
          }
          io.to(`user:${data.targetUserId}`).emit("call:ice", {
            from: userId,
            tripId: data.tripId,
            callMode: "ride",
            callScope: "pool",
            poolModule: session.module,
            candidate: data.candidate,
          });
          return;
        }
        const tripCheck = await getRideSafetyCallTrip(data.tripId, userId, data.targetUserId);
        if (!tripCheck.ok || !isCallSessionParticipant(session, userId, data.targetUserId)) {
          activeCallSessions.delete(data.tripId);
          socket.emit("call:ended", { by: "system", reason: tripCheck.message || "Call session ended." });
          return;
        }
        io.to(`user:${data.targetUserId}`).emit("call:ice", {
          from: userId,
          tripId: data.tripId,
          callMode: "ride",
          candidate: data.candidate,
        });
        return;
      }

      if (userId === session.callerId) {
        const supportTarget = session.targetId === SUPPORT_CALL_TARGET ? "admin:ops" : `user:${session.targetId}`;
        io.to(supportTarget).emit("call:ice", {
          from: userId,
          tripId: data.tripId,
          callMode: "support",
          candidate: data.candidate,
        });
        return;
      }

      const targetUserId = session.callerId;
      io.to(`user:${targetUserId}`).emit("call:ice", {
        from: userId,
        tripId: data.tripId,
        callMode: "support",
        candidate: data.candidate,
      });
    });

    socket.on("call:end", async (data: { targetUserId: string; tripId?: string; durationSec?: number }) => {
      const { targetUserId, tripId, durationSec } = data;
      const session = tripId ? activeCallSessions.get(tripId) : null;
      if (session) {
        if (session.mode === "support") {
          const supportTarget =
            session.targetId === SUPPORT_CALL_TARGET
              ? "admin:ops"
              : userId === session.callerId
                ? `user:${session.targetId}`
                : `user:${session.callerId}`;
          io.to(supportTarget).emit("call:ended", { by: userId, tripId, callMode: "support" });
        } else {
          io.to(`user:${targetUserId}`).emit("call:ended", {
            by: userId,
            tripId,
            callMode: "ride",
            callScope: session.scope || "trip",
            poolModule: session.module,
          });
        }
      } else {
        io.to(`user:${targetUserId}`).emit("call:ended", { by: userId, tripId });
      }
      if (tripId) {
        activeCallSessions.delete(tripId);
        if (session?.mode === "ride" && session.scope !== "pool") {
          await rawDb.execute(rawSql`
            UPDATE call_logs
            SET status='completed', ended_at=NOW(), duration_sec=${durationSec || 0}
            WHERE trip_id=${tripId}::uuid
              AND status='initiated'
              AND (
                (caller_id=${userId}::uuid AND receiver_id=${targetUserId}::uuid)
                OR
                (caller_id=${targetUserId}::uuid AND receiver_id=${userId}::uuid)
              )
          `).catch(() => {});
        }
      }
      console.log(`[CALL] Call ended by ${userId}${durationSec ? ` (${durationSec}s)` : ""}`);
    });

    socket.on("call:reject", async (data: { targetUserId: string; tripId?: string }) => {
      const { targetUserId, tripId } = data;
      const session = tripId ? activeCallSessions.get(tripId) : null;
      if (session?.mode === "support") {
        const rejectTarget =
          session.targetId === SUPPORT_CALL_TARGET
            ? `user:${session.callerId}`
            : userId === session.callerId
              ? `user:${session.targetId}`
              : `user:${session.callerId}`;
        io.to(rejectTarget).emit("call:rejected", { by: userId, tripId, callMode: "support" });
      } else {
        io.to(`user:${targetUserId}`).emit("call:rejected", {
          by: userId,
          tripId,
          callMode: "ride",
          callScope: session?.scope || "trip",
          poolModule: session?.module,
        });
      }
      if (tripId) {
        activeCallSessions.delete(tripId);
        if (session?.mode === "ride" && session.scope !== "pool") {
          await rawDb.execute(rawSql`
            UPDATE call_logs
            SET status='rejected', ended_at=NOW()
            WHERE trip_id=${tripId}::uuid
              AND status='initiated'
              AND (
                (caller_id=${userId}::uuid AND receiver_id=${targetUserId}::uuid)
                OR
                (caller_id=${targetUserId}::uuid AND receiver_id=${userId}::uuid)
              )
          `).catch(() => {});
        }
      }
    });

    socket.emit("socket:ready", { userId, userType });

    socket.on("disconnect", (reason) => {
      for (const session of findCallSessionForUser(userId)) {
        activeCallSessions.delete(session.sessionId);
        const peerRoom =
          session.mode === "support"
            ? session.targetId === SUPPORT_CALL_TARGET
              ? "admin:ops"
              : userId === session.callerId
                ? `user:${session.targetId}`
                : `user:${session.callerId}`
            : `user:${session.callerId === userId ? session.targetId : session.callerId}`;
        io.to(peerRoom).emit("call:ended", {
          by: userId,
          tripId: session.sessionId,
          callMode: session.mode,
          callScope: session.scope || "trip",
          poolModule: session.module,
          reason: "disconnect",
        });
      }
      if (userType === "driver") {
        removeSocketPresence("driver", userId, socket.id).catch(() => {});
        noteSocketDisconnected({ userId, userType: "driver", reason });
        // Grace period: don't mark offline immediately — reconnect within 90s keeps driver visible.
        // This prevents momentary network blips from removing driver from active dispatch.
        // If driver explicitly called driver:online with isOnline=false, that already updated DB directly.
        const timer = setTimeout(() => {
          pendingOfflineTimers.delete(userId);
          hasSocketPresence("driver", userId).then((hasPresence) => {
            if (hasPresence) {
              return;
            }
            noteSocketBecameInactive(userId);
            rawDb.execute(rawSql`
              UPDATE driver_locations SET is_online=false, updated_at=NOW()
              WHERE driver_id=${userId}::uuid
            `).catch(() => { });
            rawDb.execute(rawSql`
              UPDATE users SET is_online=false WHERE id=${userId}::uuid
            `).catch(() => { });
            console.log(`[SOCKET] Driver ${userId} offline (grace period expired, reason=${reason})`);
          }).catch(() => {});
        }, DRIVER_OFFLINE_GRACE_MS);
        pendingOfflineTimers.set(userId, timer);
        console.log(`[SOCKET] Driver ${userId} socket disconnected (reason=${reason}) — grace period started, not offline yet`);
      } else if (userType === "admin") {
        console.log(`[SOCKET] Admin ${userId} disconnected`);
      } else {
        removeSocketPresence("customer", userId, socket.id).catch(() => {});
        console.log(`[SOCKET] ${userType} ${userId} disconnected`);
      }
    });
  });

  console.log("[SOCKET] Socket.IO initialized");
  return io;
}

// ── Razorpay webhook: POST /api/app/razorpay/webhook ─────────────────────────
// When payment is verified and the trip was in payment_pending, set current_status = 'completed'.
// This must be implemented in routes.ts as an Express route that:
//   1. Validates the Razorpay webhook signature using RAZORPAY_WEBHOOK_SECRET
//   2. On event 'payment.captured': finds the trip by razorpay_order_id, checks current_status = 'payment_pending'
//   3. Updates trip: current_status = 'completed', completed_at = NOW(), payment_status = 'paid'
//   4. Emits trip:status_update { status: 'completed' } to the customer and driver via io
// ─────────────────────────────────────────────────────────────────────────────

// ── Notify nearby online drivers of a new searching trip ─────────────────────
export async function notifyNearbyDriversNewTrip(
  tripId: string,
  pickupLat: number,
  pickupLng: number,
  vehicleCategoryId?: string,
  excludeDriverIds: string[] = []
) {
  if (!io) return;
  try {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const safeIds = excludeDriverIds.filter((id) => uuidRe.test(id));

    const tripR = await rawDb.execute(rawSql`
      SELECT
        t.*,
        u.full_name as customer_name,
        vc.name as vehicle_name,
        vc.icon as vehicle_icon,
        COALESCE(vc.vehicle_type, '') as vehicle_type_field
      FROM trip_requests t
      JOIN users u ON u.id=t.customer_id
      LEFT JOIN vehicle_categories vc ON vc.id = t.vehicle_category_id
      WHERE t.id=${tripId}::uuid
    `);
    if (!tripR.rows.length) return;
    const trip = camelize(tripR.rows[0]) as any;
    const requirements = await resolveDispatchRequirementsFromTrip(tripId);
    if (!requirements) return;
    const strictDrivers = await findEligibleDriversForDispatch({
      pickupLat,
      pickupLng,
      radiusKm: 8,
      excludeDriverIds: safeIds,
      limit: 10,
      requirements,
    });

    // Get driver FCM tokens for background push
    const driverIds = strictDrivers.map((r: any) => r.driverId);
    let fcmMap: Record<string, string> = {};
    if (driverIds.length > 0) {
      const devRes = await rawDb.execute(rawSql`
        SELECT user_id, fcm_token FROM user_devices
        WHERE user_id = ANY(${driverIds}::uuid[]) AND fcm_token IS NOT NULL
      `);
      for (const r of devRes.rows) {
        fcmMap[(r as any).user_id] = (r as any).fcm_token;
      }
    }

    for (const row of strictDrivers) {
      const driverId = (row as any).driverId;
      const payload = {
        tripId,
        refId: trip.refId,
        customerName: trip.customerName,
        pickupAddress: trip.pickupAddress,
        destinationAddress: trip.destinationAddress,
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        estimatedFare: trip.estimatedFare,
        estimatedDistance: trip.estimatedDistance,
        paymentMethod: trip.paymentMethod,
        tripType: trip.tripType,
        vehicleCategoryName: trip.vehicleName || trip.vehicleTypeName || null,
        vehicleIcon: trip.vehicleIcon || null,
        vehicleType: trip.vehicleTypeField || null,
      };
      // Socket (foreground) + FCM (background)
      io.to(`user:${driverId}`).emit("trip:new_request", payload);
      const fcmToken = fcmMap[driverId];
      if (fcmToken) {
        notifyDriverNewRide({
          fcmToken,
          driverName: '',
          customerName: trip.customerName,
          pickupAddress: trip.pickupAddress,
          estimatedFare: trip.estimatedFare,
          tripId,
        }).catch(() => { });
      }
    }
    console.log(`[SOCKET] New trip ${tripId} notified to ${strictDrivers.length} nearby drivers`);
  } catch (e: any) {
    console.error("[SOCKET] notifyNearbyDriversNewTrip error:", e.message);
  }
}

// ── When driver comes online, check for searching trips nearby ────────────────
async function notifyDriverNearbyTrips(driverId: string, lat: number, lng: number) {
  if (!io) return;
  try {
    const activelyOffered = getCurrentOfferedTripForDriver(driverId);
    if (activelyOffered) {
      io.to(`user:${driverId}`).emit("trip:new_request", activelyOffered.trip);
      return;
    }
    const trips = await rawDb.execute(rawSql`
      SELECT
        t.*,
        u.full_name as customer_name,
        vc.name as vehicle_name,
        vc.icon as vehicle_icon,
        COALESCE(vc.vehicle_type, '') as vehicle_type_field
      FROM trip_requests t
      JOIN users u ON u.id=t.customer_id
      LEFT JOIN vehicle_categories vc ON vc.id = t.vehicle_category_id
      WHERE t.current_status='searching'
        AND t.driver_id IS NULL
        AND NOT (${driverId}::uuid = ANY(COALESCE(t.rejected_driver_ids, '{}'::uuid[])))
        AND ((t.pickup_lat - ${lat})*(t.pickup_lat - ${lat}) + (t.pickup_lng - ${lng})*(t.pickup_lng - ${lng})) < 0.06
      ORDER BY t.created_at DESC
      LIMIT 8
    `);
    for (const row of trips.rows) {
      const trip = camelize(row) as any;
      if (hasActiveDispatch(trip.id)) continue;
      const requirements = await resolveDispatchRequirementsFromTrip(trip.id);
      if (!requirements) continue;
      const eligibility = await isDriverEligibleForDispatch(driverId, requirements);
      if (!eligibility.eligible) continue;
      io.to(`user:${driverId}`).emit("trip:new_request", {
        tripId: trip.id,
        refId: trip.refId,
        customerName: trip.customerName,
        pickupAddress: trip.pickupAddress,
        destinationAddress: trip.destinationAddress,
        pickupLat: trip.pickupLat,
        pickupLng: trip.pickupLng,
        estimatedFare: trip.estimatedFare,
        estimatedDistance: trip.estimatedDistance,
        paymentMethod: trip.paymentMethod,
        vehicleCategoryName: trip.vehicleName || trip.vehicleTypeName || null,
        vehicleIcon: trip.vehicleIcon || null,
        vehicleType: trip.vehicleTypeField || null,
      });
    }
  } catch (e: any) {
    console.error("[SOCKET] notifyDriverNearbyTrips error:", e.message);
  }
}
