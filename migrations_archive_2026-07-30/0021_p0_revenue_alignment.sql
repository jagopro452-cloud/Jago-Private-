-- P0 production alignment: rides use commission model (15% per ride) for soft launch revenue.
-- Safe to re-run: upserts only.

INSERT INTO revenue_model_settings (key_name, value)
VALUES ('rides_model', 'commission')
ON CONFLICT (key_name) DO UPDATE SET value = EXCLUDED.value;

UPDATE service_revenue_config
SET revenue_model = 'commission',
    subscription_required = false,
    commission_percentage = COALESCE(NULLIF(commission_percentage, 0), 15)
WHERE module_name IN ('ride', 'rides');

UPDATE platform_services
SET revenue_model = 'commission',
    commission_rate = COALESCE(NULLIF(commission_rate, 0), 15)
WHERE service_category = 'rides'
   OR service_key IN ('bike_ride', 'auto_ride', 'mini_car', 'sedan', 'suv');
