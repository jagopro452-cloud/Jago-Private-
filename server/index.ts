// Register crash handlers FIRST — before any imports or async code runs
process.on("uncaughtException", (err: any) => {
  console.error("[FATAL uncaughtException]", err?.stack || err);
  // Don't exit — keep server alive for health checks
});
process.on("unhandledRejection", (reason: any) => {
  console.error("[FATAL unhandledRejection]", reason?.stack || reason);
});

console.log("BOOT START");

import "./env-bootstrap";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { setupSocket } from "./socket";
import { parseEnv, validateProductionReadiness } from "./config/env";
import { makeErrorId, sendAlert } from "./observability";
import { recordRequest, recordError } from "./metrics";
import { checkRedis } from "./presence";
import { io as socketIoInstance } from "./socket";
import { recordHeartbeat, getReadiness } from "./health-checks";
import { withJobLock } from "./job-lock";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db as drizzleDb, pool as dbPool } from "./db";
import { settleCustomerRidePaymentByOrder, settleDriverPaymentByOrder } from "./payment-settlement";
import { startRefundReconciliationJob, reconcilePendingRefunds } from "./refund-reconciliation";
import { verifyCriticalSchemaOrThrow } from "./schema-health";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import * as Sentry from "@sentry/node";

try {
  parseEnv();
} catch (startupErr: any) {
  console.error("[startup] Invalid production configuration:", startupErr.message);
  if (process.env.NODE_ENV === "production") {
    process.exit(1);
  }
}

// ─── Sentry (error capture only) ───────────────────────────────────────────
// Additive-only, backend-error monitoring. Does not replace or call into
// observability.ts / alert-engine.ts / metrics.ts / health-checks.ts, which
// remain the source of truth for alerting and internal metrics.
// No-op (including this init call) unless SENTRY_DSN is set. Never throws —
// a Sentry failure must never prevent server startup.
const sentryEnabled = Boolean(process.env.SENTRY_DSN);
if (sentryEnabled) {
  try {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || "development",
      // Error capture only — tracing/profiling/sampling intentionally disabled.
      tracesSampleRate: 0,
      beforeSend(event) {
        try {
          const req = event.request as any;
          if (req?.headers) {
            for (const key of Object.keys(req.headers)) {
              if (/^(authorization|cookie|x-device-id)$/i.test(key)) {
                delete req.headers[key];
              }
            }
          }
          if (req?.cookies) delete req.cookies;
          if (req?.data && typeof req.data === "object") {
            for (const key of Object.keys(req.data)) {
              if (/token|password|otp|secret|apikey|authorization/i.test(key)) {
                req.data[key] = "[REDACTED]";
              }
            }
          }
        } catch (_) {
          // Scrubbing must never itself block or fail event delivery.
        }
        return event;
      },
    });
    console.log("[sentry] Initialized (error capture only, no tracing)");
  } catch (e: any) {
    console.error("[sentry] Init failed (non-fatal):", e?.message || e);
  }
}

const app = express();
app.set("trust proxy", 1);

// HTTPS redirect + HSTS when TLS terminates at nginx/ALB
app.use((req, res, next) => {
  const forceHttps = String(process.env.FORCE_HTTPS || "").trim().toLowerCase() === "true";
  if (!forceHttps) return next();
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  if (forwardedProto && forwardedProto !== "https") {
    const host = req.headers.host || process.env.PUBLIC_HOST || "jagopro.org";
    return res.redirect(301, `https://${host}${req.originalUrl || req.url}`);
  }
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  return next();
});

const httpServer = createServer(app);
let bootstrapReady = false;
let bootstrapError: string | null = null;
// Interval handles owned directly by this file, cleared during graceful shutdown.
const backgroundIntervals: NodeJS.Timeout[] = [];
const useLocalStaticFrontend = process.env.LOCAL_STATIC_FRONTEND === "1";
const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    // Driver onboarding and KYC still send some images as base64 JSON payloads.
    // Keep this comfortably above typical compressed camera captures to avoid
    // generic submit failures on selfie/document upload.
    limit: "35mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "10mb", parameterLimit: 100 }));

// Liveness: is the process itself alive enough to answer? No dependency checks —
// used by PM2/orchestrator to decide whether to kill+restart. Always fast.
app.get("/health/live", (_req, res) => {
  return res.status(200).json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
});

// Readiness: should this instance receive traffic? Actively checks Postgres and
// Redis (when configured) so a dependency outage is caught automatically instead
// of the endpoint reflecting only the one-time startup flag.
async function readinessHandler(_req: Request, res: Response) {
  if (!bootstrapReady) {
    return res.status(503).json({
      status: "starting",
      ready: false,
      error: bootstrapError,
      ts: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  }

  const READINESS_TIMEOUT_MS = 4000;

  try {
    const result = await Promise.race([
      getReadiness({
        dbQuery: () => dbPool.query("SELECT 1"),
        checkRedis,
        redisConfigured: Boolean(process.env.REDIS_URL),
        socketIoReady: () => Boolean(socketIoInstance && (socketIoInstance as any).engine),
        jobs: [
          { name: "paymentRetry", maxAgeMs: 10 * 60 * 1000 },
          { name: "orphanPaymentRecovery", maxAgeMs: 10 * 60 * 1000 },
          { name: "ghostDriverOffline", maxAgeMs: 3 * 60 * 1000 },
          { name: "scheduledRideDispatcher", maxAgeMs: 2 * 60 * 1000 },
          { name: "dispatchCleanup", maxAgeMs: 3 * 60 * 1000 },
          { name: "dispatchRecoveryLoop", maxAgeMs: 3 * 60 * 1000 },
          { name: "hardeningAutoTimeout", maxAgeMs: 2 * 60 * 1000 },
          { name: "hardeningStaleRideCleanup", maxAgeMs: 20 * 60 * 1000 },
        ],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("readiness_timeout")), READINESS_TIMEOUT_MS)
      ),
    ]);

    return res.status(result.httpStatus).json({
      status: result.ready ? "ok" : "degraded",
      ready: result.ready,
      error: bootstrapError,
      ts: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      checks: result.checks,
    });
  } catch (e: any) {
    // Readiness check itself must never hang or crash the endpoint — a stuck
    // dependency check (e.g. a Redis ping with no reply) always resolves here
    // as degraded within READINESS_TIMEOUT_MS instead of hanging the request.
    const timedOut = e?.message === "readiness_timeout";
    return res.status(503).json({
      status: timedOut ? "timeout" : "degraded",
      ready: false,
      error: timedOut ? `readiness_check_timed_out_after_${READINESS_TIMEOUT_MS}ms` : `readiness_check_failed: ${e?.message || e}`,
      ts: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  }
}

app.get("/_health", readinessHandler);
app.get("/health", readinessHandler);
app.get("/api/health", readinessHandler);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// ─── Graceful shutdown ───────────────────────────────────────────────────────
// Order: stop taking on new background-job work → stop accepting new HTTP
// connections → drain in-flight requests → close Socket.IO → close the
// Postgres pool → exit. A 30s hard timeout forces exit if any step hangs
// (e.g. a stuck connection), so a bad shutdown can never leave PM2 waiting
// forever — it falls back to the same behavior as before this change.
const SHUTDOWN_TIMEOUT_MS = 30000;
let shuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`[shutdown] ${signal} received — draining...`);

  const forceExitTimer = setTimeout(() => {
    console.error(`[shutdown] did not complete within ${SHUTDOWN_TIMEOUT_MS}ms — forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  for (const handle of backgroundIntervals) clearInterval(handle);

  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
      // Node 18.2+: proactively close idle keep-alive sockets so close()'s
      // callback isn't stuck waiting on connections with no in-flight request.
      (httpServer as any).closeIdleConnections?.();
    });
    log("[shutdown] HTTP server closed — no longer accepting new connections, in-flight requests drained");
  } catch (e: any) {
    console.error("[shutdown] error closing HTTP server:", e?.message || e);
  }

  try {
    if (socketIoInstance) {
      await new Promise<void>((resolve) => socketIoInstance.close(() => resolve()));
      log("[shutdown] Socket.IO closed");
    }
  } catch (e: any) {
    console.error("[shutdown] error closing Socket.IO:", e?.message || e);
  }

  try {
    await dbPool.end();
    log("[shutdown] Postgres pool closed");
  } catch (e: any) {
    console.error("[shutdown] error closing Postgres pool:", e?.message || e);
  }

  // Optional: flush any queued Sentry events before exit. Bounded to 2s (well
  // within SHUTDOWN_TIMEOUT_MS) and never throws — additive only, does not
  // change the ordering of the steps above.
  if (sentryEnabled) {
    try {
      await Sentry.close(2000);
      log("[shutdown] Sentry flushed");
    } catch (e: any) {
      console.error("[shutdown] error flushing Sentry:", e?.message || e);
    }
  }

  clearTimeout(forceExitTimer);
  log("[shutdown] cleanup complete, exiting");
  process.exit(0);
}

process.on("SIGTERM", () => { gracefulShutdown("SIGTERM").catch(() => process.exit(1)); });
process.on("SIGINT", () => { gracefulShutdown("SIGINT").catch(() => process.exit(1)); });

function maskEmail(email: string | null | undefined): string {
  if (!email) return "[REDACTED_EMAIL]";
  const [local, domain] = email.split("@");
  if (!domain) return "[REDACTED_EMAIL]";
  const safeLocal =
    local.length <= 2 ? `${local[0] || "*"}*` : `${local.slice(0, 2)}***`;
  return `${safeLocal}@${domain}`;
}

function redactLogValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > 160) return `${value.slice(0, 157)}...`;
    return value;
  }
  if (Array.isArray(value)) {
    return `[array:${value.length}]`;
  }
  if (typeof value === "object") {
    return "[object]";
  }
  return value;
}

function sanitizeResponseForDebug(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const obj = body as Record<string, unknown>;
  const sensitiveKeys = new Set([
    "otp",
    "password",
    "passwordHash",
    "token",
    "sessionToken",
    "authToken",
    "resetOtp",
    "firebaseToken",
    "fcmToken",
    "phone",
    "email",
    "address",
    "wallet",
    "walletBalance",
    "transactions",
    "data",
    "users",
  ]);
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.has(key)) {
      sanitized[key] = "[REDACTED]";
      continue;
    }
    sanitized[key] = redactLogValue(value);
  }
  return sanitized;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDependencies() {
  const requireRedis = Boolean(process.env.REDIS_URL);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      await dbPool.query("SELECT 1");
      if (requireRedis) {
        const { checkRedis } = await import("./presence");
        const redisHealth = await checkRedis();
        if (redisHealth.status !== "ok") {
          throw new Error(redisHealth.error || `redis_${redisHealth.status}`);
        }
      }
      return;
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error));
      log(`[startup] waiting for dependencies (${attempt}/20): ${lastError.message}`);
      await sleep(1000);
    }
  }

  throw lastError || new Error("dependency_check_failed");
}

async function loadRuntimeConfigFromDb() {
  const settingsRes = await dbPool.query(
    "SELECT key_name, value FROM business_settings WHERE key_name = ANY($1::text[])",
    [[
      "razorpay_key_id",
      "razorpay_key_secret",
      "razorpay_webhook_secret",
      "google_maps_key",
      "google_maps_api_key",
      "firebase_service_account",
      "firebase_web_api_key",
      "app_base_url",
    ]]
  );

  const ENV_MAP: Record<string, string> = {
    razorpay_key_id: "RAZORPAY_KEY_ID",
    razorpay_key_secret: "RAZORPAY_KEY_SECRET",
    razorpay_webhook_secret: "RAZORPAY_WEBHOOK_SECRET",
    google_maps_key: "GOOGLE_MAPS_API_KEY",
    google_maps_api_key: "GOOGLE_MAPS_API_KEY",
    firebase_service_account: "FIREBASE_SERVICE_ACCOUNT_KEY",
    firebase_web_api_key: "FIREBASE_WEB_API_KEY",
    app_base_url: "APP_BASE_URL",
  };

  for (const row of settingsRes.rows as any[]) {
    const envKey = ENV_MAP[row.key_name];
    if (envKey && !process.env[envKey] && row.value?.trim()) {
      process.env[envKey] = row.value.trim();
      log(`[config] Loaded ${envKey} from DB settings`);
    }
  }

  log("[config] DB settings loaded into runtime config");
}

function validateResolvedProductionConfig() {
  try {
    const env = parseEnv();
    validateProductionReadiness(env);
  } catch (startupErr: any) {
    console.error("[startup] Invalid resolved production configuration:", startupErr.message);
    if (process.env.NODE_ENV === "production") {
      throw startupErr;
    }
  }
}

async function setupSocketRedisAdapter() {
  try {
    const redisUrl = (process.env.REDIS_URL || "").trim();
    if (!redisUrl) {
      log("[Socket.IO] REDIS_URL not set; using in-memory adapter");
      return;
    }

    const { createAdapter } = await import("@socket.io/redis-adapter");
    const { default: IORedis } = await import("ioredis");
    const pubClient = new IORedis(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 500, 5000),
      reconnectOnError: () => true,
      keepAlive: 15000,
    });
    const subClient = pubClient.duplicate();
    pubClient.on("error", (error) => { log(`[Socket.IO][Redis] publisher error: ${error.message}`); });
    subClient.on("error", (error) => { log(`[Socket.IO][Redis] subscriber error: ${error.message}`); });
    pubClient.on("end", () => { log("[Socket.IO][Redis] publisher connection ended"); });
    subClient.on("end", () => { log("[Socket.IO][Redis] subscriber connection ended"); });
    const { io: socketIo } = await import("./socket");

    await Promise.all([
      new Promise<void>((resolve, reject) => { pubClient.once("ready", resolve); pubClient.once("error", reject); pubClient.connect().catch(reject); }),
      new Promise<void>((resolve, reject) => { subClient.once("ready", resolve); subClient.once("error", reject); subClient.connect().catch(reject); }),
    ]);

    socketIo.adapter(createAdapter(pubClient, subClient));
    log("[Socket.IO] Redis adapter connected");
  } catch (error: any) {
    log(`[Socket.IO] Redis unavailable, using in-memory adapter (non-fatal): ${error?.message || error}`);
  }
}

async function ensureMigrationTable() {
  await dbPool.query(
    `CREATE TABLE IF NOT EXISTS migrations (
       name text PRIMARY KEY,
       applied_at timestamp NOT NULL DEFAULT now()
     )`,
  );
}

/** Read SQL migration as UTF-8; auto-detect UTF-16 (Windows) and strip null bytes. */
function readMigrationSql(migrationPath: string): string {
  const raw = fsSync.readFileSync(migrationPath);
  let text: string;
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    text = raw.toString("utf16le");
  } else if (raw.length >= 2 && raw[1] === 0x00 && raw[0] !== 0x00 && raw[0] !== 0xef) {
    text = raw.toString("utf16le");
  } else {
    text = raw.toString("utf8");
  }
  return text.replace(/^\uFEFF/, "").replace(/\0/g, "").trim();
}

async function markMigrationApplied(name: string) {
  await dbPool.query(
    "INSERT INTO migrations (name, applied_at) VALUES ($1, NOW()) ON CONFLICT (name) DO NOTHING",
    [name],
  );
}

async function applySqlMigrationsFromDir(
  migrationsDir: string,
  scope: "root" | "server",
  options: { skipBaselineOnExistingSchema?: boolean } = {},
) {
  await ensureMigrationTable();
  if (!fsSync.existsSync(migrationsDir)) {
    log(`[migration] directory missing, skipping: ${migrationsDir}`);
    return;
  }

  const files = (await fs.readdir(migrationsDir))
    .filter((name) => name.toLowerCase().endsWith(".sql"))
    .sort();

  for (const file of files) {
    const migrationName = `${scope}:${file}`;
    const existing = await dbPool.query(
      "SELECT 1 FROM migrations WHERE name = $1 OR name = $2 LIMIT 1",
      [migrationName, file],
    );
    if ((existing.rowCount ?? 0) > 0) {
      log(`[migration] ${migrationName} already marked applied`);
      continue;
    }

    if (scope === "root" && file === "0000_baseline.sql" && options.skipBaselineOnExistingSchema) {
      await markMigrationApplied(migrationName);
      log(`[migration] ${migrationName} recorded as pre-existing schema baseline`);
      continue;
    }

    const migrationPath = path.join(migrationsDir, file);
    try {
      const migrationSql = readMigrationSql(migrationPath);
      if (migrationSql) {
        await dbPool.query(migrationSql);
      }
      await markMigrationApplied(migrationName);
      log(`[migration] ${migrationName} applied`);
    } catch (e: any) {
      throw new Error(`${migrationName} failed: ${e.message}`);
    }
  }
}

async function runAuthoritativeMigrations() {
  const rootCandidates = [
    path.join(process.cwd(), "migrations"),
    path.join(currentDir, "drizzle-migrations"),
    path.join(currentDir, "..", "migrations"),
  ];

  const rootMigrations = rootCandidates.find((folder) =>
    fsSync.existsSync(folder) &&
    fsSync.readdirSync(folder).some((name) => name.toLowerCase().endsWith(".sql"))
  );

  if (!rootMigrations) {
    throw new Error(`Authoritative root migration chain missing. Checked: ${rootCandidates.join(", ")}`);
  }

  const schemaCheck = await dbPool.query("SELECT to_regclass('public.users') AS users_table");
  const hasExistingSchema = Boolean(schemaCheck.rows[0]?.users_table);
  await applySqlMigrationsFromDir(rootMigrations, "root", {
    skipBaselineOnExistingSchema: hasExistingSchema,
  });
  await applySqlMigrationsFromDir(path.join(currentDir, "migrations"), "server");
  log(`[db] Authoritative SQL migration chain applied (existingSchema=${hasExistingSchema})`);
}

// Security headers
app.use((req, res, next) => {
  const isApiRequest =
    req.path.startsWith("/api") ||
    req.path.startsWith("/v1/") ||
    req.path.startsWith("/v2/");
  // CORS headers — allow requests from frontend domain(s)
  const origin = req.headers.origin;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const requestProto = forwardedProto || req.protocol || "https";
  const requestOrigin = `${requestProto}://${req.headers.host}`;
  // SECURITY: dev/localhost/LAN origins must never be reachable in production, even as a
  // fallback. ALLOWED_ORIGINS is already fatal-if-unset in production (server/config/env.ts
  // validateProductionReadiness), so this fallback should only ever be hit in dev - but that
  // fallback string previously baked in a specific dev machine's LAN IP unconditionally,
  // regardless of NODE_ENV. Split so a production-mode process can never fall back to it.
  const prodDefaultOrigins = "https://jagopro.org,https://www.jagopro.org,https://sea-lion-app-h5luj.ondigitalocean.app";
  const devOnlyOrigins = "http://localhost:5173,http://localhost:5000,http://127.0.0.1:5173,http://127.0.0.1:5000,http://192.168.1.9:5000";
  const defaultOrigins = process.env.NODE_ENV === "production"
    ? prodDefaultOrigins
    : `${prodDefaultOrigins},${devOnlyOrigins}`;
  const allowedOrigins = ((process.env.ALLOWED_ORIGINS || defaultOrigins))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const isSameOrigin = !!origin && origin === requestOrigin;

  if (!origin) {
    // Native mobile requests usually do not send Origin.
  } else if (!isApiRequest || isSameOrigin || allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    return res.status(403).json({ message: "Origin not allowed" });
  }

  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Max-Age", "3600");

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;
  const allowResponsePreview = process.env.NODE_ENV !== "production";

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      recordRequest();
      if (res.statusCode >= 500) recordError();
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (allowResponsePreview && capturedJsonResponse) {
        const sanitized = sanitizeResponseForDebug(capturedJsonResponse);
        if (sanitized) {
        logLine += ` :: ${JSON.stringify(sanitized)}`;
        }
      }

      log(logLine);
    }
  });

  next();
});

app.use((req, res, next) => {
  if (bootstrapReady || req.path === "/" || req.path === "/_health" || req.path === "/health" || req.path === "/api/health") {
    return next();
  }

  return res.status(503).json({
    message: "Server is starting. Please try again in a few seconds.",
    ready: false,
  });
});

app.get("/", (_req, res, next) => {
  if (bootstrapReady) {
    return next();
  }

  return res.status(200).send("starting");
});

const port = parseInt(process.env.PORT || "5000", 10);

(async () => {
  // ─── STEP 1: Register error handler ───
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const errorId = makeErrorId();
    console.error(`Internal Server Error [${errorId}]:`, err);
    sendAlert({ level: status >= 500 ? "critical" : "error", source: "express", message: `Request failed with status ${status} (${errorId})`, details: typeof err?.stack === "string" ? err.stack : String(err?.message || err) }).catch(() => { });
    if (res.headersSent) return next(err);
    const isProd = process.env.NODE_ENV === "production";
    return res.status(status).json({ message: isProd && status >= 500 ? `An internal error occurred. Reference: ${errorId}` : (err.message || "Internal Server Error"), errorId });
  });

  try {
    await waitForDependencies();
    log("[startup] Dependencies ready");
  } catch (e: any) {
    bootstrapError = `dependency_check_failed:${e.message}`;
    console.error("[startup] Dependency check failed:", e.message);
    sendAlert({
      level: "critical",
      source: "startup",
      message: "Dependency check failed during boot",
      details: String(e.message || e),
    }).catch(() => { });
    return;
  }

  // ─── STEP 1b: Run migrations BEFORE any DB-dependent code — a fresh/empty
  // database has no tables yet, so schema must exist before runtime config
  // loading, route registration, or anything else that queries app tables. ───
  try {
    await runAuthoritativeMigrations();
  } catch (e: any) {
    bootstrapError = `migration_failed:${e.message}`;
    console.error("[db] Authoritative migration chain failed:", e.message);
    sendAlert({ level: "critical", source: "migrations", message: "Authoritative migration chain failed", details: e.message }).catch(() => {});
    return;
  }

  try {
    await loadRuntimeConfigFromDb();
    validateResolvedProductionConfig();
  } catch (e: any) {
    bootstrapError = `runtime_config_failed:${e.message}`;
    console.error("[config] Runtime configuration bootstrap failed:", e.message);
    sendAlert({
      level: "critical",
      source: "startup-config",
      message: "Runtime configuration bootstrap failed",
      details: String(e.message || e),
    }).catch(() => {});
    return;
  }

  // ─── STEP 2: Register routes (non-fatal if fails) ───
  try {
    log("[server] Registering API routes...");
    await registerRoutes(httpServer, app);
    log("[server] API routes registered OK");
  } catch (e: any) {
    bootstrapError = `route_registration_failed:${e.message}`;
    console.error("[routes] Failed to register routes:", e.message);
    sendAlert({ level: "critical", source: "routes", message: "Failed to register API routes", details: String(e.message || e) }).catch(() => { });
    return;
  }

  // ─── Sentry Express error handler (additive only) ───
  // Registered after all routes so it can observe their errors. It never
  // sends a response itself — by default it only captures and then calls
  // next(err), so whichever handler was already going to process the error
  // (downstream in the stack) still runs exactly as before; response
  // bodies/status codes are unchanged regardless of that handler's identity.
  if (sentryEnabled) {
    try {
      Sentry.setupExpressErrorHandler(app);
    } catch (e: any) {
      console.error("[sentry] Failed to register Express error handler (non-fatal):", e?.message || e);
    }
  }

  // ─── STEP 3: Static files or Vite dev middleware ───
  if (process.env.NODE_ENV === "production" || useLocalStaticFrontend) {
    try {
      serveStatic(app);
      log(useLocalStaticFrontend ? "[static] Frontend assets configured via LOCAL_STATIC_FRONTEND" : "[static] Frontend assets configured");
    } catch (e: any) {
      bootstrapError = `static_files_failed:${e.message}`;
      console.error("[static] Failed to configure frontend assets:", e.message);
      console.error("[static] Run 'npm run build' to generate dist/public, then restart");
      sendAlert({ level: "error", source: "static", message: "Failed to configure frontend assets", details: e.message }).catch(() => {});
      return;
    }
  } else {
    // Dev mode: register Vite BEFORE server starts listening so the SPA catch-all
    // is always ready when the first connection arrives
    try {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
      log("[vite] Vite middleware registered");
    } catch (e: any) {
      console.error("[vite] Failed to setup Vite — frontend will not be served:", e.message);
      return;
    }
  }

  // ─── STEP 6: Mark server ready — health probe passes from here ───
  try {
    await verifyCriticalSchemaOrThrow();
    log("[schema] Critical schema health verified");
  } catch (e: any) {
    bootstrapError = `schema_health_failed:${e.message}`;
    log(`[schema] Critical schema verification failed (non-fatal): ${e.message}`);
    sendAlert({ level: "error", source: "schema-health", message: "Schema verification failed", details: e.message }).catch(() => {});
  }

  try {
    setupSocket(httpServer);
    await setupSocketRedisAdapter();
  } catch (e: any) {
    bootstrapError = `socket_init_failed:${e.message}`;
    log(`[socket] Socket init warning (non-fatal): ${e.message}`);
    sendAlert({ level: "error", source: "socket", message: "Socket.IO initialization had errors", details: String(e.message || e) }).catch(() => {});
  }

  bootstrapReady = true;
  bootstrapError = null;
  console.log(`BOOT READY port=${port}`);

  // ─── START LISTENING (only after all critical setup is done) ───
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`BOOT LISTEN OK port=${port}`);
  });

  // ─── BACKGROUND: Alert engine ───
  setTimeout(() => {
    (async () => {
      try {
        const { startAlertEngine } = await import("./alert-engine");
        startAlertEngine();
      } catch (e: any) {
        console.error("[alert-engine] Failed to start:", e.message);
      }
    })();
  }, 3000);

  reconcilePendingRefunds().catch((e: any) => {
    console.error("[refund-reconcile] initial run failed:", e.message);
  });
  startRefundReconciliationJob();

  // ─── Pool settlement outbox worker (crash-safe, idempotent) ───
  (async () => {
    try {
      const { startPoolSettlementWorker } = await import("./pool-settlement");
      startPoolSettlementWorker();
    } catch (e: any) {
      console.error("[pool-settlement] Failed to start worker:", e.message);
    }
  })();

  // ─── Transactional outbox processor (outbox_events — trip-completion
  // notifications). Defined in outbox.ts but was never wired into startup;
  // startOutboxProcessor() has its own idempotency guard against double-start. ───
  (async () => {
    try {
      const { startOutboxProcessor } = await import("./outbox");
      startOutboxProcessor(socketIoInstance);
    } catch (e: any) {
      console.error("[outbox] Failed to start processor:", e.message);
    }
  })();

  // ─── INITIALIZE PREDICTIVE DISPATCH SCHEMA ───
  (async () => {
    try {
      const { initPredictiveDispatchSchema } = await import("./predictive-dispatch");
      await initPredictiveDispatchSchema();
    } catch (e: any) {
      console.error('[predictive-dispatch] Schema init failed (non-fatal):', e.message);
    }
  })();

  // ─── DB MIGRATION: production_hardening indexes + constraints ───
  // ─── INITIALIZE PRODUCTION HARDENING (CRITICAL) ───
  (async () => {
    try {
      const { startHardeningJobs, loadHardeningSettings, logInfo } = await import("./hardening");
      await loadHardeningSettings();
      await startHardeningJobs();
      await logInfo('HARDENING-STARTUP', 'Production hardening system initialized', {});
    } catch (e: any) {
      console.error('[hardening] Failed to initialize:', e.message);
      // Non-fatal: hardening should not prevent server startup
      // but log it loudly for visibility
      sendAlert({
        level: "error",
        source: "hardening",
        message: "Hardening system failed to initialize",
        details: e.message,
      }).catch(() => { });
    }
  })();

  // Payment retry job: every 5 minutes, check trips stuck in payment_pending
  // for more than 5 minutes and query Razorpay to auto-resolve them
  backgroundIntervals.push(setInterval(async () => {
    recordHeartbeat("paymentRetry");
    await withJobLock("paymentRetry", async () => {
    try {
      const { rawDb, rawSql } = await import("./db");
      const { io: socketIo } = await import("./socket");
      const { getRazorpayKeys } = await import("./routes");
      const { keyId: RAZORPAY_KEY_ID, keySecret: RAZORPAY_KEY_SECRET } = await getRazorpayKeys();
      if (!RAZORPAY_KEY_ID) return;
      // Find trips stuck in payment_pending for > 5 minutes
      const pendingDriverPayments = await rawDb.execute(rawSql`
        SELECT
          'driver'::text AS payment_source,
          t.id as trip_id,
          t.customer_id,
          dp.razorpay_order_id,
          dp.id as payment_id,
          dp.driver_id
        FROM trip_requests t
        JOIN driver_payments dp ON dp.trip_id = t.id
        WHERE t.current_status = 'payment_pending'
          AND t.updated_at < NOW() - INTERVAL '5 minutes'
          AND dp.status = 'pending'
          AND dp.razorpay_order_id IS NOT NULL
        LIMIT 20
      `);
      const pendingCustomerPayments = await rawDb.execute(rawSql`
        SELECT
          'customer'::text AS payment_source,
          t.id as trip_id,
          t.customer_id,
          cp.razorpay_order_id,
          cp.id as payment_id,
          NULL::uuid AS driver_id
        FROM trip_requests t
        JOIN customer_payments cp ON cp.trip_id = t.id
        WHERE t.current_status = 'payment_pending'
          AND t.updated_at < NOW() - INTERVAL '5 minutes'
          AND cp.status = 'pending'
          AND cp.razorpay_order_id IS NOT NULL
        LIMIT 20
      `);
      const stuckTrips = [
        ...((pendingDriverPayments.rows as any[]) || []),
        ...((pendingCustomerPayments.rows as any[]) || []),
      ];
      for (const row of stuckTrips) {
        try {
          // Query Razorpay for order payment status
          const rzpRes = await fetch(`https://api.razorpay.com/v1/orders/${row.razorpay_order_id}/payments`, {
            headers: { Authorization: `Basic ${Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64")}` },
          });
          if (!rzpRes.ok) continue;
          const rzpData = await rzpRes.json() as any;
          const captured = rzpData?.items?.find((p: any) => p.status === "captured");
          if (captured) {
            // Payment confirmed — complete the trip
            if (row.payment_source === "driver") {
              await settleDriverPaymentByOrder({
                orderId: String(row.razorpay_order_id),
                paymentId: String(captured.id),
                source: "retry_job",
              });
            } else {
              await settleCustomerRidePaymentByOrder({
                orderId: String(row.razorpay_order_id),
                paymentId: String(captured.id),
                source: "retry_job",
              });
            }
            const tripState = await rawDb.execute(rawSql`
              SELECT current_status
              FROM trip_requests
              WHERE id=${row.trip_id}::uuid
              LIMIT 1
            `);
            const currentTripStatus = String((tripState.rows[0] as any)?.current_status || "");
            if (currentTripStatus !== "completed") {
              const { transitionRideState } = await import("./ride-state");
              await transitionRideState(String(row.trip_id), "completed", {
                actorType: "system",
                event: "COMPLETED",
                data: { source: "payment_retry_job", paymentId: captured.id, orderId: row.razorpay_order_id },
                extraSetters: [rawSql`payment_status='paid'`],
              }).catch(() => null);
            }
            socketIo.to(`user:${row.customer_id}`).emit("trip:completed", { tripId: row.trip_id, message: "Payment confirmed. Trip complete." });
            log(`[PaymentRetry] Trip ${row.trip_id} resolved — payment ${captured.id} captured`);
          }
        } catch (_) { }
      }
    } catch (e: any) {
      log(`[PaymentRetry] Error: ${e.message}`);
    }
    });
  }, 5 * 60 * 1000)); // every 5 minutes

  // Orphan payment recovery: every 5 minutes, recover paid rides with no linked trip
  backgroundIntervals.push(setInterval(async () => {
    recordHeartbeat("orphanPaymentRecovery");
    await withJobLock("orphanPaymentRecovery", async () => {
    try {
      const { runOrphanRecoveryWorker } = await import("./payment-orphan-recovery");
      const stats = await runOrphanRecoveryWorker();
      if (stats.detected > 0) {
        log(`[OrphanRecovery] detected=${stats.detected} recovered=${stats.recovered} failed=${stats.failed} skipped=${stats.skipped}`);
      }
    } catch (e: any) {
      log(`[OrphanRecovery] Error: ${e.message}`);
    }
    });
  }, 5 * 60 * 1000));

  // Ghost driver auto-offline: every 60 seconds, mark drivers with no location ping > 5min as offline
  backgroundIntervals.push(setInterval(async () => {
    recordHeartbeat("ghostDriverOffline");
    try {
      const { autoOfflineInactiveDrivers } = await import("./ai");
      await autoOfflineInactiveDrivers();
    } catch (_) { }
  }, 60 * 1000)); // every 60 seconds

})();
