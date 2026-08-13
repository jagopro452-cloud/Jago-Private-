import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;
const isProduction = process.env.NODE_ENV === 'production';
const databaseUrl = (process.env.DATABASE_URL || "").trim();

if (!databaseUrl) {
  if (isProduction) {
    throw new Error("[db] DATABASE_URL is required in production");
  }
  console.error("[db] WARNING: DATABASE_URL not set — DB operations will fail at runtime");
}

function normalizeDatabaseUrl(connectionString: string): string {
  try {
    const parsed = new URL(connectionString);
    // Let node-postgres honor the explicit ssl object below instead of
    // inheriting stricter sslmode semantics from the URL query string.
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("sslcert");
    parsed.searchParams.delete("sslkey");
    parsed.searchParams.delete("sslrootcert");
    return parsed.toString();
  } catch {
    return connectionString;
  }
}

const isLocalDb = databaseUrl.match(/localhost|127\.0\.0\.1/);
const normalizedDatabaseUrl = normalizeDatabaseUrl(databaseUrl);
const databaseCaCert = (process.env.DATABASE_CA_CERT || process.env.DB_CA_CERT || "")
  .replace(/\\n/g, "\n")
  .trim();
const rejectUnauthorized =
  String(process.env.DB_SSL_REJECT_UNAUTHORIZED || (databaseCaCert ? "true" : "false")).toLowerCase() !== "false";
const sslConfig = isLocalDb ? false : {
  rejectUnauthorized,
  ...(databaseCaCert ? { ca: databaseCaCert } : {}),
};

// Neon serverless needs enough connections to handle concurrent request bursts.
// 10 was too low — production peaks can exhaust the pool causing queue buildup.
// Load-tested locally (2026-08): 100 concurrent requests stayed healthy (p50 ~386ms)
// at pool=15, but 500 concurrent degraded to p50 ~5.5s / max ~7.6s at pool=25 — the
// pool, not the app, was the bottleneck (zero request failures either way, just
// queueing). Raised the production default accordingly. Verify against your actual
// Postgres/Neon plan's connection ceiling before raising further — Neon in
// particular caps concurrent connections per plan tier, and a pool sized past that
// ceiling fails hard ("too many clients") instead of degrading gracefully like this
// did. Override via DB_POOL_MAX env var for your specific deployment.
const maxConnections = Number(process.env.DB_POOL_MAX || (isProduction ? "40" : "20"));

export const pool = new Pool({
  connectionString: normalizedDatabaseUrl,
  ssl: sslConfig,
  max: maxConnections,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
  statement_timeout: 10000,
  allowExitOnIdle: false,
  application_name: 'jago-api',   // For debugging in pg_stat_statements
});

pool.on("error", (err) => {
  console.error("[DB] Unexpected pool error:", err.message);
});

pool.on("connect", () => {
  if (!isProduction) {
    console.debug("[DB] New connection established, pool size:", pool.totalCount);
  }
});

export const db = drizzle(pool, { schema });
export const rawDb = db;
export const rawSql = sql;

// SIGTERM/SIGINT handling lives in server/index.ts, which closes the HTTP
// server and Socket.IO before this same pool, via dbPool.end() — not here,
// to avoid two independent shutdown paths racing to call process.exit().
