const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(
  `UPDATE trip_requests SET current_status='on_the_way', driver_id=$1::uuid, ride_started_at=NOW(), offered_driver_id=NULL, offer_expires_at=NULL WHERE id=$2::uuid RETURNING id, current_status`,
  [process.argv[2], process.argv[3]]
).then(r => { console.log(r.rows[0]); pool.end(); }).catch(e => { console.error(e.message); pool.end(); });
