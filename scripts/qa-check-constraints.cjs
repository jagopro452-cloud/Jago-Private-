const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`
  SELECT conname, contype, pg_get_constraintdef(oid) as def
  FROM pg_constraint
  WHERE conrelid = $1::regclass
`, [process.argv[2]]).then(r => { console.log(r.rows); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
