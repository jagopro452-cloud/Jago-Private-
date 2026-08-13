# JAGO Pro Super Platform API Endpoint Catalog (V2)

## Gateway

- `GET /health`
- `GET /v1/health/all`
- `POST /v1/auth/otp/send`
- `POST /v1/auth/otp/verify`
- `POST /v1/bookings/estimate`
- `POST /v1/bookings`
- `POST /v1/dispatch/match`
- `GET /v1/trips/:tripId/track`
- `POST /v1/voice/parse`

## Matching Service

- `GET /health`
- `POST /internal/matching/request`
- `POST /internal/matching/request/:requestId/accept`
- `GET /internal/matching/request/:requestId`

## Trip Service

- `GET /health`
- `POST /internal/trips`
- `GET /internal/trips/:tripId`
- `POST /internal/trips/:tripId/arrive`
- `POST /internal/trips/:tripId/start`
- `POST /internal/trips/:tripId/complete`
- `POST /internal/trips/:tripId/cancel`

## Location Service

- `GET /health`
- `POST /internal/location/driver/update`
- `GET /internal/location/driver/nearby`
- `GET /internal/location/stream`
- `GET /internal/location/demand-zones`

## AI Assistant Service

- `GET /health`
- `POST /internal/voice/intent`
- `POST /internal/voice/action/execute`

## Monolith Core (selected production APIs)

- `POST /api/app/customer/book-ride`
- `POST /api/app/customer/intercity-book`
- `POST /api/app/customer/car-sharing/book`
- `GET /api/app/customer/track-trip/:tripId`
- `POST /api/app/driver/accept-trip`
- `POST /api/app/driver/arrived`
- `POST /api/app/driver/start-trip`
- `POST /api/app/driver/complete-trip`
- `POST /api/app/driver/verify-pickup-otp`
- `POST /api/app/driver/verify-delivery-otp`
- `GET /api/admin/system/live-overview`
- `GET /api/ops/ready`
- `GET /api/ops/metrics`
