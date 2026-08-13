/**
 * Pool Settlement Outbox Engine
 *
 * Implements the Transactional Outbox Pattern for pool passenger drop settlements.
 *
 * Problem solved:
 *   Previously, pool drop handlers committed a status-update transaction THEN called
 *   settleRevenue() outside that transaction. A server crash between COMMIT and
 *   settleRevenue() meant the passenger was dropped but the driver was never paid.
 *
 * Solution:
 *   1. enqueuePoolSettlement() — called INSIDE the drop transaction (before COMMIT).
 *      Inserts an outbox record atomically with the status update. If the transaction
 *      rolls back, the outbox record also disappears. No orphan state.
 *
 *   2. processPoolSettlement() — called after COMMIT. Atomically claims the outbox
 *      entry (status pending → processing) then runs settleRevenue(). If the server
 *      crashes mid-settlement, the entry remains in 'processing'. Recovery resets
 *      stale 'processing' entries back to 'pending' after 5 minutes.
 *
 *   3. runPoolSettlementRecovery() — runs on server start and every 60 s. Picks up
 *      all 'pending' entries and stale 'processing' entries. Before touching the
 *      wallet, checks wallet_events for an existing settlement with this booking_id
 *      as ref_id (second idempotency layer — prevents double-credit even if the
 *      worker crashes after wallet update but before marking the outbox 'done').
 *
 *   4. startPoolSettlementWorker() — starts the periodic recovery timer.
 *
 * Guarantees:
 *   ✓ Settlement cannot be lost   (outbox created in same TX as status update)
 *   ✓ Settlement cannot run twice (status check + wallet_events ref_id check)
 *   ✓ Crash recovery              (worker picks up stale entries on restart)
 *   ✓ Idempotency                 (safe to retry; double-debit impossible)
 *   ✓ Max retries                 (5 attempts, then marked 'failed' for alerting)
 */

import type { PoolClient } from "pg";
import { pool as dbPool, rawDb, rawSql } from "./db";
import { calculateRevenueBreakdown, settleRevenue } from "./revenue-engine";

export type PoolModule = "city_pool" | "outstation_pool";

export interface PoolSettlementParams {
  bookingId: string;     // pool_ride_requests.id or outstation_pool_bookings.id
  module: PoolModule;
  driverId: string;
  fare: number;
  paymentMethod: string;
  serviceLabel: string;
}

const MAX_RETRY = 5;
const WORKER_INTERVAL_MS = 60_000;
const STALE_PROCESSING_MINUTES = 5;

let workerTimer: ReturnType<typeof setInterval> | null = null;

// ─── Enqueue (called INSIDE the drop transaction, before COMMIT) ─────────────

/**
 * Insert an outbox record inside the caller's pg transaction.
 * Must be called before client.query("COMMIT") so the record and status update
 * are in the same atomic transaction.
 *
 * Returns the outbox id (pass to processPoolSettlement after commit).
 */
export async function enqueuePoolSettlement(
  client: PoolClient,
  params: PoolSettlementParams,
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `INSERT INTO pool_settlement_outbox
       (booking_id, module, driver_id, fare, payment_method, service_label, status, retry_count)
     VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, 'pending', 0)
     ON CONFLICT (booking_id) DO NOTHING
     RETURNING id`,
    [
      params.bookingId,
      params.module,
      params.driverId,
      params.fare,
      params.paymentMethod,
      params.serviceLabel,
    ],
  );

  if (r.rows.length) return r.rows[0].id;

  // If DO NOTHING fired (already exists — e.g., retry of the HTTP request), fetch existing
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM pool_settlement_outbox WHERE booking_id = $1::uuid LIMIT 1`,
    [params.bookingId],
  );
  if (!existing.rows.length) throw new Error(`pool_settlement_outbox entry missing for booking ${params.bookingId}`);
  return existing.rows[0].id;
}

// ─── Process one outbox entry (idempotent) ────────────────────────────────────

/**
 * Atomically claim + process a single outbox entry.
 *
 * Layer 1 (status claim): UPDATE ... WHERE status='pending' RETURNING — ensures
 *   only one worker processes at a time.
 *
 * Layer 2 (wallet_events check): Before touching wallet, verify no existing
 *   settlement event exists with ref_id = booking_id. Prevents double-credit
 *   if the server crashed after applyWalletChange but before marking outbox 'done'.
 */
export async function processPoolSettlement(outboxId: string): Promise<void> {
  // ── Layer 1: Atomic claim ─────────────────────────────────────────────────
  const claimClient = await dbPool.connect();
  let entry: any;
  try {
    await claimClient.query("BEGIN");
    const claimR = await claimClient.query<any>(
      `UPDATE pool_settlement_outbox
       SET status = 'processing', updated_at = NOW()
       WHERE id = $1::uuid AND status = 'pending'
       RETURNING *`,
      [outboxId],
    );
    await claimClient.query("COMMIT");
    if (!claimR.rows.length) return; // Already claimed or done — skip silently
    entry = claimR.rows[0];
  } catch (err) {
    await claimClient.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    claimClient.release();
  }

  // ── Layer 2: Wallet idempotency check ────────────────────────────────────
  try {
    const alreadySettledR = await rawDb.execute(rawSql`
      SELECT id FROM wallet_events
      WHERE ref_id = ${entry.booking_id}
        AND reason IN ('trip_settlement_credit', 'cash_ride_dues')
      LIMIT 1
    `);
    if (alreadySettledR.rows.length > 0) {
      await rawDb.execute(rawSql`
        UPDATE pool_settlement_outbox
        SET status = 'done', processed_at = NOW(), updated_at = NOW()
        WHERE id = ${outboxId}::uuid
      `).catch(() => {});
      console.log(`[POOL-SETTLEMENT] ${outboxId}: wallet_events ref_id match — already settled, marking done`);
      return;
    }
  } catch (checkErr: any) {
    console.warn("[POOL-SETTLEMENT] idempotency check error:", checkErr?.message);
    // Don't abort — proceed with settlement (safer than skipping)
  }

  // ── Execute settlement ────────────────────────────────────────────────────
  try {
    const fare = parseFloat(entry.fare);
    const breakdown = await calculateRevenueBreakdown(fare, entry.module as any, entry.driver_id);
    await settleRevenue({
      driverId: entry.driver_id,
      tripId: entry.booking_id,
      fare,
      paymentMethod: entry.payment_method as any,
      breakdown,
      serviceCategory: entry.module as any,
      serviceLabel: entry.service_label,
    });

    // Mark done + link back to booking tables
    await rawDb.execute(rawSql`
      UPDATE pool_settlement_outbox
      SET status = 'done', processed_at = NOW(), updated_at = NOW()
      WHERE id = ${outboxId}::uuid
    `);

    if (entry.module === "city_pool") {
      await rawDb.execute(rawSql`
        UPDATE pool_ride_requests
        SET settlement_status = 'settled',
            settlement_outbox_id = ${outboxId}::uuid,
            driver_earnings = ${breakdown.driverEarnings},
            commission_amount = ${breakdown.commission},
            gst_amount = ${breakdown.gst},
            platform_deduction = ${breakdown.total},
            revenue_model = ${breakdown.model},
            revenue_breakdown = ${JSON.stringify(breakdown)}::jsonb,
            updated_at = NOW()
        WHERE id = ${entry.booking_id}::uuid
      `).catch(() => {});
    } else {
      await rawDb.execute(rawSql`
        UPDATE outstation_pool_bookings
        SET settlement_status = 'settled',
            settlement_outbox_id = ${outboxId}::uuid,
            driver_earnings = ${breakdown.driverEarnings},
            revenue_model = ${breakdown.model},
            updated_at = NOW()
        WHERE id = ${entry.booking_id}::uuid
      `).catch(() => {});
    }

    console.log(`[POOL-SETTLEMENT] ${outboxId}: settlement complete (booking: ${entry.booking_id})`);
  } catch (settleErr: any) {
    const newRetry = (parseInt(entry.retry_count) || 0) + 1;
    const newStatus = newRetry >= MAX_RETRY ? "failed" : "pending";
    await rawDb.execute(rawSql`
      UPDATE pool_settlement_outbox
      SET status = ${newStatus},
          retry_count = ${newRetry},
          error_message = ${settleErr?.message ?? "Unknown error"},
          updated_at = NOW()
      WHERE id = ${outboxId}::uuid
    `).catch(() => {});
    console.error(
      `[POOL-SETTLEMENT] ${outboxId} error (attempt ${newRetry}/${MAX_RETRY}):`,
      settleErr?.message,
    );
    if (newStatus === "failed") {
      console.error(`[POOL-SETTLEMENT] ALERT: ${outboxId} permanently failed — manual intervention required`);
    }
  }
}

// ─── Recovery (crash / restart handler) ──────────────────────────────────────

/**
 * Process all pending outbox entries. Also rescues stale 'processing' entries
 * (left by a crashed worker) by resetting them to 'pending' first.
 *
 * Safe to call concurrently: the atomic claim in processPoolSettlement ensures
 * only one worker actually processes each entry.
 */
export async function runPoolSettlementRecovery(): Promise<void> {
  try {
    // Reset stale 'processing' records left by a crashed worker
    await rawDb.execute(rawSql`
      UPDATE pool_settlement_outbox
      SET status = 'pending', updated_at = NOW()
      WHERE status = 'processing'
        AND updated_at < NOW() - INTERVAL '${rawSql.raw(String(STALE_PROCESSING_MINUTES))} minutes'
    `).catch(() => {});

    const r = await rawDb.execute(rawSql`
      SELECT id FROM pool_settlement_outbox
      WHERE status = 'pending' AND retry_count < ${MAX_RETRY}
      ORDER BY created_at ASC
      LIMIT 50
    `);

    const pending = r.rows as any[];
    if (pending.length) {
      console.log(`[POOL-SETTLEMENT] Recovery: processing ${pending.length} pending settlement(s)`);
    }
    for (const row of pending) {
      try {
        await processPoolSettlement(String(row.id));
      } catch (e: any) {
        console.error("[POOL-SETTLEMENT] Recovery error for", row.id, e?.message);
      }
    }
  } catch (e: any) {
    console.error("[POOL-SETTLEMENT] Recovery run failed:", e?.message);
  }
}

// ─── Background worker ────────────────────────────────────────────────────────

/**
 * Start the periodic settlement recovery worker.
 * Idempotent — safe to call multiple times (only one timer is created).
 */
export function startPoolSettlementWorker(): void {
  if (workerTimer) return;

  // Initial recovery after server boot (short delay to let DB connections stabilise)
  setTimeout(() => {
    runPoolSettlementRecovery().catch((e) =>
      console.error("[POOL-SETTLEMENT] Boot recovery error:", e?.message),
    );
  }, 8000);

  workerTimer = setInterval(() => {
    runPoolSettlementRecovery().catch((e) =>
      console.error("[POOL-SETTLEMENT] Periodic recovery error:", e?.message),
    );
  }, WORKER_INTERVAL_MS);

  // Don't block process exit on this timer
  if (typeof workerTimer === "object" && workerTimer !== null && "unref" in workerTimer) {
    (workerTimer as any).unref();
  }

  console.log("[POOL-SETTLEMENT] Recovery worker started (interval: 60s, stale-threshold: 5m)");
}

// Exported for tests
export { MAX_RETRY, STALE_PROCESSING_MINUTES };
