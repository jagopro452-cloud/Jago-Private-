-- notification_logs is written to by two independent code paths whose columns never matched
-- the actual table:
--   1. routes.ts POST /api/notifications/send (admin bulk broadcast) needs delivered_count —
--      missing entirely, so every admin bulk notification send 500'd (verified live).
--   2. hardening.ts per-recipient FCM delivery logging needs recipient_id/trip_id/
--      notification_type/fcm_token/fcm_result/attempt_count — all missing, silently swallowed
--      by a .catch(() => {}), so per-ride-offer FCM delivery has never actually been logged.
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS delivered_count INTEGER DEFAULT 0;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS recipient_id UUID;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS trip_id UUID;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS notification_type VARCHAR(60);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS fcm_token VARCHAR(500);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS fcm_result VARCHAR(30);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_notification_logs_driver ON notification_logs(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_trip ON notification_logs(trip_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_result ON notification_logs(fcm_result);
