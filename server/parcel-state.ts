import { sql } from "drizzle-orm";
import { rawDb } from "./db";
import { io } from "./socket";
import { emitParcelLifecycle } from "./parcel-advanced";

const PARCEL_STATE_GRAPH: Record<string, string[]> = {
  pending: ["searching", "cancelled"],
  searching: ["driver_assigned", "cancelled"],
  driver_assigned: ["in_transit", "searching", "cancelled"],
  in_transit: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const CANONICAL_PARCEL_STATUS: Record<string, string> = {
  pending: "PENDING",
  searching: "SEARCHING",
  driver_assigned: "DRIVER_ASSIGNED",
  in_transit: "IN_TRANSIT",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
};

type SqlChunk = ReturnType<typeof sql>;

interface ParcelSnapshot {
  id: string;
  current_status: string;
  version: number;
  driver_id: string | null;
  customer_id: string | null;
}

export interface ParcelActorMeta {
  actorId?: string | null;
  actorType?: string;
  driverId?: string | null;
  customerId?: string | null;
  reason?: string;
  data?: Record<string, unknown>;
  extraSetters?: SqlChunk[];
}

function canonicalStatus(status: string): string {
  return CANONICAL_PARCEL_STATUS[status] || status.toUpperCase();
}

const ONLINE_PARCEL_PAYMENT_METHODS = new Set([
  "upi", "online", "razorpay", "wallet", "card", "b2b_wallet",
]);

export function initialParcelPaymentStatus(paymentMethod?: string): string {
  const method = String(paymentMethod || "cash").toLowerCase();
  if (method === "b2b_wallet") return "paid";
  if (ONLINE_PARCEL_PAYMENT_METHODS.has(method)) return "paid_online";
  return "unpaid";
}

export function settledParcelPaymentStatus(paymentMethod?: string, current?: string): string {
  const method = String(paymentMethod || "cash").toLowerCase();
  const existing = String(current || "").toLowerCase();
  if (["paid", "paid_online", "wallet_paid", "partial_payment"].includes(existing)) {
    return existing;
  }
  if (ONLINE_PARCEL_PAYMENT_METHODS.has(method)) return "paid";
  return "paid";
}

async function getParcelSnapshot(orderId: string): Promise<ParcelSnapshot | null> {
  const result = await rawDb.execute(sql`
    SELECT id, current_status, COALESCE(version, 0) AS version, driver_id, customer_id
    FROM parcel_orders
    WHERE id=${orderId}::uuid
    LIMIT 1
  `);
  return (result.rows[0] as unknown as ParcelSnapshot | undefined) || null;
}

function canTransition(currentStatus: string, nextStatus: string): boolean {
  if (currentStatus === nextStatus) return true;
  return (PARCEL_STATE_GRAPH[currentStatus] || []).includes(nextStatus);
}

async function emitParcelState(order: any, event: string, extra: Record<string, unknown> = {}): Promise<void> {
  const orderId = String(order.id);
  const customerId = order.customer_id ? String(order.customer_id) : "";
  const driverId = order.driver_id ? String(order.driver_id) : null;
  emitParcelLifecycle(orderId, customerId, driverId, event as any, extra);

  if (!io || !customerId) return;
  if (event === "driver_assigned") {
    io.to(`user:${customerId}`).emit("parcel:driver_assigned", { orderId, driverId, ...extra });
  } else if (event === "in_transit") {
    io.to(`user:${customerId}`).emit("parcel:in_transit", { orderId, ...extra });
  } else if (event === "completed") {
    io.to(`user:${customerId}`).emit("parcel:completed", { orderId, ...extra });
  } else if (event === "cancelled") {
    io.to(`user:${customerId}`).emit("parcel:cancelled", { orderId, ...extra });
    if (driverId) {
      io.to(`user:${driverId}`).emit("parcel:cancelled", { orderId, ...extra });
    }
  }
}

export async function logParcelEvent(
  orderId: string,
  event: string,
  data: Record<string, unknown> = {},
  actorId?: string | null,
  actorType = "system",
): Promise<void> {
  await rawDb.execute(sql`
    INSERT INTO parcel_events (parcel_order_id, event, data, actor_id, actor_type)
    VALUES (
      ${orderId}::uuid,
      ${event},
      ${JSON.stringify(data)}::jsonb,
      ${actorId || null}::uuid,
      ${actorType}
    )
  `);
}

export async function transitionParcelState(
  orderId: string,
  nextStatus: string,
  meta: ParcelActorMeta = {},
): Promise<any> {
  const snapshot = await getParcelSnapshot(orderId);
  if (!snapshot) throw new Error("Parcel order not found");
  if (!canTransition(snapshot.current_status, nextStatus)) {
    throw new Error(`Invalid parcel transition: ${snapshot.current_status} -> ${nextStatus}`);
  }
  if (meta.driverId !== undefined && snapshot.driver_id !== meta.driverId) {
    throw new Error("Parcel order is not assigned to this driver");
  }
  if (meta.customerId !== undefined && snapshot.customer_id !== meta.customerId) {
    throw new Error("Parcel order does not belong to this customer");
  }

  const setters: SqlChunk[] = [
    sql`current_status=${nextStatus}`,
    sql`status=${canonicalStatus(nextStatus)}`,
    sql`version=COALESCE(version, 0) + 1`,
    sql`updated_at=NOW()`,
  ];
  if (nextStatus === "driver_assigned") setters.push(sql`assigned_at=COALESCE(assigned_at, NOW())`);
  if (nextStatus === "in_transit") setters.push(sql`picked_up_at=COALESCE(picked_up_at, NOW())`);
  if (nextStatus === "completed") setters.push(sql`completed_at=COALESCE(completed_at, NOW())`);
  if (nextStatus === "cancelled") setters.push(sql`cancelled_at=COALESCE(cancelled_at, NOW())`);
  if (meta.extraSetters?.length) setters.push(...meta.extraSetters);

  const updated = await rawDb.execute(sql`
    UPDATE parcel_orders
    SET ${sql.join(setters, sql`, `)}
    WHERE id=${orderId}::uuid
      AND current_status=${snapshot.current_status}
      AND COALESCE(version, 0)=${snapshot.version}
      ${meta.driverId !== undefined ? sql`AND driver_id=${meta.driverId}::uuid` : sql``}
      ${meta.customerId !== undefined ? sql`AND customer_id=${meta.customerId}::uuid` : sql``}
    RETURNING *
  `);
  if (!updated.rows.length) throw new Error("Parcel order update conflict. Please retry.");

  const row = updated.rows[0] as any;
  await logParcelEvent(
    orderId,
    nextStatus.toUpperCase(),
    {
      previousStatus: snapshot.current_status,
      nextStatus,
      ...(meta.data || {}),
    },
    meta.actorId,
    meta.actorType || "system",
  );
  await emitParcelState(row, nextStatus, meta.data || {});
  return row;
}

export async function assignParcelDriver(orderId: string, driverId: string, data: Record<string, unknown> = {}): Promise<any | null> {
  const snapshot = await getParcelSnapshot(orderId);
  if (!snapshot) return null;
  if (snapshot.current_status !== "searching") return null;

  const updated = await rawDb.execute(sql`
    UPDATE parcel_orders
    SET driver_id=${driverId}::uuid,
        current_status='driver_assigned',
        status='DRIVER_ASSIGNED',
        assigned_at=COALESCE(assigned_at, NOW()),
        version=COALESCE(version, 0) + 1,
        updated_at=NOW()
    WHERE id=${orderId}::uuid
      AND current_status='searching'
      AND COALESCE(version, 0)=${snapshot.version}
      AND driver_id IS NULL
    RETURNING *
  `);
  if (!updated.rows.length) return null;
  const row = updated.rows[0] as any;
  await logParcelEvent(orderId, "DRIVER_ASSIGNED", data, driverId, "driver");
  await emitParcelState(row, "driver_assigned", data);
  return row;
}

export async function cancelParcel(orderId: string, meta: ParcelActorMeta = {}): Promise<any | null> {
  const snapshot = await getParcelSnapshot(orderId);
  if (!snapshot) return null;
  if (!canTransition(snapshot.current_status, "cancelled")) return null;

  const updated = await rawDb.execute(sql`
    UPDATE parcel_orders
    SET current_status='cancelled',
        status='CANCELLED',
        cancelled_reason=${meta.reason || "Parcel cancelled"},
        cancelled_at=COALESCE(cancelled_at, NOW()),
        version=COALESCE(version, 0) + 1,
        updated_at=NOW()
    WHERE id=${orderId}::uuid
      AND current_status=${snapshot.current_status}
      AND COALESCE(version, 0)=${snapshot.version}
      ${meta.customerId !== undefined ? sql`AND customer_id=${meta.customerId}::uuid` : sql``}
      ${meta.driverId !== undefined ? sql`AND driver_id=${meta.driverId}::uuid` : sql``}
    RETURNING *
  `);
  if (!updated.rows.length) return null;
  const row = updated.rows[0] as any;
  await logParcelEvent(orderId, "CANCELLED", {
    previousStatus: snapshot.current_status,
    reason: meta.reason || "Parcel cancelled",
  }, meta.actorId, meta.actorType || "system");
  await emitParcelState(row, "cancelled", { reason: meta.reason || "Parcel cancelled" });
  return row;
}

export async function startParcel(orderId: string, meta: ParcelActorMeta = {}): Promise<any> {
  return transitionParcelState(orderId, "in_transit", meta);
}

export async function completeParcel(orderId: string, meta: ParcelActorMeta = {}): Promise<any> {
  return transitionParcelState(orderId, "completed", meta);
}
