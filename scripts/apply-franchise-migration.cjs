#!/usr/bin/env node
const path = require("node:path");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const { applySqlMigrationFile } = require("./lib/apply-sql-migration.cjs");

dotenv.config({ path: path.resolve(__dirname, "../.env"), override: true });

const sqlPath = path.resolve(__dirname, "../migrations_archive_2026-07-30/0017_franchise_core.sql");

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
       WHERE table_schema='public' AND table_name='franchisees'
       ORDER BY column_name`,
    );
    console.log(JSON.stringify({ ok: true, franchiseesColumns: cols.rows.map((r) => r.column_name) }, null, 2));
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
