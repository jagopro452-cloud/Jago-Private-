const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`SELECT current_trip_id, is_online, is_locked, verification_status FROM users WHERE id=$1::uuid`, [process.argv[2]])
  .then(r => { console.log(r.rows[0]); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
