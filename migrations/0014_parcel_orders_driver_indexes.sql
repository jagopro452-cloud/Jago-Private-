-- Phase 8 — production hardening: missing indexes.
--
-- parcel_orders had indexes covering customer_id (idempotency/one-active-
-- order-per-customer) but none on driver_id or current_status, despite
-- multiple driver-scoped hot-path queries filtering/joining on driver_id
-- (server/routes.ts: driver active-parcel lookup, drop-otp completion,
-- rate-driver/rate-customer, pending/nearby parcel listing). Mirrors the
-- exact indexing convention already used for trip_requests.driver_id.
CREATE INDEX IF NOT EXISTS idx_parcel_orders_driver_id
  ON public.parcel_orders (driver_id);

CREATE INDEX IF NOT EXISTS idx_parcel_orders_driver_status
  ON public.parcel_orders (driver_id, current_status);
