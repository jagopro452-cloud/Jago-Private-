import { pool } from "./db";

/**
 * Cluster-safe singleton execution for scheduled jobs.
 *
 * PM2 cluster mode runs N worker processes, each with its own setInterval
 * timers — without this, a periodic job fires N times per tick instead of
 * once. Uses a Postgres transaction-scoped advisory lock
 * (pg_try_advisory_xact_lock), which is non-blocking: a worker that doesn't
 * get the lock simply skips this tick's run rather than queuing behind
 * another worker.
 *
 * Only wrap jobs that mutate shared (DB) state via a read-then-act pattern
 * without their own atomic per-row claim guard (e.g. FOR UPDATE SKIP LOCKED,
 * or a single atomic UPDATE ... WHERE ... RETURNING). Jobs that are already
 * safe by construction (outbox.ts, pool-settlement.ts, refund-reconciliation.ts,
 * alert-engine.ts) or purely per-worker in-memory (dispatch.ts's
 * startDispatchCleanup) do not need this and should not be wrapped.
 */

// Distinct, explicit lock IDs per job — avoids any hash-collision risk.
export const JOB_LOCK_IDS = {
  paymentRetry: 900101,
  orphanPaymentRecovery: 900102,
  scheduledRideDispatcher: 900103,
  dispatchRecoveryLoop: 900104,
  hardeningAutoTimeout: 900105,
  hardeningStaleRideCleanup: 900106,
} as const;

export type JobLockName = keyof typeof JOB_LOCK_IDS;

/**
 * Runs `fn` only if this worker acquires the named advisory lock; otherwise
 * skips silently (another worker already holds it for this tick).
 *
 * Uses pg_try_advisory_xact_lock — a transaction-scoped advisory lock — so
 * the lock is released automatically on COMMIT or ROLLBACK, with no explicit
 * unlock call needed. This avoids the leak class that session-scoped
 * pg_try_advisory_lock/pg_advisory_unlock has with pooled connections: if an
 * explicit unlock ever failed, the lock would stay held on that connection
 * even after client.release() returned it to the pool for reuse, blocking
 * every worker from acquiring that job's lock until the connection happened
 * to be closed. A transaction boundary can't leak the same way — even a
 * dropped connection aborts the transaction server-side, releasing the lock.
 */
export async function withJobLock(name: JobLockName, fn: () => Promise<void>): Promise<void> {
  const lockId = JOB_LOCK_IDS[name];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const { rows } = await client.query("SELECT pg_try_advisory_xact_lock($1) AS acquired", [lockId]);
      if (!rows[0]?.acquired) {
        await client.query("ROLLBACK");
        return; // another worker holds this job's lock for the current tick
      }
      await fn();
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  } finally {
    client.release();
  }
}
