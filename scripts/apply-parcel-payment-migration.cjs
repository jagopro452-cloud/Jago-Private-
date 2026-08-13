#!/usr/bin/env node
const path = require("node:path");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const { applySqlMigrationFile } = require("./lib/apply-sql-migration.cjs");

dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

const sqlPath = path.resolve(__dirname, "../migrations_archive_2026-07-30/0020_parcel_payment_status.sql");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(JSON.stringify({ ok: false, error: "DATABASE_URL is required" }, null, 2));
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await applySqlMigrationFile(client, sqlPath);
    await client.query("COMMIT");
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='parcel_orders' AND column_name='payment_status'`,
    );
    console.log(JSON.stringify({
      ok: true,
      paymentStatusColumn: cols.rows.length > 0,
    }, null, 2));
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
