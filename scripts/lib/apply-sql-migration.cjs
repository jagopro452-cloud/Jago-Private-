#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

/**
 * Execute a migration SQL file as a single statement (required for DO $$ blocks).
 * Optionally records the file in public.migrations when the table exists.
 */
async function applySqlMigrationFile(client, sqlPath, { recordName, force = false } = {}) {
  const sql = fs.readFileSync(sqlPath, "utf8").trim();
  if (!sql) {
    throw new Error(`Migration file is empty: ${sqlPath}`);
  }

  const migrationName = recordName || path.basename(sqlPath);
  const tableExists = await client.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema='public' AND table_name='migrations'
     LIMIT 1`,
  );

  if (!force && tableExists.rowCount) {
    const existing = await client.query(
      "SELECT 1 FROM migrations WHERE name = $1 LIMIT 1",
      [migrationName],
    );
    if (existing.rowCount) {
      return { applied: false, skipped: true, name: migrationName };
    }
  }

  await client.query(sql);

  if (tableExists.rowCount) {
    await client.query(
      "INSERT INTO migrations (name, applied_at) VALUES ($1, NOW()) ON CONFLICT (name) DO NOTHING",
      [migrationName],
    );
  }

  return { applied: true, skipped: false, name: migrationName, forced: force };
}

module.exports = { applySqlMigrationFile };
