-- getVehicleCategoryMeta() (server/vehicle-matching.ts) unconditionally selects
-- COALESCE(description, '') AS description from vehicle_categories, but this column never
-- existed. Every call silently failed and returned null — breaking pool-vehicle validation
-- (POOL_VEHICLE_INVALID for every category, verified live) and vehicle-matching/dispatch
-- eligibility platform-wide, since both consume this same function.
ALTER TABLE vehicle_categories ADD COLUMN IF NOT EXISTS description TEXT;
