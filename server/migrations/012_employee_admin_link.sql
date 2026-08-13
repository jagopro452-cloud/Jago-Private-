-- Employees become profile records linked to a real admin identity (admins.id),
-- instead of holding their own independent login. Additive only: no existing
-- column is modified or dropped, admin_sessions/admin_refresh_tokens and their
-- foreign keys are untouched.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES admins(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS employees_admin_id_unique ON employees(admin_id) WHERE admin_id IS NOT NULL;
