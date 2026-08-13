const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const r = await pool.query(
      `SELECT opr.*,
          u.full_name as driver_name, u.phone as driver_phone,
          dd.avg_rating as driver_rating, dd.vehicle_number, dd.vehicle_model,
          COALESCE(vc.name, '') as vehicle_category_name,
          COALESCE(vc.vehicle_type, '') as vehicle_type,
          COUNT(opb.id) FILTER (WHERE opb.status != 'cancelled')::int as booked_count
        FROM outstation_pool_rides opr
        JOIN users u ON u.id = opr.driver_id
        LEFT JOIN driver_details dd ON dd.user_id = opr.driver_id
        LEFT JOIN vehicle_categories vc ON vc.id = opr.vehicle_category_id
        LEFT JOIN outstation_pool_bookings opb ON opb.ride_id = opr.id
        WHERE opr.is_active = true
          AND opr.status IN ('scheduled', 'active')
          AND opr.accepting_new_requests = true
          AND opr.available_seats >= $1
          AND LOWER(opr.from_city) LIKE LOWER($2)
          AND LOWER(opr.to_city) LIKE LOWER($3)
        GROUP BY opr.id, u.full_name, u.phone, dd.avg_rating, dd.vehicle_number, dd.vehicle_model, vc.name, vc.vehicle_type
        ORDER BY opr.departure_date ASC, opr.departure_time ASC
        LIMIT 20`,
      [1, '%Hyderabad%', '%Vijayawada%']
    );
    console.log('SUCCESS', r.rows.length);
  } catch (e) {
    console.error('REAL ERROR:', e.message);
    console.error('CODE:', e.code);
  }
  await pool.end();
}
run();
