const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function run() {
  const driverId = process.argv[2];
  const planId = process.argv[3];
  const orderId = 'order_QATEST' + Date.now();
  await pool.query(
    `INSERT INTO driver_payments (driver_id, amount, payment_type, razorpay_order_id, status, description, plan_id, payment_context)
     VALUES ($1::uuid, 234.82, 'subscription', $2, 'pending', 'QA test subscription order', $3::uuid, $4::jsonb)`,
    [driverId, orderId, planId, JSON.stringify({ planId, insurancePlanId: null, source: 'qa_test' })]
  );
  console.log('order_id:', orderId);
  await pool.end();
}
run().catch(e => { console.error(e.message); pool.end(); });
