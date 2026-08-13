-- Discounts: columns required by admin discounts API
ALTER TABLE discounts
  ADD COLUMN IF NOT EXISTS service_type VARCHAR(50) DEFAULT 'both';

ALTER TABLE discounts
  ADD COLUMN IF NOT EXISTS vehicle_category_id UUID REFERENCES vehicle_categories(id) ON DELETE SET NULL;
