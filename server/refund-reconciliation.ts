import { rawDb, rawSql } from "./db";

const STALE_REFUND_MINUTES = Number(process.env.REFUND_RECONCILE_MIN_AGE || "3");
const RECONCILE_INTERVAL_MS = Number(process.env.REFUND_RECONCILE_INTERVAL_MS || String(5 * 60 * 1000));

async function finalizeRefundStatuses(): Promise<number> {
  const result = await rawDb.execute(rawSql`
    WITH candidates AS (
      SELECT
        cp.id,
        cp.trip_id,
        cp.customer_id,
        cp.razorpay_payment_id,
        t.payment_status,
        EXISTS (
          SELECT 1
          FROM refund_requests rr
          WHERE rr.trip_id = cp.trip_id
            AND rr.customer_id = cp.customer_id
            AND rr.status = 'completed'
        ) AS has_completed_refund_request,
        EXISTS (
          SELECT 1
          FROM transactions tx
          WHERE tx.user_id = cp.customer_id
            AND tx.transaction_type = 'ride_refund'
            AND tx.ref_transaction_id = cp.razorpay_payment_id
        ) AS has_refund_ledger
      FROM customer_payments cp
      LEFT JOIN trip_requests t ON t.id = cp.trip_id
      WHERE cp.status = 'refund_processing'
        AND cp.payment_type = 'ride_payment'
        AND cp.created_at < NOW() - (${STALE_REFUND_MINUTES}::int * INTERVAL '1 minute')
    )
    UPDATE customer_payments cp
    SET status = 'refunded',
        refunded_at = COALESCE(cp.refunded_at, NOW())
    FROM candidates c
    WHERE cp.id = c.id
      AND (
        c.payment_status IN ('refunded_to_bank', 'refunded_to_wallet')
        OR c.has_completed_refund_request = true
        OR c.has_refund_ledger = true
      )
    RETURNING cp.id
  `);

  return result.rows.length;
}

export async function reconcilePendingRefunds(): Promise<void> {
  try {
    const repaired = await finalizeRefundStatuses();
    if (repaired > 0) {
      console.log(`[refund-reconcile] repaired ${repaired} stuck refunds`);
    }
  } catch (error: any) {
    console.error("[refund-reconcile] run failed:", error?.message || error);
  }
}

let refundReconcileTimer: ReturnType<typeof setInterval> | null = null;

export function startRefundReconciliationJob(): void {
  if (refundReconcileTimer) return;
  refundReconcileTimer = setInterval(() => {
    reconcilePendingRefunds().catch((error) => {
      console.error("[refund-reconcile] interval failed:", error?.message || error);
    });
  }, RECONCILE_INTERVAL_MS);
}
