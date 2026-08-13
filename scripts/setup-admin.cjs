#!/usr/bin/env node

/**
 * Direct Admin Creation Script
 * Fast-tracks admin setup without server startup
 * Use: Copy to production server and run: node setup-admin.cjs
 */

const pg = require('pg');
const bcrypt = require('bcryptjs');

const { Pool } = pg;

// Get DATABASE_URL from environment
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('❌ DATABASE_URL not set. Set it in environment first.');
  process.exit(1);
}

(async () => {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
    application_name: 'admin-setup',
  });

  try {
    console.log('🔧 Creating admin account...\n');

    // Step 1: Create admins table
    console.log('📋 Step 1: Ensuring admins table exists...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(191) NOT NULL UNIQUE,
        password VARCHAR(191) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'admin',
        is_active BOOLEAN NOT NULL DEFAULT true,
        auth_token VARCHAR(255),
        auth_token_expires_at TIMESTAMP WITH TIME ZONE,
        last_login_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    console.log('✅ admins table ready\n');

    // Step 2: Create indexes
    console.log('📋 Step 2: Creating indexes...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(LOWER(email))
    `).catch(() => {});
    console.log('✅ Indexes created\n');

    // Step 3: Create admin_login_otp table
    console.log('📋 Step 3: Creating admin_login_otp table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_login_otp (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        otp VARCHAR(10) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        is_used BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `).catch(() => {});
    console.log('✅ admin_login_otp table ready\n');

    // Step 4: Get credentials from environment
    const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || '';
    const adminName = (process.env.ADMIN_NAME || 'Admin').trim() || 'Admin';
    if (!adminEmail || !adminPassword) {
      throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
    }

    console.log('👤 Admin Credentials:');
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Name: ${adminName}`);
    console.log('   Password: ***set***\n');

    // Step 5: Hash password using bcrypt 12 rounds (OWASP recommended)
    console.log('🔐 Step 4: Hashing password (bcrypt rounds: 12)...');
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    console.log('✅ Password hashed\n');

    // Step 6: Insert or update admin
    console.log('📝 Step 5: Upserting admin in database...');
    const result = await pool.query(
      `INSERT INTO admins (name, email, password, role, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (email)
       DO UPDATE SET password=$3, name=$1, is_active=true
       RETURNING id, email, name, role`,
      [adminName, adminEmail, passwordHash, 'admin']
    );

    const admin = result.rows[0];
    console.log('✅ Admin created/updated\n');

    console.log('🎉 SUCCESS! Admin account is ready:\n');
    console.log(`   ID: ${admin.id}`);
    console.log(`   Email: ${admin.email}`);
    console.log(`   Name: ${admin.name}`);
    console.log(`   Role: ${admin.role}\n`);

    console.log('🌐 You can now login at:');
    console.log('   https://jagopro.org/admin/auth/login\n');

    console.log('📧 Credentials:');
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Password: ${adminPassword}\n`);

    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
    await pool.end();
    process.exit(1);
  }
})();
