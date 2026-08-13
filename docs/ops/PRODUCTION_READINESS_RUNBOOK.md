# JAGO Production Readiness Runbook

## 1) Mobile production build validation

Customer app:

```bash
cd flutter_apps/customer_app
flutter clean
flutter pub get
flutter build apk --release
```

Driver app:

```bash
cd flutter_apps/driver_app
flutter clean
flutter pub get
flutter build apk --release
```

If Play Store release is required, build AAB instead:

```bash
flutter build appbundle --release
```

## 2) Secure production environment variables

Use `.env.production.example` as template and create `.env.production` outside source control.

Required for startup in production:

- `DATABASE_URL`
- `ADMIN_PASSWORD`
- `GOOGLE_MAPS_API_KEY`
- `OPS_API_KEY`
- `SOCKET_ALLOWED_ORIGINS`

## 3) Credential rotation


Rotate and replace immediately in cloud consoles:

- Firebase service account key
- Google Maps API key
- Payment gateway keys (Razorpay)
- Any admin/API tokens used during testing

After rotation:

- Update secrets manager values
- Restart workloads
- Verify `/api/health` and critical flows

## 4) Monitoring and alerting

- Health: `GET /api/health`
- Readiness: `GET /api/ops/ready` with `x-ops-key`
- Metrics: `GET /api/ops/metrics` with `x-ops-key`

Optional health-alert cron:

```bash
node scripts/ops/health-alert.cjs
```

Set `ALERT_WEBHOOK_URL` to receive incidents.

## 5) Database backup and restore

Backup:

```bash
chmod +x scripts/ops/backup-db.sh
DATABASE_URL=... ./scripts/ops/backup-db.sh
```

Restore:

```bash
chmod +x scripts/ops/restore-db.sh
DATABASE_URL=... ./scripts/ops/restore-db.sh ./backups/jago_YYYYMMDD_HHMMSS.dump
```

## 6) Logging and error tracking

- Request logs and response redaction are enabled in `server/index.ts`.
- Error responses now include `errorId` for correlation.
- Critical errors trigger webhook notifications when `ALERT_WEBHOOK_URL` is configured.

## 7) Environment separation

Use dedicated values and infrastructure per environment:

- `.env.development.example`
- `.env.staging.example`
- `.env.production.example`

Never reuse production credentials in development.

## 8) Admin security (RBAC + 2FA)

- Admin bearer sessions are mandatory for `/api/admin/*` routes.
- Optional 2FA on login: set `ADMIN_2FA_REQUIRED=true`.
- Sensitive admin routes enforce roles (superadmin/admin/support).

## 9) End-to-end flow validation

Run:

```bash
node scripts/smoke-api-patched-flows.cjs
node scripts/e2e-production-readiness.cjs
```

Validate at least:

- ride booking
- driver matching
- OTP verification
- live tracking
- trip start/completion

## 10) Cloud deployment

Container build and run:

```bash
docker compose -f deploy/docker/docker-compose.prod.yml up -d --build
```

Reverse proxy template is in `deploy/nginx/jago.conf`.

## Go-live gate (must pass)

- API compile check passes (`npm run check`)
- Schema hotfix applied (`node scripts/hotfix-ride-flow-schema.cjs`)
- Health and readiness endpoints return success
- Admin API unauthorized access returns `401`
- Mobile release builds succeed
- Backups verified with test restore
