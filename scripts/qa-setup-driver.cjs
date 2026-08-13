const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const driverId = process.argv[2];
  if (!driverId) throw new Error('usage: node qa-setup-driver.cjs <driverId>');

  await pool.query(
    `UPDATE users SET
       verification_status='approved',
       revenue_model='commission',
       model_selected_at=NOW(),
       vehicle_model='Test Sedan',
       vehicle_number='TS09QA1234',
       is_active=true,
       is_locked=false,
       current_trip_id=NULL
     WHERE id=$1::uuid`,
    [driverId]
  );

  await pool.query(
    `INSERT INTO driver_locations (driver_id, lat, lng, is_online, updated_at)
     VALUES ($1::uuid, 17.3850, 78.4867, true, NOW())
     ON CONFLICT (driver_id) DO UPDATE SET lat=17.3850, lng=78.4867, is_online=true, updated_at=NOW()`,
    [driverId]
  );

  await pool.query(
    `INSERT INTO driver_details (user_id, vehicle_category_id, vehicle_type, availability_status, approval_state, is_online, service_eligibility, city_eligibility, parcel_eligibility, pool_eligibility, outstation_eligibility, intercity_eligibility)
     VALUES ($1::uuid, $2::uuid, 'sedan', 'available', 'approved', true, ARRAY['normal','parcel_delivery','city_pool','outstation_pool','outstation','intercity_pool','intercity'], ARRAY['*'], true, true, true, true)
     ON CONFLICT (user_id) DO UPDATE SET vehicle_category_id=$2::uuid, vehicle_type='sedan', availability_status='available', approval_state='approved', is_online=true,
       service_eligibility=ARRAY['normal','parcel_delivery','city_pool','outstation_pool','outstation','intercity_pool','intercity'], parcel_eligibility=true, pool_eligibility=true, outstation_eligibility=true, intercity_eligibility=true`,
    [driverId, '20fbf3c2-e80a-4a53-af7b-f5393af4268c']
  );

  console.log('Driver set up for QA testing:', driverId);
  await pool.end();
}

run().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
