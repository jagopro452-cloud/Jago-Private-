# JAGO Pro Pilot Launch — Execution Checklist

This document lists every action that requires human access to external systems.
All code changes are already committed and deployed.

---

## STEP 1 — RAZORPAY WEBHOOK SECRET (BLOCKING)

**Why this matters:** Without this, ALL payment webhook signature verifications fail.
The payment retry job still runs every 5 minutes as a fallback, but primary
webhook-based payment confirmation is broken until this is set.

**Actions:**

1. Go to: https://dashboard.razorpay.com → Settings → Webhooks
2. Click "Add New Webhook"
3. URL: `https://jagopro.org/api/app/razorpay/webhook`
4. Events to enable: `payment.captured`, `payment.failed`
5. Copy the "Webhook Secret" that Razorpay generates
6. Go to DigitalOcean App Platform → jago-platform → Settings → App-Level Environment Variables
7. Find `RAZORPAY_WEBHOOK_SECRET` → set it to the copied secret
8. Click "Save" → app will redeploy automatically

**Verification:**
- In Razorpay dashboard → Webhooks → click your webhook → "Send Test Event"
- Check server logs in DigitalOcean → Runtime Logs → look for `[WEBHOOK] Razorpay`
- Should see: `200 OK` response, NOT `400 Bad Request`

---

## STEP 2 — REDIS ACTIVATION VERIFICATION

**Status:** Redis database config is already in `.do/app.yaml` (committed in `06f71c8`).
DigitalOcean will provision it on next deploy.

**Actions:**

1. Go to DigitalOcean App Platform → jago-platform
2. Click "Deploy" to trigger a new deployment (or wait for auto-deploy from push)
3. After deploy, go to: Databases tab → confirm `jago-redis` shows status "Active"
4. Go to Runtime Logs → search for: `[Socket.IO] Redis adapter connected`

**Expected log output:**
```
[Socket.IO] Redis adapter connected
```

**If you see instead:**
```
[Socket.IO] Redis unavailable, using in-memory adapter
```
→ Redis is not yet provisioned. Wait 2-3 minutes and redeploy.

---

## STEP 3 — VERIFY DATABASE MIGRATION RAN

Migration `0004_payment_trip_index.sql` adds indexes needed for payment flow.

**Actions:**

1. Go to DigitalOcean → Runtime Logs → search for `[db] Running migrations`
2. Confirm no migration errors
3. Optional: Connect to your Neon DB → run:
   ```sql
   SELECT indexname FROM pg_indexes
   WHERE tablename = 'driver_payments'
   ORDER BY indexname;
   ```
   Should include: `idx_driver_payments_trip_id`

---

## STEP 4 — LOAD TEST

Install k6: https://k6.io/docs/getting-started/installation/

```bash
# Basic test — 100 users for 60 seconds
k6 run --vus 100 --duration 60s tests/load/k6_load_test.js

# Full staged test
k6 run tests/load/k6_load_test.js
```

**Acceptable thresholds (already configured in script):**
- 95th percentile response time < 2 seconds
- Error rate < 5%
- No 500 errors

---

## STEP 5 — END-TO-END MANUAL TEST

Use two physical Android phones (or emulators).

### Test A — Happy path:
1. Install `jago-customer-v4.apk` on Phone 1
2. Install `jago-driver-v4.apk` on Phone 2
3. Register customer account on Phone 1
4. Register driver account on Phone 2, set vehicle info
5. Driver goes online
6. Customer books a ride
7. Driver receives notification → accepts
8. Driver taps "Arrived", then "Start Ride"
9. Driver taps "Complete Ride"
10. Payment screen appears → complete test payment via Razorpay test mode
11. Confirm trip shows "Completed" on both devices

### Test B — Server restart recovery:
1. Start a ride (customer booked, driver accepted)
2. Redeploy server from DigitalOcean (or wait for natural restart)
3. Confirm both apps reconnect automatically (status bar shows connection restored)
4. Confirm trip state is restored from database

### Test C — Delayed payment:
1. Complete a ride
2. Do NOT complete payment immediately
3. Wait 6 minutes
4. Check server logs for `[PaymentRetry]` — should show retry job running
5. Complete payment
6. Confirm trip moves to "Completed"

### Test D — Location permission denied:
1. Deny location permission on customer app
2. App should show: "Location access is required to request rides" dialog
3. Tapping "Open Settings" should open device app settings

---

## STEP 6 — PRODUCTION SECURITY CHECKS

These are already done in code. Verify in DigitalOcean env vars:

| Variable | Required value |
|----------|---------------|
| `ENABLE_DEV_OTP_RESPONSES` | `false` ← already set |
| `NODE_ENV` | `production` ← already set |
| `RAZORPAY_WEBHOOK_SECRET` | **must be set by you** |
| `REDIS_URL` | auto-injected by DO after Redis provisioned |

---

## CURRENT STATUS SUMMARY

| Item | Status |
|------|--------|
| Firebase OTP (all screens) | DONE — code deployed |
| Payment gate (payment_pending) | DONE — code deployed |
| Payment retry job (every 5min) | DONE — code deployed |
| Socket reconnect recovery | DONE — code deployed |
| DB indexes (migration 0004) | DONE — runs on startup |
| Redis adapter code | DONE — code deployed |
| Redis database provisioning | PENDING — needs DigitalOcean deploy |
| Razorpay webhook secret | **BLOCKED — you must set it** |
| Load test | PENDING — you must run k6 |
| End-to-end device test | PENDING — you must test on devices |
