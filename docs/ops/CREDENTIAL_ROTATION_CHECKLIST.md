# Credential Rotation Checklist

## Scope

Rotate all credentials previously used in development, backups, or leaked configs.

## Keys to rotate

- Firebase service account private key
- Firebase web API key
- Google Maps API key
- Razorpay key ID/secret/webhook secret
- Fast2SMS API key
- Twilio account SID/auth token/phone number
- Admin password and active admin session tokens
- OPS API key

## Rotation procedure

1. Generate new keys in provider console.
2. Update secrets in staging first.
3. Deploy staging and validate smoke tests.
4. Update production secrets manager.
5. Restart application pods/VM services.
6. Re-run readiness checks:
   - `/api/health`
   - `/api/ops/ready` with `x-ops-key`
   - `node scripts/smoke-api-patched-flows.cjs`
7. Revoke old keys after successful validation.

## Post-rotation checks

- Admin login + 2FA flow works.
- Payment verification/webhook signatures pass.
- OTP delivery works with selected provider.
- Push notifications (FCM) work.
- Logs show no auth/secret errors.
