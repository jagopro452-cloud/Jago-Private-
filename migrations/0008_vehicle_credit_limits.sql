-- Phase 2 — Outstanding Revenue Model: vehicle-wise configurable credit limits.
--
-- Additive and idempotent, like 0006/0007. Adds ONE new table, keyed by
-- vehicle_category_id, holding the credit limit above which a driver's
-- Outstanding (users.pending_payment_amount, canonical per Phase 1) auto-
-- locks their account. No existing column, table, or calculation is
-- touched - the existing global auto_lock_threshold setting in
-- revenue_model_settings remains the fallback for any vehicle category
-- that has no row here yet (backward compatibility, requirement #5).

CREATE TABLE IF NOT EXISTS public.vehicle_credit_limits (
    vehicle_category_id uuid PRIMARY KEY REFERENCES public.vehicle_categories(id) ON DELETE CASCADE,
    credit_limit numeric(12,2) NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);
