import fs from "node:fs";

const raw = fs.readFileSync("schema_dump_current.sql", "utf8");
const lines = raw.split("\n");

const kept = [];
for (const line of lines) {
  const trimmed = line.trim();
  if (trimmed.startsWith("\\restrict") || trimmed.startsWith("\\unrestrict")) continue;
  if (trimmed.startsWith("SET ")) continue;
  if (trimmed.startsWith("SELECT pg_catalog.set_config")) continue;
  if (trimmed.startsWith("--")) continue;
  kept.push(line);
}

// Collapse runs of blank lines, then split into statements on lines that are exactly ";"
// pg_dump emits each statement ending with a lone ";" line in many cases, but simpler:
// join everything, then split on ";\n" occurring at column 0 after a newline (top-level).
let sql = kept.join("\n");

// Normalize excessive blank lines
sql = sql.replace(/\n{3,}/g, "\n\n");

// Split into individual statements by ";\n" (safe here: no functions/triggers/dollar-quoting in this dump)
const rawStatements = sql.split(/;\s*\n/);
const statements = rawStatements
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && s !== "");

const out = statements.map((s) => s + ";").join("\n--> statement-breakpoint\n");
fs.writeFileSync("migrations/0000_baseline.sql", out + "\n");
console.log("statements:", statements.length);
