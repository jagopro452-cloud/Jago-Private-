const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id=$2::uuid RETURNING wallet_balance`, [process.argv[3], process.argv[2]])
  .then(r => { console.log('new balance:', r.rows[0].wallet_balance); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
