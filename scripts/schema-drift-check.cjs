#!/usr/bin/env node
const { Client } = require("pg");
const fs = require("node:fs");
const path = require("node:path");

const PROD_DATABASE_URL = process.env.PROD_DATABASE_URL || process.env.PRODUCTION_DATABASE_URL;
const STAGING_DATABASE_URL = process.env.STAGING_DATABASE_URL;

if (!PROD_DATABASE_URL || !STAGING_DATABASE_URL) {
  console.error("Missing PROD_DATABASE_URL or STAGING_DATABASE_URL");
  process.exit(1);
}

async function connect(connectionString) {
  const client = new Client({
    connectionString,
    ssl: connectionString.includes("sslmode=require") ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

// Full public-schema table list — previously a hardcoded 6-table array;
// now discovered live so drift coverage automatically includes every table,
// not just the ones someone remembered to add to a list.
async function loadTableNames(client) {
  const result = await client.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  );
  return result.rows.map((row) => row.table_name);
}

async function loadSchema(client, tables) {
  const columns = await client.query(
    `
      SELECT
        table_name,
        column_name,
        is_nullable,
        data_type,
        udt_name,
        column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position
    `,
    [tables],
  );

  const indexes = await client.query(
    `
      SELECT
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = ANY($1::text[])
      ORDER BY tablename, indexname
    `,
    [tables],
  );

  const fks = await client.query(
    `
      SELECT
        tc.table_name,
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = ANY($1::text[])
      ORDER BY tc.table_name, tc.constraint_name
    `,
    [tables],
  );

  return {
    columns: columns.rows,
    indexes: indexes.rows,
    fks: fks.rows,
  };
}

function byTable(rows, key = "table_name") {
  return rows.reduce((acc, row) => {
    const table = row[key];
    if (!acc[table]) acc[table] = [];
    acc[table].push(row);
    return acc;
  }, {});
}

function diffNamedCollections(prodRows, stagingRows, formatter) {
  const prodSet = new Set(prodRows.map(formatter));
  const stagingSet = new Set(stagingRows.map(formatter));
  const missingInStaging = [...prodSet].filter((item) => !stagingSet.has(item));
  const missingInProd = [...stagingSet].filter((item) => !prodSet.has(item));
  return { missingInStaging, missingInProd };
}

// ── Static (no DB connection) cross-checks against shared/schema.ts and the
// migration chain, so drift coverage isn't limited to a live prod/staging
// diff — it also catches a migration or typed table that never made it into
// the live database at all. ──────────────────────────────────────────────

function sqlFilesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".sql"));
}

function loadMigrationTableNames() {
  const repoRoot = path.resolve(__dirname, "..");
  const dirs = [path.join(repoRoot, "migrations"), path.join(repoRoot, "server", "migrations")];
  const names = new Set();
  for (const dir of dirs) {
    for (const file of sqlFilesIn(dir)) {
      let sql = fs.readFileSync(path.join(dir, file), "utf8");
      // Strip SQL single-line comments first — otherwise prose like
      // "no CREATE TABLE for their live shape exists" gets misparsed as a
      // real CREATE TABLE statement.
      sql = sql.replace(/^\s*--.*$/gm, "");
      const matches = sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?"?(\w+)"?/gi);
      for (const match of matches) names.add(match[1].toLowerCase());
    }
  }
  return names;
}

function loadTypedSchemaTableNames() {
  const schemaPath = path.resolve(__dirname, "..", "shared", "schema.ts");
  if (!fs.existsSync(schemaPath)) return new Set();
  const source = fs.readFileSync(schemaPath, "utf8");
  const names = new Set();
  const matches = source.matchAll(/pgTable\(\s*"(\w+)"/g);
  for (const match of matches) names.add(match[1].toLowerCase());
  return names;
}

async function main() {
  const prod = await connect(PROD_DATABASE_URL);
  const staging = await connect(STAGING_DATABASE_URL);

  try {
    const [prodTables, stagingTables] = await Promise.all([loadTableNames(prod), loadTableNames(staging)]);
    const allTables = [...new Set([...prodTables, ...stagingTables])].sort();
    const prodTableSet = new Set(prodTables);

    const report = [];

    const tableDiff = diffNamedCollections(
      prodTables.map((name) => ({ name })),
      stagingTables.map((name) => ({ name })),
      (row) => row.name,
    );
    if (tableDiff.missingInStaging.length || tableDiff.missingInProd.length) {
      report.push({ scope: "tables", ...tableDiff });
    }

    const [prodSchema, stagingSchema] = await Promise.all([
      loadSchema(prod, allTables),
      loadSchema(staging, allTables),
    ]);

    const prodColumns = byTable(prodSchema.columns);
    const stagingColumns = byTable(stagingSchema.columns);
    const prodIndexes = byTable(prodSchema.indexes, "tablename");
    const stagingIndexes = byTable(stagingSchema.indexes, "tablename");
    const prodFks = byTable(prodSchema.fks);
    const stagingFks = byTable(stagingSchema.fks);

    for (const table of allTables) {
      const colDiff = diffNamedCollections(
        prodColumns[table] || [],
        stagingColumns[table] || [],
        (row) => `${row.column_name}|${row.data_type}|${row.udt_name}|${row.is_nullable}|${row.column_default || ""}`,
      );
      const idxDiff = diffNamedCollections(
        prodIndexes[table] || [],
        stagingIndexes[table] || [],
        (row) => row.indexdef,
      );
      const fkDiff = diffNamedCollections(
        prodFks[table] || [],
        stagingFks[table] || [],
        (row) => `${row.constraint_name}|${row.column_name}|${row.foreign_table_name}|${row.foreign_column_name}`,
      );

      if (colDiff.missingInProd.length || colDiff.missingInStaging.length) {
        report.push({ scope: `columns:${table}`, ...colDiff });
      }
      if (idxDiff.missingInProd.length || idxDiff.missingInStaging.length) {
        report.push({ scope: `indexes:${table}`, ...idxDiff });
      }
      if (fkDiff.missingInProd.length || fkDiff.missingInStaging.length) {
        report.push({ scope: `foreign_keys:${table}`, ...fkDiff });
      }
    }

    // Static checks: migrations / shared/schema.ts vs the live prod database.
    const migrationTables = loadMigrationTableNames();
    const typedTables = loadTypedSchemaTableNames();

    const migrationsMissingInProd = [...migrationTables].filter((name) => !prodTableSet.has(name)).sort();
    if (migrationsMissingInProd.length) {
      report.push({ scope: "migrations_vs_prod", missingInProd: migrationsMissingInProd, missingInStaging: [] });
    }

    const typedMissingInProd = [...typedTables].filter((name) => !prodTableSet.has(name)).sort();
    if (typedMissingInProd.length) {
      report.push({ scope: "typed_schema_vs_prod", missingInProd: typedMissingInProd, missingInStaging: [] });
    }

    if (!report.length) {
      console.log(`Schema drift check passed: production and staging match across all ${allTables.length} tables; migrations and shared/schema.ts are fully present in production.`);
      return;
    }

    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  } finally {
    await Promise.allSettled([prod.end(), staging.end()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
