const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function txA() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT * FROM users WHERE id='b1ab88cc-29ea-450a-ab12-ef43bc285737'::uuid FOR UPDATE");
    await new Promise(r => setTimeout(r, 500));
    await c.query("SELECT * FROM users WHERE id='11a04380-15da-4c79-8ab8-83369dafdd58'::uuid FOR UPDATE");
    await c.query('COMMIT');
    return 'A: committed';
  } catch (e) {
    await c.query('ROLLBACK').catch(()=>{});
    return 'A: ' + e.message;
  } finally { c.release(); }
}

async function txB() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT * FROM users WHERE id='11a04380-15da-4c79-8ab8-83369dafdd58'::uuid FOR UPDATE");
    await new Promise(r => setTimeout(r, 500));
    await c.query("SELECT * FROM users WHERE id='b1ab88cc-29ea-450a-ab12-ef43bc285737'::uuid FOR UPDATE");
    await c.query('COMMIT');
    return 'B: committed';
  } catch (e) {
    await c.query('ROLLBACK').catch(()=>{});
    return 'B: ' + e.message;
  } finally { c.release(); }
}

Promise.all([txA(), txB()]).then(r => { console.log(r); pool.end(); });
