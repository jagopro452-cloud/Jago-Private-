const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`UPDATE driver_details SET vehicle_category_id=$1::uuid WHERE user_id=$2::uuid RETURNING vehicle_category_id`, [process.argv[3], process.argv[2]])
  .then(r => { console.log(r.rows[0]); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
