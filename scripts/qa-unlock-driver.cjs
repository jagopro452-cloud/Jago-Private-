const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`UPDATE users SET is_locked=false, lock_reason=NULL, wallet_balance=500 WHERE id=$1::uuid RETURNING wallet_balance, is_locked`, [process.argv[2]])
  .then(r => { console.log(r.rows[0]); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
