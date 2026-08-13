const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`
  SELECT ds.id, ds.plan_id, ds.is_active, sp.id as plan_exists
  FROM driver_subscriptions ds
  LEFT JOIN subscription_plans sp ON sp.id = ds.plan_id
  WHERE ds.plan_id = $1::uuid
`, [process.argv[2]]).then(r => { console.log(JSON.stringify(r.rows, null, 2)); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
