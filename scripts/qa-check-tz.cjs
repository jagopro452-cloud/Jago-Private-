const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`SHOW timezone; `).then(r=>{console.log('timezone:', r.rows[0]);
  return pool.query(`SELECT NOW() as db_now, CURRENT_DATE as db_date`);
}).then(r2=>{console.log(r2.rows[0]); pool.end();}).catch(e=>{console.error(e.message);pool.end();});
