#!/usr/bin/env node
const path = require("node:path");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const { applySqlMigrationFile } = require("./lib/apply-sql-migration.cjs");

dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

// This file was renumbered out of the active migrations/ chain into the
// archive directory when the migration chain was reconciled to a single
// baseline (0000_baseline.sql); its contents are idempotent (IF NOT EXISTS /
// guarded DO $$ blocks) so pointing this backfill script at the archived
// copy keeps it a safe no-op if already applied, or a correct repair if not.
const sqlPath = path.resolve(__dirname, "../migrations_archive_2026-07-30/0010_financial_integrity_foundations.sql");
const force = process.env.FORCE_MIGRATION === "1" || process.env.FORCE_MIGRATION === "true";

async function schemaIncomplete(client) {
  const checks = await client.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='customer_payments' AND column_name='booking_intent_id'
      ) AS booking_intent_id,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='customer_payments' AND column_name='trip_id'
      ) AS trip_id,
      to_regclass('public.booking_intents') IS NOT NULL AS booking_intents
  `);
  const row = checks.rows[0];
  return !row.booking_intents || !row.booking_intent_id || !row.trip_id;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(JSON.stringify({ ok: false, error: "DATABASE_URL is required" }, null, 2));
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const needsRepair = force || (await schemaIncomplete(client));
    await client.query("BEGIN");
    const result = await applySqlMigrationFile(client, sqlPath, { force: needsRepair });
    await client.query("COMMIT");

    const checks = await client.query(`
      SELECT
        to_regclass('public.booking_intents') AS booking_intents,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='customer_payments' AND column_name='booking_intent_id'
        ) AS customer_payments_booking_intent_id,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='customer_payments' AND column_name='trip_id'
        ) AS customer_payments_trip_id
    `);

    console.log(
      JSON.stringify(
        {
          ok: true,
          migration: result,
          schema: checks.rows[0],
        },
        null,
        2,
      ),
    );
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
