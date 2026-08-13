const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`SELECT id, is_active, subscription_status, razorpay_payment_id, start_date, end_date FROM driver_subscriptions WHERE driver_id=$1::uuid ORDER BY created_at DESC`, [process.argv[2]])
  .then(r => { console.log(JSON.stringify(r.rows, null, 2)); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
