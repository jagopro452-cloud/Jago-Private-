-- Zone setup: add geo columns used by admin map + dispatch fallback.

ALTER TABLE zones ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE zones ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE zones ADD COLUMN IF NOT EXISTS radius_km DOUBLE PRECISION DEFAULT 5;

UPDATE zones
SET
  radius_km = COALESCE(radius_km, 5),
  latitude = COALESCE(latitude, NULL),
  longitude = COALESCE(longitude, NULL)
WHERE id IS NOT NULL;
