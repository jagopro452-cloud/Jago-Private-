-- Add attempt_count to otp_logs for brute force protection
ALTER TABLE otp_logs ADD COLUMN IF NOT EXISTS attempt_count INT DEFAULT 0;

-- Performance indexes for high-volume query patterns
-- trip_requests: most frequently queried table across all endpoints
CREATE INDEX IF NOT EXISTS idx_trip_requests_driver_id ON trip_requests(driver_id);
CREATE INDEX IF NOT EXISTS idx_trip_requests_customer_id ON trip_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_trip_requests_current_status ON trip_requests(current_status);
CREATE INDEX IF NOT EXISTS idx_trip_requests_status_created ON trip_requests(current_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_requests_driver_status ON trip_requests(driver_id, current_status);
CREATE INDEX IF NOT EXISTS idx_trip_requests_customer_status ON trip_requests(customer_id, current_status);
CREATE INDEX IF NOT EXISTS idx_trip_requests_created_at ON trip_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_requests_ref_id ON trip_requests(ref_id);

-- users: phone lookup is critical for auth
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_user_type ON users(user_type);
CREATE INDEX IF NOT EXISTS idx_users_user_type_active ON users(user_type, is_active);

-- driver_locations: real-time nearby driver queries (table created in migration 0001)
CREATE INDEX IF NOT EXISTS idx_driver_locations_driver_id ON driver_locations(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_locations_lat_lng ON driver_locations(lat, lng) WHERE is_online = true;

-- coupon_setups: code lookup
CREATE INDEX IF NOT EXISTS idx_coupon_setups_code ON coupon_setups(code);
CREATE INDEX IF NOT EXISTS idx_coupon_setups_active ON coupon_setups(is_active) WHERE is_active = true;
