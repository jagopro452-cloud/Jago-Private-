import { sql } from "drizzle-orm";
import { rawDb } from "./db";

export const RIDE_STATE_GRAPH: Record<string, string[]> = {
  scheduled: ["searching", "cancelled"],
  searching: ["driver_assigned", "cancelled"],
  driver_assigned: ["accepted", "searching", "cancelled"],
  accepted: ["arrived", "searching", "cancelled"],
  arrived: ["on_the_way", "searching", "cancelled"],
  on_the_way: ["payment_pending", "completed", "cancelled"],
  payment_pending: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const CANONICAL_RIDE_STATUS: Record<string, string> = {
  scheduled: "SCHEDULED",
  searching: "REQUESTED",
  driver_assigned: "DRIVER_ASSIGNED",
  accepted: "ACCEPTED",
  arrived: "STARTED",
  on_the_way: "IN_PROGRESS",
  payment_pending: "PAYMENT_PENDING",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
};

type SqlChunk = ReturnType<typeof sql>;

interface RideSnapshot {
  id: string;
  current_status: string;
  version: number;
  driver_id: string | null;
  customer_id: string | null;
}

interface TransitionOptions {
  driverId?: string | null;
  customerId?: string | null;
  actorId?: string | null;
  actorType?: string;
  event?: string;
  data?: Record<string, unknown>;
  extraSetters?: SqlChunk[];
}

export interface RideActorMeta {
  actorId?: string | null;
  actorType?: string;
  driverId?: string | null;
  customerId?: string | null;
  reason?: string;
  data?: Record<string, unknown>;
  extraSetters?: SqlChunk[];
}

function canonicalStatusFor(currentStatus: string): string {
  return CANONICAL_RIDE_STATUS[currentStatus] || currentStatus.toUpperCase();
}

function isAllowedTransition(currentStatus: string, nextStatus: string): boolean {
  return (RIDE_STATE_GRAPH[currentStatus] || []).includes(nextStatus);
}

async function getRideSnapshot(rideId: string): Promise<RideSnapshot | null> {
  const result = await rawDb.execute(sql`
    SELECT id, current_status, COALESCE(version, 0) AS version, driver_id, customer_id
    FROM trip_requests
    WHERE id=${rideId}::uuid
    LIMIT 1
  `);
  return (result.rows[0] as unknown as RideSnapshot | undefined) || null;
}

export async function logRideEvent(
  rideId: string,
  event: string,
  data: Record<string, unknown> = {},
  actorId?: string | null,
  actorType = "system",
): Promise<void> {
  await rawDb.execute(sql`
    INSERT INTO ride_events (ride_id, trip_id, event, event_type, data, meta, actor_id, actor_type)
    VALUES (
      ${rideId}::uuid,
      ${rideId}::uuid,
      ${event},
      ${event},
      ${JSON.stringify(data)}::jsonb,
      ${JSON.stringify(data)}::jsonb,
      ${actorId || null}::uuid,
      ${actorType}
    )
  `);
}

export async function transitionRideState(
  rideId: string,
  nextStatus: string,
  options: TransitionOptions = {},
): Promise<any> {
  const snapshot = await getRideSnapshot(rideId);
  if (!snapshot) {
    throw new Error("Ride not found");
  }

  if (!isAllowedTransition(snapshot.current_status, nextStatus)) {
    throw new Error(`Invalid state transition: ${snapshot.current_status} -> ${nextStatus}`);
  }
  if (options.driverId !== undefined && snapshot.driver_id !== options.driverId) {
    throw new Error("Ride is not assigned to this driver");
  }
  if (options.customerId !== undefined && snapshot.customer_id !== options.customerId) {
    throw new Error("Ride does not belong to this customer");
  }

  const setters: SqlChunk[] = [
    sql`current_status=${nextStatus}`,
    sql`status=${canonicalStatusFor(nextStatus)}`,
    sql`version=COALESCE(version, 0) + 1`,
    sql`updated_at=NOW()`,
  ];

  if (nextStatus === "driver_assigned") setters.push(sql`assigned_at=COALESCE(assigned_at, NOW())`);
  if (nextStatus === "accepted") setters.push(sql`accepted_at=COALESCE(accepted_at, NOW())`);
  if (nextStatus === "arrived") setters.push(sql`started_at=COALESCE(started_at, NOW())`);
  if (nextStatus === "on_the_way") setters.push(sql`ride_started_at=COALESCE(ride_started_at, NOW())`, sql`started_at=COALESCE(started_at, NOW())`);
  if (nextStatus === "completed") setters.push(sql`ride_ended_at=COALESCE(ride_ended_at, NOW())`, sql`completed_at=COALESCE(completed_at, NOW())`);
  if (nextStatus === "cancelled") setters.push(sql`cancelled_at=COALESCE(cancelled_at, NOW())`);
  if (options.extraSetters?.length) setters.push(...options.extraSetters);

  const updated = await rawDb.execute(sql`
    UPDATE trip_requests
    SET ${sql.join(setters, sql`, `)}
    WHERE id=${rideId}::uuid
      AND current_status=${snapshot.current_status}
      AND COALESCE(version, 0)=${snapshot.version}
      ${options.driverId !== undefined ? sql`AND driver_id=${options.driverId}::uuid` : sql``}
      ${options.customerId !== undefined ? sql`AND customer_id=${options.customerId}::uuid` : sql``}
    RETURNING *
  `);

  if (!updated.rows.length) {
    throw new Error("Ride update conflict. Please retry.");
  }

  if (options.event) {
    await logRideEvent(
      rideId,
      options.event,
      {
        previousStatus: snapshot.current_status,
        nextStatus,
        ...(options.data || {}),
      },
      options.actorId,
      options.actorType || "system",
    );
  }

  return updated.rows[0];
}

export async function assignRideToDriver(
  rideId: string,
  driverId: string,
  data: Record<string, unknown> = {},
): Promise<any | null> {
  const snapshot = await getRideSnapshot(rideId);
  if (!snapshot) return null;
  if (snapshot.current_status !== "searching") return null;

  let updated;
  try {
    updated = await rawDb.execute(sql`
      UPDATE trip_requests
      SET driver_id=${driverId}::uuid,
          current_status='driver_assigned',
          status='DRIVER_ASSIGNED',
          assigned_at=COALESCE(assigned_at, NOW()),
          version=COALESCE(version, 0) + 1,
          updated_at=NOW()
      WHERE id=${rideId}::uuid
        AND current_status='searching'
        AND COALESCE(version, 0)=${snapshot.version}
        AND (driver_id IS NULL OR driver_id=${driverId}::uuid)
      RETURNING *
    `);
  } catch (error: any) {
    if (error?.code === "23505") return null;
    throw error;
  }

  if (!updated.rows.length) return null;

  await logRideEvent(rideId, "DRIVER_ASSIGNED", data, driverId, "driver");
  return updated.rows[0];
}

export async function assignDriver(
  rideId: string,
  driverId: string,
  data: Record<string, unknown> = {},
): Promise<any | null> {
  return assignRideToDriver(rideId, driverId, data);
}

export async function resetRideForRedispatch(
  rideId: string,
  options: {
    actorId?: string | null;
    actorType?: string;
    reason?: string;
    rejectedDriverId?: string | null;
    clearPickupOtp?: boolean;
  } = {},
): Promise<any | null> {
  const snapshot = await getRideSnapshot(rideId);
  if (!snapshot) return null;
  if (!["driver_assigned", "accepted", "arrived", "searching"].includes(snapshot.current_status)) {
    return null;
  }

  const setters: SqlChunk[] = [
    sql`current_status='searching'`,
    sql`status='REQUESTED'`,
    sql`driver_id=NULL`,
    sql`version=COALESCE(version, 0) + 1`,
    sql`updated_at=NOW()`,
    sql`assigned_at=NULL`,
    sql`accepted_at=NULL`,
    sql`started_at=NULL`,
    sql`driver_accepted_at=NULL`,
    sql`driver_arriving_at=NULL`,
  ];
  if (options.clearPickupOtp !== false) setters.push(sql`pickup_otp=NULL`);
  if (options.reason) setters.push(sql`cancel_reason=${options.reason}`);
  if (options.rejectedDriverId) {
    setters.push(sql`rejected_driver_ids = array_append(COALESCE(rejected_driver_ids,'{}'::uuid[]), ${options.rejectedDriverId}::uuid)`);
  }

  const updated = await rawDb.execute(sql`
    UPDATE trip_requests
    SET ${sql.join(setters, sql`, `)}
    WHERE id=${rideId}::uuid
      AND current_status=${snapshot.current_status}
      AND COALESCE(version, 0)=${snapshot.version}
    RETURNING *
  `);

  if (!updated.rows.length) return null;

  await logRideEvent(
    rideId,
    "REASSIGN",
    {
      previousStatus: snapshot.current_status,
      reason: options.reason || "redispatch",
      rejectedDriverId: options.rejectedDriverId || null,
    },
    options.actorId,
    options.actorType || "system",
  );
  return updated.rows[0];
}

export async function reassignRide(
  rideId: string,
  meta: RideActorMeta = {},
): Promise<any | null> {
  return resetRideForRedispatch(rideId, {
    actorId: meta.actorId,
    actorType: meta.actorType,
    reason: meta.reason,
    rejectedDriverId: meta.driverId || null,
  });
}

export async function cancelRideState(
  rideId: string,
  reason: string,
  options: {
    actorId?: string | null;
    actorType?: string;
    customerId?: string | null;
    driverId?: string | null;
    cancelledBy?: string;
    allowedStatuses?: string[];
  } = {},
): Promise<any | null> {
  const snapshot = await getRideSnapshot(rideId);
  if (!snapshot) return null;
  if (options.allowedStatuses?.length && !options.allowedStatuses.includes(snapshot.current_status)) {
    return null;
  }

  const updated = await rawDb.execute(sql`
    UPDATE trip_requests
    SET current_status='cancelled',
        status='CANCELLED',
        cancel_reason=${reason},
        cancelled_by=${options.cancelledBy || options.actorType || "system"},
        cancelled_at=COALESCE(cancelled_at, NOW()),
        version=COALESCE(version, 0) + 1,
        updated_at=NOW()
    WHERE id=${rideId}::uuid
      AND current_status=${snapshot.current_status}
      AND COALESCE(version, 0)=${snapshot.version}
      ${options.customerId !== undefined ? sql`AND customer_id=${options.customerId}::uuid` : sql``}
      ${options.driverId !== undefined ? sql`AND driver_id=${options.driverId}::uuid` : sql``}
    RETURNING *
  `);

  if (!updated.rows.length) return null;

  await logRideEvent(
    rideId,
    "CANCELLED",
    {
      previousStatus: snapshot.current_status,
      reason,
      cancelledBy: options.cancelledBy || options.actorType || "system",
    },
    options.actorId,
    options.actorType || "system",
  );
  return updated.rows[0];
}

export async function acceptRide(rideId: string, meta: RideActorMeta = {}): Promise<any> {
  return transitionRideState(rideId, "accepted", {
    driverId: meta.driverId || undefined,
    customerId: meta.customerId || undefined,
    actorId: meta.actorId,
    actorType: meta.actorType || "system",
    event: "ACCEPTED",
    data: meta.data || {},
    extraSetters: meta.extraSetters || [],
  });
}

export async function startRide(rideId: string, meta: RideActorMeta = {}): Promise<any> {
  return transitionRideState(rideId, "on_the_way", {
    driverId: meta.driverId || undefined,
    actorId: meta.actorId,
    actorType: meta.actorType || "system",
    event: "STARTED",
    data: meta.data || {},
    extraSetters: meta.extraSetters || [],
  });
}

export async function completeRide(rideId: string, meta: RideActorMeta = {}): Promise<any> {
  return transitionRideState(rideId, "completed", {
    driverId: meta.driverId || undefined,
    actorId: meta.actorId,
    actorType: meta.actorType || "system",
    event: "COMPLETED",
    data: meta.data || {},
    extraSetters: meta.extraSetters || [],
  });
}

export async function cancelRide(rideId: string, meta: RideActorMeta = {}): Promise<any | null> {
  return cancelRideState(rideId, meta.reason || "Ride cancelled", {
    actorId: meta.actorId,
    actorType: meta.actorType || "system",
    customerId: meta.customerId || undefined,
    driverId: meta.driverId || undefined,
    cancelledBy: meta.actorType || "system",
  });
}
