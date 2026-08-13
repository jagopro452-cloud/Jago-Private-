-- Phase 2 — vehicle-wise revenue configuration (commission %, platform fee,
-- GST %), completing the Outstanding Revenue Model backlog item alongside
-- the existing vehicle-wise credit limits (migration 0008).
--
-- Same precedence pattern as vehicle_credit_limits: a NULL column here means
-- "not configured for this vehicle category", and callers fall back to the
-- existing per-module config (service_revenue_config) or global
-- revenue_model_settings - so a category with no row, or a row with NULL
-- columns, keeps today's behavior exactly (backward compatible).
CREATE TABLE IF NOT EXISTS public.vehicle_revenue_config (
  vehicle_category_id uuid PRIMARY KEY REFERENCES public.vehicle_categories(id),
  commission_pct numeric(6,2),
  platform_fee_per_ride numeric(10,2),
  gst_pct numeric(6,2),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
