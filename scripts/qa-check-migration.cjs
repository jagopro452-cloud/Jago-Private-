const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`SELECT name, applied_at FROM migrations WHERE name LIKE $1 ORDER BY applied_at`, [process.argv[2] || '%'])
  .then(r => { console.log(r.rows.map(x=>`${x.name} @ ${x.applied_at}`).join('\n')); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
