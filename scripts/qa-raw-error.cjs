const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`
  INSERT INTO driver_subscriptions (driver_id, plan_id, start_date, end_date, payment_amount, plan_base_price, gst_amount, insurance_amount, insurance_plan_id, payment_status, is_active, razorpay_payment_id, razorpay_order_id, subscription_status)
  VALUES ($1::uuid,$2::uuid,'2026-07-25','2026-08-01',234.82,199,35.82,0,NULL,'paid',true,$3,$4,'active')
  ON CONFLICT (razorpay_payment_id) DO UPDATE SET is_active=true
`, ['b1ab88cc-29ea-450a-ab12-ef43bc285737','c967876f-4c99-4049-b218-c541dc2795d8','pay_RAW123','order_RAW123'])
  .then(()=>{console.log('SUCCESS');pool.end();})
  .catch(e=>{console.error('CODE:',e.code, 'MESSAGE:', e.message); pool.end();});
