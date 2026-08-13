-- P0: columns required by scheduled dispatcher, parcel cleanup, and trip metadata
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS pickup_short_name TEXT;
ALTER TABLE trip_requests ADD COLUMN IF NOT EXISTS destination_short_name TEXT;
ALTER TABLE parcel_orders ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;
ALTER TABLE parcel_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE vehicle_categories ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(50);
