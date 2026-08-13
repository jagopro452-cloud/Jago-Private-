#!/usr/bin/env node
/**
 * Neon jago-production schema verify + optional migration apply.
 * Usage:
 *   node scripts/neon-production-ops.cjs verify
 *   node scripts/neon-production-ops.cjs apply
 */
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { Pool } = require("pg");
const { applySqlMigrationFile } = require("./lib/apply-sql-migration.cjs");

const PROJECT_ID = "floral-thunder-84852945";
const CRED_PATH = path.join(process.env.USERPROFILE || process.env.HOME || "", ".config", "neonctl", "credentials.json");

function request(method, url, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  const cred = JSON.parse(fs.readFileSync(CRED_PATH, "utf8"));
  if (cred.access_token) {
    const probe = await request(
      "GET",
      `https://console.neon.tech/api/v2/projects/${PROJECT_ID}`,
      { token: cred.access_token },
    );
    if (probe.status === 200) {
      return cred.access_token;
    }
  }
  const refreshed = await request(
    "POST",
    "https://oauth2.neon.tech/oauth2/token",
    {
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(cred.refresh_token)}&client_id=neonctl`,
    },
  );
  if (refreshed.status !== 200) {
    throw new Error(`Neon token refresh failed (${refreshed.status})`);
  }
  return JSON.parse(refreshed.body).access_token;
}

async function getConnectionString(token) {
  const res = await request(
    "GET",
    `https://console.neon.tech/api/v2/projects/${PROJECT_ID}/connection_uri?database_name=neondb&role_name=neondb_owner&pooled=true`,
    { token },
  );
  if (res.status !== 200) {
    throw new Error(`Neon connection_uri failed (${res.status}): ${res.body.slice(0, 200)}`);
  }
  return JSON.parse(res.body).uri;
}

async function auditSchema(client) {
  const result = await client.query(`
    SELECT
      to_regclass('public.booking_intents') IS NOT NULL AS booking_intents,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='customer_payments' AND column_name='booking_intent_id'
      ) AS customer_payments_booking_intent_id,
      to_regclass('public.payment_recovery_events') IS NOT NULL AS payment_recovery_events,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='booking_intents' AND column_name='recovery_attempts'
      ) AS booking_intents_recovery_attempts
  `);
  let migrations = [];
  const migTable = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='migrations' LIMIT 1`,
  );
  if (migTable.rowCount) {
    const mig = await client.query(
      `SELECT name FROM migrations
       WHERE name IN (
         '0010_financial_integrity_foundations.sql',
         '0019_payment_orphan_recovery.sql'
       ) ORDER BY name`,
    );
    migrations = mig.rows.map((r) => r.name);
  }
  return { schema: result.rows[0], migrations };
}

async function schemaIncomplete0010(schema) {
  return !schema.booking_intents || !schema.customer_payments_booking_intent_id;
}

async function schemaIncomplete0019(schema) {
  return !schema.payment_recovery_events || !schema.booking_intents_recovery_attempts;
}

async function main() {
  const mode = process.argv[2] || "verify";
  const token = await getAccessToken();
  const connectionString = await getConnectionString(token);
  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    const before = await auditSchema(client);
    const out = {
      ok: true,
      projectId: PROJECT_ID,
      host: new URL(connectionString).hostname,
      mode,
      before,
    };

    if (mode === "apply") {
      const m0010 = path.resolve(__dirname, "../migrations_archive_2026-07-30/0010_financial_integrity_foundations.sql");
      const m0019 = path.resolve(__dirname, "../migrations_archive_2026-07-30/0019_payment_orphan_recovery.sql");

      await client.query("BEGIN");
      if (await schemaIncomplete0010(before.schema)) {
        out.m0010 = await applySqlMigrationFile(client, m0010, {
          force: await schemaIncomplete0010(before.schema),
        });
      } else {
        out.m0010 = { skipped: true, reason: "schema_complete" };
      }
      const mid = await auditSchema(client);
      if (await schemaIncomplete0019(mid.schema)) {
        out.m0019 = await applySqlMigrationFile(client, m0019, {
          force: await schemaIncomplete0019(mid.schema),
        });
      } else {
        out.m0019 = { skipped: true, reason: "schema_complete" };
      }
      await client.query("COMMIT");
      out.after = await auditSchema(client);
    }

    const s = (mode === "apply" ? out.after?.schema : before.schema) || before.schema;
    out.ready =
      Boolean(s.booking_intents) &&
      Boolean(s.customer_payments_booking_intent_id) &&
      Boolean(s.payment_recovery_events);

    console.log(JSON.stringify(out, null, 2));
    process.exitCode = out.ready ? 0 : 1;
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
