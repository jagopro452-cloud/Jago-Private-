const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename=$1`, [process.argv[2]])
  .then(r => { console.log(r.rows.map(x=>x.indexdef).join('\n')); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
