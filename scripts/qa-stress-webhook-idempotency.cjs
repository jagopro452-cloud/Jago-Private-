const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function attempt(eventId) {
  try {
    const r = await pool.query(
      `INSERT INTO razorpay_webhook_logs (event_id, event_type, payload, processed)
       VALUES ($1, $2, $3::jsonb, false)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      [eventId, 'payment.captured', JSON.stringify({ test: true })]
    );
    return r.rows.length > 0; // true = this attempt "won" and would process the event
  } catch (e) {
    return { error: e.message };
  }
}

async function run() {
  const N = parseInt(process.argv[2] || '25', 10);
  const eventId = 'evt_stress_' + Date.now();
  const results = await Promise.all(Array.from({ length: N }, () => attempt(eventId)));
  const winners = results.filter(r => r === true).length;
  const losers = results.filter(r => r === false).length;
  const errors = results.filter(r => typeof r === 'object').length;
  console.log(`N=${N} winners(would-process)=${winners} losers(duplicate-skipped)=${losers} errors=${errors}`);
  await pool.end();
}
run();
