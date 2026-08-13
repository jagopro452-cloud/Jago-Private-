/**
 * Lightweight heartbeat registry + readiness aggregation for the health endpoints.
 * Additive only: records last-run timestamps for background jobs and combines
 * them with live DB/Redis/Socket.IO checks. Does not alter any job's own logic.
 */

const heartbeats = new Map<string, number>();

/** Call from inside a background job/interval to mark it as having just run. */
export function recordHeartbeat(name: string): void {
  heartbeats.set(name, Date.now());
}

function getHeartbeatAgeMs(name: string): number | null {
  const t = heartbeats.get(name);
  return t == null ? null : Date.now() - t;
}

export interface ReadinessResult {
  ready: boolean;
  httpStatus: number;
  checks: Record<string, unknown>;
}

export async function getReadiness(opts: {
  dbQuery: () => Promise<unknown>;
  checkRedis: () => Promise<{ status: "ok" | "down" | "not_configured"; error?: string | null }>;
  redisConfigured: boolean;
  socketIoReady: () => boolean;
  jobs: Array<{ name: string; maxAgeMs: number }>;
}): Promise<ReadinessResult> {
  const checks: Record<string, unknown> = {};

  let dbOk = false;
  try {
    await opts.dbQuery();
    dbOk = true;
    checks.postgres = "ok";
  } catch (e: any) {
    checks.postgres = `down: ${e?.message || e}`;
  }

  let redisOk = true;
  if (opts.redisConfigured) {
    try {
      const r = await opts.checkRedis();
      redisOk = r.status === "ok";
      checks.redis = r.status;
    } catch (e: any) {
      redisOk = false;
      checks.redis = `down: ${e?.message || e}`;
    }
  } else {
    checks.redis = "not_configured";
  }

  checks.socketio = opts.socketIoReady() ? "ok" : "not_initialized";

  const jobStatuses: Record<string, string> = {};
  for (const job of opts.jobs) {
    const age = getHeartbeatAgeMs(job.name);
    if (age == null) {
      jobStatuses[job.name] = "not_started";
    } else if (age > job.maxAgeMs) {
      jobStatuses[job.name] = `stale (${Math.round(age / 1000)}s)`;
    } else {
      jobStatuses[job.name] = "ok";
    }
  }
  checks.backgroundJobs = jobStatuses;

  // Only DB + Redis (when configured) gate readiness — a stale background job
  // is surfaced for visibility but does not pull the instance out of rotation.
  const ready = dbOk && redisOk;
  return { ready, httpStatus: ready ? 200 : 503, checks };
}
