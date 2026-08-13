const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`SELECT COUNT(*) as cnt FROM transactions WHERE user_id=$1::uuid`, [process.argv[2]])
  .then(r => { console.log('transactions rows for driver:', r.rows[0].cnt); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
