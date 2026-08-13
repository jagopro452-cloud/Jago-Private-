const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const driverId = process.argv[2];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT wallet_balance FROM users WHERE id=$1::uuid FOR UPDATE', [driverId]);
    console.log('rows found:', r.rows.length, r.rows);
    await client.query('ROLLBACK');
  } catch (e) {
    console.error('ERROR:', e.message, e.code);
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release();
  }
  await pool.end();
}
run();
