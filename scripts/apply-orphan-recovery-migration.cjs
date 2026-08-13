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
const sqlPath = path.resolve(__dirname, "../migrations_archive_2026-07-30/0019_payment_orphan_recovery.sql");
const force = process.env.FORCE_MIGRATION === "1" || process.env.FORCE_MIGRATION === "true";

async function schemaIncomplete(client) {
  const checks = await client.query(`
    SELECT
      to_regclass('public.payment_recovery_events') IS NOT NULL AS payment_recovery_events,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='booking_intents' AND column_name='recovery_attempts'
      ) AS recovery_attempts
  `);
  const row = checks.rows[0];
  return !row.payment_recovery_events || !row.recovery_attempts;
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
    await applySqlMigrationFile(client, sqlPath, { force: needsRepair });
    await client.query("COMMIT");
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='booking_intents'
         AND column_name IN ('recovery_attempts','last_recovery_at','recovered_at','recovery_error')
       ORDER BY column_name`,
    );
    const table = await client.query(
      `SELECT to_regclass('public.payment_recovery_events') AS tbl`,
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          recoveryColumns: cols.rows.map((r) => r.column_name),
          paymentRecoveryEventsTable: table.rows[0]?.tbl || null,
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
