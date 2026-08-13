#!/usr/bin/env node
/**
 * Deep production/staging schema + API readiness audit (read-only unless APPLY_* env set).
 */
const path = require("node:path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });
dotenv.config({ path: path.resolve(__dirname, "../.env.playwright.local"), override: true });

const API_BASE = (process.env.PROD_API_BASE || "http://15.207.65.184:5000").replace(/\/$/, "");

async function probeApi(name, pathname, headers = {}) {
  try {
    const res = await fetch(`${API_BASE}${pathname}`, { headers });
    const text = await res.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    return { name, status: res.status, ok: res.ok, body };
  } catch (err) {
    return { name, status: 0, ok: false, error: err.message };
  }
}

async function auditDatabase(connectionString, label) {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    const row = (await client.query(`
      SELECT
        to_regclass('public.booking_intents') IS NOT NULL AS booking_intents,
        to_regclass('public.payment_recovery_events') IS NOT NULL AS payment_recovery_events,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='customer_payments' AND column_name='trip_id'
        ) AS customer_payments_trip_id,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='customer_payments' AND column_name='booking_intent_id'
        ) AS customer_payments_booking_intent_id,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='booking_intents' AND column_name='recovery_attempts'
        ) AS booking_intents_recovery_attempts,
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname='public' AND tablename='parcel_orders' AND indexname='idx_one_active_parcel_per_customer'
        ) AS h6_parcel_index
    `)).rows[0];

    let migrations = [];
    const migTable = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='migrations' LIMIT 1`,
    );
    if (migTable.rowCount) {
      const mig = await client.query(
        `SELECT name FROM migrations
         WHERE name IN (
           '0010_financial_integrity_foundations.sql',
           '0018_parcel_active_booking_hardening.sql',
           '0019_payment_orphan_recovery.sql'
         )
         ORDER BY name`,
      );
      migrations = mig.rows.map((r) => r.name);
    }

    return {
      label,
      host: (() => {
        try {
          return new URL(connectionString).hostname;
        } catch {
          return "invalid";
        }
      })(),
      schema: row,
      appliedMigrations: migrations,
      migration0010: migrations.includes("0010_financial_integrity_foundations.sql"),
      migration0018: migrations.includes("0018_parcel_active_booking_hardening.sql"),
      migration0019: migrations.includes("0019_payment_orphan_recovery.sql"),
    };
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const report = {
    ts: new Date().toISOString(),
    apiBase: API_BASE,
    api: [],
    database: null,
    blockers: [],
    score: 0,
  };

  const probes = [
    ["/api/health", {}],
    ["/api/version", {}],
    ["/api/app/customer/ride/pending-recovery", {}],
    ["/api/ops/seed-test-accounts?key=test", {}],
  ];

  for (const [pathname, headers] of probes) {
    report.api.push(await probeApi(pathname, pathname, headers));
  }

  const health = report.api.find((p) => p.name === "/api/health");
  const pending = report.api.find((p) => p.name === "/api/app/customer/ride/pending-recovery");

  if (!health?.ok) report.blockers.push("Production API health check failed");
  if (pending?.status === 404) report.blockers.push("H1 pending-recovery route not deployed (404)");
  if (pending?.status === 401) {
    report.h1RouteDeployed = true;
  }

  if (process.env.DATABASE_URL) {
    try {
      report.database = await auditDatabase(process.env.DATABASE_URL, "configured");
      if (!report.database.schema.booking_intents) report.blockers.push("Migration 0010 not applied: booking_intents missing");
      if (!report.database.schema.customer_payments_booking_intent_id) report.blockers.push("Migration 0010 not applied: customer_payments.booking_intent_id missing");
      if (!report.database.schema.payment_recovery_events) report.blockers.push("Migration 0019 not applied: payment_recovery_events missing");
      if (!report.database.schema.booking_intents_recovery_attempts) report.blockers.push("Migration 0019 not applied: recovery columns missing");
    } catch (err) {
      report.database = { error: err.message };
      report.blockers.push(`Database audit failed: ${err.message}`);
    }
  } else {
    report.blockers.push("DATABASE_URL not set — cannot audit Neon schema from this machine");
  }

  let score = 0;
  if (health?.ok) score += 15;
  if (pending?.status === 401 || pending?.status === 200) score += 20;
  if (report.database?.schema?.booking_intents) score += 20;
  if (report.database?.schema?.payment_recovery_events) score += 15;
  if (report.database?.schema?.h6_parcel_index) score += 10;
  if (report.database?.migration0010) score += 10;
  if (report.database?.migration0019) score += 10;
  report.score = score;

  report.verdict =
    score >= 85 ? "PRODUCTION READY" : score >= 65 ? "SOFT LAUNCH READY" : "NOT READY";

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.blockers.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
