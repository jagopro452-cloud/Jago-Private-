-- driver_payments: index on trip_id required for payment gate webhook lookup
-- (webhook checks driver_payments by razorpay_order_id, then updates trip_requests by trip_id)
CREATE INDEX IF NOT EXISTS idx_driver_payments_trip_id ON driver_payments(trip_id) WHERE trip_id IS NOT NULL;

-- Also index payment_pending trips for retry job queries
CREATE INDEX IF NOT EXISTS idx_trip_requests_payment_pending ON trip_requests(current_status, updated_at)
  WHERE current_status = 'payment_pending';
