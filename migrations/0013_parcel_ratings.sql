-- Phase 5 — parcel rating & review (feature gap: no rating mechanism existed
-- for parcel deliveries at all, unlike rides).
--
-- Reuses the exact mechanism built for rides in migration 0012 (see
-- ride-module-contracts.test.ts): per-order claim-guard columns plus the
-- shared `reviews` table (already used as the single source of truth for
-- users.rating, recomputed as AVG(rating) per reviewee) rather than a
-- parallel rating system for parcel.
--
-- reviews.trip_id has a real FK to trip_requests(id), so a parcel_orders.id
-- cannot be stored there. Adding a separate nullable parcel_order_id column
-- instead — exactly one of trip_id/parcel_order_id is populated per row,
-- both feed the same AVG(rating) computation.
ALTER TABLE public.parcel_orders
  ADD COLUMN IF NOT EXISTS driver_rating numeric(2,1),
  ADD COLUMN IF NOT EXISTS customer_rating numeric(2,1);

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS parcel_order_id uuid REFERENCES public.parcel_orders(id);

-- Phase 5 — parcel coupon application (feature gap: /api/app/parcel/book had
-- no coupon/discount handling at all, unlike ride booking). Reuses the same
-- coupon_setups table and validation rules as rides; usage-limit checks
-- below count against these new columns instead of trip_requests.coupon_code.
ALTER TABLE public.parcel_orders
  ADD COLUMN IF NOT EXISTS coupon_code varchar(50),
  ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) DEFAULT 0;
