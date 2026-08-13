const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY column_name`, [process.argv[2]])
  .then(r => { console.log(r.rows.map(x=>`${x.column_name}: ${x.data_type}`).join('\n')); pool.end(); })
  .catch(e => { console.error(e.message); pool.end(); });
