const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const r = await pool.query(
      `SELECT t.*, c.full_name as customer_name, c.phone as customer_phone,
          vc.name as vehicle_name, vc.icon as vehicle_icon,
          ROUND(CAST(SQRT((t.pickup_lat - $1)*(t.pickup_lat - $2) + (t.pickup_lng - $3)*(t.pickup_lng - $4)) * 111 AS numeric), 1) as distance_km,
          CASE WHEN t.is_for_someone_else THEN t.passenger_name ELSE c.full_name END as contact_name,
          CASE WHEN t.is_for_someone_else THEN t.passenger_phone ELSE c.phone END as contact_phone
        FROM trip_requests t
        LEFT JOIN users c ON c.id = t.customer_id
        LEFT JOIN vehicle_categories vc ON vc.id = t.vehicle_category_id
        WHERE t.current_status = 'searching' AND t.driver_id IS NULL
          AND t.created_at > NOW() - INTERVAL '10 minutes'
          AND NOT ($5::uuid = ANY(COALESCE(t.rejected_driver_ids, '{}'::uuid[])))
          AND (t.offered_driver_id IS NULL OR t.offer_expires_at <= NOW())
          AND (t.pickup_lat - $6)*(t.pickup_lat - $7) + (t.pickup_lng - $8)*(t.pickup_lng - $9) < 0.02
        ORDER BY (t.pickup_lat - $10)*(t.pickup_lat - $11) + (t.pickup_lng - $12)*(t.pickup_lng - $13) ASC LIMIT 5`,
      [17.385, 17.385, 78.4867, 78.4867, 'b1ab88cc-29ea-450a-ab12-ef43bc285737', 17.385, 17.385, 78.4867, 78.4867, 17.385, 17.385, 78.4867, 78.4867]
    );
    console.log('SUCCESS', r.rows.length);
  } catch (e) {
    console.error('REAL ERROR:', e.message);
    console.error('CODE:', e.code);
    console.error('DETAIL:', e.detail);
    console.error('HINT:', e.hint);
    console.error('POSITION:', e.position);
  }
  await pool.end();
}
run();
