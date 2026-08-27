// READ-ONLY diagnostic. Makes no writes — only SELECTs.
//
// Lists drivers whose users.verification_status is approved/verified but
// whose dispatch profile is broken, in two categories:
//   1. No driver_details row at all (the Satya / second-Vamsi pattern).
//   2. A driver_details row exists, but vehicle_category_id is NULL, or
//      points at a vehicle_categories row that no longer exists or is
//      inactive.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/diagnose-missing-driver-details.cjs
// or, if server/.env already has DATABASE_URL set:
//   node scripts/diagnose-missing-driver-details.cjs
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', 'server', '.env') });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    const missing = await pool.query(`
      SELECT u.id AS user_id, u.full_name, u.vehicle_number, u.vehicle_model,
             u.verification_status, u.is_active, u.created_at
      FROM users u
      LEFT JOIN driver_details dd ON dd.user_id = u.id
      WHERE u.user_type = 'driver'
        AND u.verification_status IN ('approved', 'verified')
        AND dd.user_id IS NULL
      ORDER BY u.created_at DESC
    `);

    const invalidCategory = await pool.query(`
      SELECT u.id AS user_id, u.full_name, u.vehicle_number, u.vehicle_model,
             u.verification_status, u.is_active,
             dd.vehicle_category_id, dd.approval_state,
             vc.name AS category_name, vc.vehicle_type, vc.service_type,
             vc.is_active AS category_active
      FROM users u
      JOIN driver_details dd ON dd.user_id = u.id
      LEFT JOIN vehicle_categories vc ON vc.id = dd.vehicle_category_id
      WHERE u.user_type = 'driver'
        AND u.verification_status IN ('approved', 'verified')
        AND (dd.vehicle_category_id IS NULL OR vc.id IS NULL OR vc.is_active IS NOT TRUE)
      ORDER BY u.created_at DESC
    `);

    console.log(`\n=== Approved drivers with NO driver_details row (${missing.rows.length}) ===`);
    if (missing.rows.length) {
      console.table(missing.rows.map((r) => ({
        user_id: r.user_id,
        name: r.full_name,
        vehicle_number: r.vehicle_number,
        vehicle_model: r.vehicle_model,
        verification_status: r.verification_status,
        active: r.is_active,
        created_at: r.created_at,
      })));
    } else {
      console.log('(none)');
    }

    console.log(`\n=== Approved drivers with driver_details but NULL/missing/inactive vehicle category (${invalidCategory.rows.length}) ===`);
    if (invalidCategory.rows.length) {
      console.table(invalidCategory.rows.map((r) => ({
        user_id: r.user_id,
        name: r.full_name,
        vehicle_number: r.vehicle_number,
        vehicle_category_id: r.vehicle_category_id,
        category_name: r.category_name,
        vehicle_type: r.vehicle_type,
        service_type: r.service_type,
        category_active: r.category_active,
        approval_state: r.approval_state,
      })));
    } else {
      console.log('(none)');
    }

    console.log(`\nTotal broken drivers: ${missing.rows.length + invalidCategory.rows.length}`);
    console.log('Read-only report — no rows were modified.\n');
  } catch (e) {
    console.error('Query failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
