# JAGO Pro OpenAPI Specs

This folder contains production-oriented OpenAPI 3.1 specifications for JAGO microservices and gateway contracts.

## Files
- `jago-gateway-public.openapi.yaml`
  - External/public API used by customer app, driver app, and admin clients.
- `jago-matching-trip-location.openapi.yaml`
  - Internal APIs for matching, trip lifecycle, and live tracking.
- `jago-notification-service.openapi.yaml`
  - Internal and public notification APIs for push/SMS/in-app delivery.

## Coverage (requested)
- User registration
- Driver onboarding
- Ride request
- Ride matching
- Trip start
- Trip end
- Live tracking
- Parcel booking
- Notifications

## API Design Notes
- Uses `X-Request-Id` for tracing
- Uses `X-Idempotency-Key` for safe retries on create/mutate endpoints
- Cursor pagination for scale
- RFC7807-style error response (`Problem` schema)
- JWT bearer auth for user/driver/admin clients
- Optional service token auth for internal service-to-service calls

## Suggested Validation
Use your preferred OpenAPI linter/validator:
- `swagger-cli validate <file>`
- `redocly lint <file>`
