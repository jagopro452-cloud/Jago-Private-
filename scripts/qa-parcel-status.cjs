const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`SELECT id, current_status, current_drop_index, payment_status, driver_earnings FROM parcel_orders WHERE id=$1::uuid`, [process.argv[2]])
  .then(r => { console.log(JSON.stringify(r.rows[0], null, 2)); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
