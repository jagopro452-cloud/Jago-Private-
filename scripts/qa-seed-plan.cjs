const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`INSERT INTO subscription_plans (name, price, duration_days, features, is_active, plan_type) VALUES ('QA Weekly', 199, 7, 'unlimited rides', true, 'both') RETURNING id`)
  .then(r => { console.log('plan_id:', r.rows[0].id); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
