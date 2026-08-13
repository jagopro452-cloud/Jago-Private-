-- outstation-pool-v2.ts's cancel/pickup/drop routes reference these outstation_pool_bookings
-- columns for the booking lifecycle (cancel reason/actor, refund status, pickup/drop timestamps),
-- but they were never migrated onto the table.
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(300);
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(20);
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS refund_status VARCHAR(20);
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMP;
ALTER TABLE outstation_pool_bookings ADD COLUMN IF NOT EXISTS dropped_at TIMESTAMP;
