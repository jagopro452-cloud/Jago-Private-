const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`SELECT id, current_status, driver_id, offered_driver_id, offer_expires_at, driver_accepted_at, updated_at FROM trip_requests WHERE id=$1::uuid`, [process.argv[2]])
  .then(r => { console.log(JSON.stringify(r.rows[0], null, 2)); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
