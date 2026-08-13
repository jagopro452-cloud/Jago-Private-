CREATE TABLE IF NOT EXISTS franchise_service_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  franchisee_id UUID NOT NULL REFERENCES franchisees(id) ON DELETE CASCADE,
  service_key VARCHAR(80) NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_by VARCHAR(191),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_franchise_service_assignments_unique
  ON franchise_service_assignments(franchisee_id, service_key);

CREATE INDEX IF NOT EXISTS idx_franchise_service_assignments_service
  ON franchise_service_assignments(service_key);
