const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const r = await pool.query(
      `SELECT
      cp.id AS payment_id,
      cp.razorpay_payment_id,
      cp.booking_intent_id,
      bi.status,
      bi.recovery_attempts,
      bi.recovery_error,
      bi.created_at,
      bi.updated_at
    FROM customer_payments cp
    JOIN booking_intents bi ON bi.id = cp.booking_intent_id
    WHERE cp.customer_id = $1::uuid
      AND cp.payment_type = 'ride_payment'
      AND cp.status = 'completed'
      AND cp.trip_id IS NULL
      AND bi.trip_id IS NULL
      AND bi.status IN (
        'payment_verified',
        'booking_in_progress',
        'recovery_failed',
        'recovery_pending'
      )
    ORDER BY bi.updated_at DESC
    LIMIT 1`,
      ['11a04380-15da-4c79-8ab8-83369dafdd58']
    );
    console.log('SUCCESS', r.rows.length);
  } catch (e) {
    console.error('REAL ERROR:', e.message);
    console.error('CODE:', e.code);
  }
  await pool.end();
}
run();
