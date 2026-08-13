const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`SELECT drop_locations FROM parcel_orders WHERE id=$1::uuid`, [process.argv[2]])
  .then(r => { console.log(JSON.stringify(r.rows[0].drop_locations)); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
