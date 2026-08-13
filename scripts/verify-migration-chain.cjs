#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const dotenv = require("dotenv");
const { Client } = require("pg");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const parsed = new URL(databaseUrl);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
  throw new Error("Migration verification refuses to create test databases on a non-local PostgreSQL host");
}

const rootDir = path.resolve("migrations");
const serverDir = path.resolve("server", "migrations");

function sqlFiles(dir) {
  return fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
}

// Computed from the actual migration files on disk instead of a hardcoded
// literal, so this check can't silently drift out of sync as migrations are added.
const expectedMigrationCount = sqlFiles(rootDir).length + sqlFiles(serverDir).length;

function connectionUrl(databaseName) {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function ensureTracking(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS migrations (
    name text PRIMARY KEY,
    applied_at timestamp NOT NULL DEFAULT now()
  )`);
}

async function applyDirectory(client, dir, scope, skipBaseline) {
  await ensureTracking(client);
  for (const file of sqlFiles(dir)) {
    const name = `${scope}:${file}`;
    const found = await client.query("SELECT 1 FROM migrations WHERE name=$1 LIMIT 1", [name]);
    if (found.rowCount) continue;
    if (scope === "root" && file === "0000_baseline.sql" && skipBaseline) {
      await client.query("INSERT INTO migrations(name) VALUES($1)", [name]);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), "utf8").replace(/^\uFEFF/, "").replace(/\0/g, "");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO migrations(name) VALUES($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`${name}: ${error.message}`);
    }
  }
}

async function applyAuthoritativeChain(client) {
  const schema = await client.query("SELECT to_regclass('public.users') AS users_table");
  const existing = Boolean(schema.rows[0].users_table);
  await applyDirectory(client, rootDir, "root", existing);
  await applyDirectory(client, serverDir, "server", false);
}

async function verifyState(client, label) {
  const migrations = await client.query("SELECT COUNT(*)::int AS count FROM migrations");
  if (migrations.rows[0].count !== expectedMigrationCount) {
    throw new Error(`${label}: expected ${expectedMigrationCount} migration records, got ${migrations.rows[0].count}`);
  }
  const objects = await client.query(`
    SELECT
      to_regclass('public.users') AS users,
      to_regclass('public.trip_requests') AS trips,
      to_regclass('public.outbox_events') AS outbox,
      to_regclass('public.idx_one_active_trip_per_customer') AS customer_guard,
      to_regclass('public.idx_one_active_trip_per_driver') AS driver_guard
  `);
  for (const [key, value] of Object.entries(objects.rows[0])) {
    if (!value) throw new Error(`${label}: required schema object missing: ${key}`);
  }
}

async function withTemporaryDatabase(admin, label, operation) {
  const dbName = `jago_migration_verify_${label}_${crypto.randomBytes(4).toString("hex")}`;
  if (!/^jago_migration_verify_[a-z]+_[0-9a-f]{8}$/.test(dbName)) throw new Error("Unsafe temporary database name");
  await admin.query(`CREATE DATABASE "${dbName}"`);
  const client = new Client({ connectionString: connectionUrl(dbName) });
  try {
    await client.connect();
    await operation(client);
  } finally {
    await client.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  }
}

async function main() {
  const adminUrl = connectionUrl("postgres");
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await withTemporaryDatabase(admin, "fresh", async (client) => {
      await applyAuthoritativeChain(client);
      await verifyState(client, "fresh replay");
      await applyAuthoritativeChain(client);
      await verifyState(client, "idempotent replay");
    });
    await withTemporaryDatabase(admin, "upgrade", async (client) => {
      await client.query(fs.readFileSync(path.join(rootDir, "0000_baseline.sql"), "utf8"));
      await applyAuthoritativeChain(client);
      await verifyState(client, "existing database upgrade");
    });
  } finally {
    await admin.end();
  }
  console.log("Migration verification passed: fresh, idempotent replay, and existing-schema upgrade");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
