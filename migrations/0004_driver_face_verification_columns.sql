-- server/routes.ts's face-verification admin-approval path and the
-- GET /api/app/driver/check-verification re-verify cadence (24h / 10 trips)
-- both read/write users.last_face_verified_at and users.face_verified_trips.
-- Neither column was ever created by any prior migration — every call that
-- touched them failed with "column does not exist" (42703). users.selfie_image
-- already exists and is unaffected.
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS last_face_verified_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS face_verified_trips INTEGER NOT NULL DEFAULT 0;
