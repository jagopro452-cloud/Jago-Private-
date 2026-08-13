#!/usr/bin/env node
/**
 * Migration safety checker.
 * Verifies SQL migrations are re-runnable by requiring IF NOT EXISTS on CREATE DDL.
 */
const fs = require("fs");
const path = require("path");

const MIGRATION_DIRS = [
  path.join(__dirname, "..", "migrations"),
  path.join(__dirname, "..", "server", "migrations"),
];

const UNSAFE_PATTERNS = [
  { re: /^\s*CREATE INDEX\s+(?!CONCURRENTLY\s+IF NOT EXISTS|IF NOT EXISTS)/im, label: "CREATE INDEX without IF NOT EXISTS" },
  { re: /^\s*CREATE UNIQUE INDEX\s+(?!CONCURRENTLY\s+IF NOT EXISTS|IF NOT EXISTS)/im, label: "CREATE UNIQUE INDEX without IF NOT EXISTS" },
  { re: /^\s*CREATE TABLE\s+(?!IF NOT EXISTS)/im, label: "CREATE TABLE without IF NOT EXISTS" },
  { re: /^\s*CREATE SEQUENCE\s+(?!IF NOT EXISTS)/im, label: "CREATE SEQUENCE without IF NOT EXISTS" },
  { re: /^\s*CREATE TYPE\s+(?!IF NOT EXISTS)/im, label: "CREATE TYPE without IF NOT EXISTS" },
];

let failed = false;
let checkedFileCount = 0;

for (const migrationsDir of MIGRATION_DIRS) {
  if (!fs.existsSync(migrationsDir)) continue;
  const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    checkedFileCount += 1;
    const fullPath = path.join(migrationsDir, file);
    const content = fs.readFileSync(fullPath, "utf8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith("--")) continue;

      for (const { re, label } of UNSAFE_PATTERNS) {
        if (re.test(line)) {
          console.error(`UNSAFE [${fullPath}:${i + 1}] ${label}`);
          console.error(`  > ${line.trim()}`);
          failed = true;
        }
      }
    }
  }
}

if (failed) {
  console.error("\nMigration safety check FAILED. Fix the unsafe DDL above before deploying.");
  process.exit(1);
}

console.log(`Migration safety check passed (${checkedFileCount} files checked)`);
