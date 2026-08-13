const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function splitStatements(sql) {
  // Strip line comments, then split on semicolons at statement boundaries.
  // Good enough for this migrations folder — no semicolons inside string literals here.
  const noComments = sql.replace(/--.*$/gm, '');
  return noComments
    .split(';')
    .map(s => s.trim())
    .filter(Boolean);
}

async function run() {
  const dir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let failCount = 0;
  let okCount = 0;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const statements = splitStatements(sql);
    for (const stmt of statements) {
      try {
        await client.query(stmt);
        okCount++;
      } catch (e) {
        failCount++;
        console.error(`FAILED [${file}]: ${e.message}\n  stmt: ${stmt.slice(0, 120).replace(/\n/g, ' ')}`);
      }
    }
  }
  console.log(`Ran ${okCount} statements OK, ${failCount} failed, across ${files.length} files.`);
  await client.end();
}
run().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
