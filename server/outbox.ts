import type { Server as SocketIOServer } from "socket.io";
import { pool, db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { notifyCustomerTripCompleted } from "./fcm";

type TripCompletedPayload = {
  tripId: string;
  customerId: string | null;
  currentStatus: string;
  fare: number;
  actualFare: number;
  userDiscount: number;
  userPayable: number;
  gstAmount: number;
  driverWalletCredit: number;
  actualDistance: number;
  paymentMethod: string;
  platformDeduction: number;
  launchOfferApplied: boolean;
  walletPaidAmount: number;
  walletPendingAmount: number;
  requiresCashPayment: boolean;
  uiState: string;
};

let processorStarted = false;

async function deliverTripCompleted(io: SocketIOServer | undefined, payload: TripCompletedPayload) {
  if (!payload.customerId) return;

  const socketPayload = {
    tripId: payload.tripId,
    status: payload.currentStatus,
    currentStatus: payload.currentStatus,
    fare: payload.fare,
    actualFare: payload.actualFare,
    userDiscount: payload.userDiscount,
    userPayable: payload.userPayable,
    gstAmount: payload.gstAmount,
    driverWalletCredit: payload.driverWalletCredit,
    actualDistance: payload.actualDistance,
    paymentMethod: payload.paymentMethod,
    platformDeduction: payload.platformDeduction,
    launchOfferApplied: payload.launchOfferApplied,
    uiState: payload.uiState,
    walletPaidAmount: payload.walletPaidAmount,
    walletPendingAmount: payload.walletPendingAmount,
    requiresCashPayment: payload.requiresCashPayment,
  };

  if (io) {
    io.to(`user:${payload.customerId}`).emit("trip:status_update", socketPayload);
    io.to(`trip:${payload.tripId}`).emit("trip:status_update", socketPayload);
    io.to(`user:${payload.customerId}`).emit("trip:completed", socketPayload);
    io.to(`trip:${payload.tripId}`).emit("trip:completed", socketPayload);
  }

  const tokenRes = await rawDb.execute(rawSql`
    SELECT fcm_token
    FROM user_devices
    WHERE user_id=${payload.customerId}::uuid
      AND fcm_token IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const fcmToken = (tokenRes.rows[0] as any)?.fcm_token || null;
  if (fcmToken) {
    await notifyCustomerTripCompleted({
      fcmToken,
      fare: payload.actualFare,
      tripId: payload.tripId,
    }).catch(() => undefined);
  }
}

export async function processOutboxBatch(
  io: SocketIOServer | undefined,
  batchSize = 20,
): Promise<number> {
  const client = await pool.connect();
  try {
    const claimRes = await client.query(
      `
      WITH picked AS (
        SELECT id
        FROM outbox_events
        WHERE processed = false
          AND COALESCE(processing, false) = false
          AND COALESCE(failed, false) = false
          AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_events oe
      SET processing = true,
          processing_started_at = NOW(),
          attempts = COALESCE(oe.attempts, 0) + 1
      FROM picked
      WHERE oe.id = picked.id
      RETURNING oe.id, oe.type, oe.payload
      `,
      [batchSize],
    );

    for (const row of claimRes.rows) {
      try {
        if (row.type === "TRIP_COMPLETED") {
          await deliverTripCompleted(io, row.payload as TripCompletedPayload);
        }
        await client.query(
          `
          UPDATE outbox_events
          SET processed = true,
              processed_at = NOW(),
              processing = false,
              next_attempt_at = NULL
          WHERE id = $1::uuid
          `,
          [row.id],
        );
      } catch (error: any) {
        await client.query(
          `
          UPDATE outbox_events
          SET processing = false,
              failed = attempts >= 3,
              next_attempt_at = CASE
                WHEN attempts >= 3 THEN NULL
                ELSE NOW() + INTERVAL '30 seconds'
              END,
              last_error = $2
          WHERE id = $1::uuid
          `,
          [row.id, String(error?.message || error || "outbox_delivery_failed").slice(0, 500)],
        ).catch(() => undefined);
      }
    }

    return claimRes.rows.length;
  } finally {
    client.release();
  }
}

export function startOutboxProcessor(io: SocketIOServer | undefined) {
  if (processorStarted) return;
  processorStarted = true;

  const run = () => {
    processOutboxBatch(io).catch((error) => {
      console.error("[OUTBOX] processor error:", error?.message || error);
    });
  };

  const handle = setInterval(run, 5000);
  (handle as any).unref?.();
  setTimeout(run, 1500);
}
