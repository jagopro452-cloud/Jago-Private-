-- Migration: 0018 — Parcel active booking hardening (H6)
-- Date: 2026-06-16
--
-- Adds idempotency_key column and partial unique indexes so only one active
-- parcel order exists per customer and duplicate book requests with the same
-- idempotency key replay safely.

ALTER TABLE parcel_orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_parcel_per_customer
  ON parcel_orders(customer_id)
  WHERE current_status IN ('pending','searching','driver_assigned','accepted','picked_up','in_transit');

CREATE UNIQUE INDEX IF NOT EXISTS idx_parcel_book_idempotency_key
  ON parcel_orders(customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_parcel_orders_customer_idempotency
  ON parcel_orders(customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
