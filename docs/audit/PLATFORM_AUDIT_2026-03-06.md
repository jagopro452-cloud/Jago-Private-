# JAGO Pro Platform Audit - 2026-03-06

## Fixed in this pass

- Secured `/api/admin/*` endpoints with bearer-token session middleware.
- Added admin session lifecycle support:
  - `admins.auth_token`
  - `admins.auth_token_expires_at`
  - `admins.last_login_at`
- Updated admin login to issue expiring tokens and logout to revoke sessions.
- Added production-safe admin bootstrap behavior:
  - No first admin auto-create in production without `ADMIN_PASSWORD`.
- Applied global `/api/app` rate limiting middleware usage.
- Removed hardcoded Google Maps API key fallback from voice-booking geocoding endpoint.
- Disabled OTP value exposure in API responses by default.
  - OTP echo now requires explicit `ENABLE_DEV_OTP_RESPONSES=true`.
- Redacted leaked keys from `.replit` tracked configuration.
- Updated schema hotfix script to include admin auth/session columns and index.

## High-risk items still requiring operator action

- Rotate all credentials that were previously committed:
  - Firebase service account key
  - Google Maps server key
  - Firebase web API key
  - Any payment/SMS keys historically exposed in commits or logs
- Revoke old admin sessions after deployment (if old token logic was used).
- Ensure production has these env vars set:
  - `ADMIN_PASSWORD`
  - `GOOGLE_MAPS_API_KEY`
  - OTP/SMS provider credentials

## Architecture risks still present

- Monolithic `server/routes.ts` remains very large and high-risk for regressions.
- Error handling still returns raw internal messages on many routes (`res.status(500).json({ message: e.message })`).
- No central authorization policy by role/scope yet (admin auth exists, but fine-grained RBAC is pending).

## Recommended next hardening sprint

1. Introduce centralized error sanitizer + correlation IDs for all API errors.
2. Add RBAC middleware (`superadmin/admin/support`) per endpoint group.
3. Split `server/routes.ts` into domain modules:
  - auth
  - rides
   - payments
   - admin
   - safety
4. Add security tests:
   - unauthorized admin access checks
   - OTP leakage checks
   - rate-limit behavior checks
5. Add secret scanning in CI and block commits with plaintext keys.
