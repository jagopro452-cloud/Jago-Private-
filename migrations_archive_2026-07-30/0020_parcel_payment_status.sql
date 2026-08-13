-- Align parcel_orders with admin UI payment status column
ALTER TABLE parcel_orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'unpaid';

UPDATE parcel_orders
SET payment_status = 'paid'
WHERE current_status = 'completed'
  AND COALESCE(payment_status, 'unpaid') = 'unpaid';

UPDATE parcel_orders
SET payment_status = 'paid'
WHERE payment_method IN ('b2b_wallet', 'wallet', 'upi', 'online', 'razorpay', 'card')
  AND COALESCE(payment_status, 'unpaid') = 'unpaid';

UPDATE parcel_orders
SET payment_status = 'unpaid'
WHERE payment_status IS NULL;
