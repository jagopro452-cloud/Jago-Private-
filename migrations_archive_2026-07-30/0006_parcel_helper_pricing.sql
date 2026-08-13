-- Add helper and loading charge pricing to parcel_fares
ALTER TABLE parcel_fares ADD COLUMN IF NOT EXISTS loading_charge NUMERIC(23,3) DEFAULT 0;
ALTER TABLE parcel_fares ADD COLUMN IF NOT EXISTS helper_charge_per_hour NUMERIC(23,3) DEFAULT 0;
ALTER TABLE parcel_fares ADD COLUMN IF NOT EXISTS max_helpers INTEGER DEFAULT 0;
