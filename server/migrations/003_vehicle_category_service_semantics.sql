ALTER TABLE vehicle_categories
  ADD COLUMN IF NOT EXISTS service_type VARCHAR(30) DEFAULT 'ride';

UPDATE vehicle_categories
SET service_type = CASE
  WHEN COALESCE(is_carpool, false) = true THEN 'pool'
  WHEN LOWER(COALESCE(type, '')) IN ('parcel', 'cargo') THEN LOWER(type)
  WHEN LOWER(COALESCE(vehicle_type, '')) SIMILAR TO '%(parcel|cargo|courier|delivery|pickup|truck|tempo|ace)%' THEN 'parcel'
  ELSE 'ride'
END
WHERE service_type IS NULL
   OR TRIM(service_type) = ''
   OR (LOWER(COALESCE(type, '')) IN ('parcel', 'cargo') AND LOWER(COALESCE(service_type, '')) NOT IN ('parcel', 'cargo'))
   OR (COALESCE(is_carpool, false) = true AND LOWER(COALESCE(service_type, '')) NOT IN ('pool', 'carpool'))
   OR (COALESCE(is_carpool, false) = false AND LOWER(COALESCE(type, '')) NOT IN ('parcel', 'cargo') AND LOWER(COALESCE(service_type, '')) <> 'ride');
