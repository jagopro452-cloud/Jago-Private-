-- Migration: Add critical hardening tables and columns
-- Date: March 24, 2026
-- Purpose: No-shows, logs, healthchecks, retry tracking

-- 1. DRIVER NO-SHOW TRACKING
CREATE TABLE IF NOT EXISTS driver_no_shows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES users(id),
  trip_id UUID NOT NULL,
  reason VARCHAR(120),  -- 'not_at_location', 'offline', 'cancelled'
  penalty_amount NUMERIC(10,2) DEFAULT 0,
  rating_deduction NUMERIC(3,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_no_shows_driver ON driver_no_shows(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_no_shows_created ON driver_no_shows(created_at);

-- 2. CUSTOMER NO-SHOW TRACKING
CREATE TABLE IF NOT EXISTS customer_no_shows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id),
  trip_id UUID NOT NULL,
  reason VARCHAR(120),
  charge_amount NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_no_shows_customer ON customer_no_shows(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_no_shows_created ON customer_no_shows(created_at);

-- 3. SYSTEM HEALTH & LOGS
CREATE TABLE IF NOT EXISTS system_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level VARCHAR(20) NOT NULL,  -- 'INFO', 'WARN', 'ERROR', 'CRITICAL'
  tag VARCHAR(80) NOT NULL,    -- 'DISPATCH', 'PAYMENT', 'FCM', etc.
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level);
CREATE INDEX IF NOT EXISTS idx_system_logs_tag ON system_logs(tag);
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at);

-- 4. NOTIFICATION DELIVERY TRACKING
CREATE TABLE IF NOT EXISTS notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID REFERENCES users(id),
  customer_id UUID REFERENCES users(id),
  trip_id UUID,
  notification_type VARCHAR(50) NOT NULL,  -- 'trip_offer', 'trip_update', 'booking_confirmation'
  fcm_token VARCHAR(255),
  fcm_result VARCHAR(30) DEFAULT 'pending',  -- 'sent', 'failed', 'retried'
  attempt_count INTEGER DEFAULT 1,
  max_retries INTEGER DEFAULT 3,
  error_message TEXT,
  sent_at TIMESTAMP,
  delivery_confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_driver ON notification_logs(driver_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_trip ON notification_logs(trip_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_result ON notification_logs(fcm_result);

-- 5. DISPATCH SESSION TRACKING (for debugging timeouts)
CREATE TABLE IF NOT EXISTS dispatch_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL UNIQUE,
  customer_id UUID NOT NULL,
  status VARCHAR(50) NOT NULL,  -- 'searching', 'offered', 'accepted', 'timeout', 'cancelled'
  drivers_contacted INTEGER DEFAULT 0,
  drivers_rejected INTEGER DEFAULT 0,
  final_driver_id UUID,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  total_duration_ms INTEGER,
  error_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_sessions_trip ON dispatch_sessions(trip_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_sessions_status ON dispatch_sessions(status);
CREATE INDEX IF NOT EXISTS idx_dispatch_sessions_customer ON dispatch_sessions(customer_id);

-- 6. ADD COLUMNS TO TRIP_REQUESTS FOR HARDENING
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS 
  driver_ping_verified_at TIMESTAMP;  -- When driver last pinged back
  
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS 
  auto_timeout_at TIMESTAMP;  -- When auto-timeout should trigger (2 min after creation)
  
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS 
  auto_cancelled BOOLEAN DEFAULT false;
  
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS 
  cancellation_reason VARCHAR(120);
  
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS 
  customer_no_show_count INTEGER DEFAULT 0;
  
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS 
  driver_no_show_count INTEGER DEFAULT 0;

-- 7. ADD COLUMNS TO USERS FOR PENALTY TRACKING
ALTER TABLE users ADD COLUMN IF NOT EXISTS 
  recent_no_shows_30d INTEGER DEFAULT 0;  -- Count in last 30 days
  
ALTER TABLE users ADD COLUMN IF NOT EXISTS 
  is_banned_for_no_show BOOLEAN DEFAULT false;
  
ALTER TABLE users ADD COLUMN IF NOT EXISTS 
  ban_reason TEXT;
  
ALTER TABLE users ADD COLUMN IF NOT EXISTS 
  ban_until TIMESTAMP;

-- 8. OUTSTATION POOL ADDITIONS (auto-cancel tracking)
ALTER TABLE outstation_pool_rides ADD COLUMN IF NOT EXISTS 
  auto_cancelled_at TIMESTAMP;
  
ALTER TABLE outstation_pool_rides ADD COLUMN IF NOT EXISTS 
  auto_cancel_reason VARCHAR(120);

ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS 
  refund_processed_at TIMESTAMP;
  
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS 
  refund_amount NUMERIC(10,2) DEFAULT 0;

-- 9. APPLICATION SETTINGS FOR HARDENING
CREATE TABLE IF NOT EXISTS hardening_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  driver_ping_timeout_ms INTEGER DEFAULT 5000,       -- 5 sec
  auto_timeout_search_mins INTEGER DEFAULT 2,        -- 2 min
  auto_timeout_assigned_mins INTEGER DEFAULT 10,     -- 10 min
  no_show_driver_penalty NUMERIC(10,2) DEFAULT 100,  -- ₹100
  no_show_customer_charge NUMERIC(10,2) DEFAULT 50,  -- ₹50
  no_show_rating_deduction NUMERIC(3,2) DEFAULT 0.5, -- 0.5 stars
  no_show_ban_threshold INTEGER DEFAULT 3,           -- Ban after 3 no-shows in 30 days
  retry_count_fcm INTEGER DEFAULT 3,
  retry_backoff_ms INTEGER DEFAULT 100,
  stale_ride_cancel_mins INTEGER DEFAULT 30,         -- Auto-cancel 30 min past departure
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO hardening_settings VALUES (1, 5000, 2, 10, 100, 50, 0.5, 3, 3, 100, 30, NOW())
  ON CONFLICT (id) DO NOTHING;
