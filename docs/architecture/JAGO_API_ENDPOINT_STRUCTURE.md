# JAGO Pro API Endpoint Structure (Target + Compatibility)

This structure keeps existing app APIs stable while introducing versioned gateway routes.

## 1. Gateway namespace

- `POST /v1/auth/otp/send`
- `POST /v1/auth/otp/verify`
- `POST /v1/bookings/quote`
- `POST /v1/bookings/create`
- `GET /v1/bookings/:id`
- `POST /v1/bookings/:id/cancel`
- `POST /v1/trips/:id/start`
- `POST /v1/trips/:id/complete`
- `POST /v1/trips/:id/otp/pickup/verify`
- `POST /v1/trips/:id/otp/delivery/verify`
- `GET /v1/drivers/nearby`
- `POST /v1/safety/sos`
- `GET /v1/safety/trips/:id/live`
- `POST /v1/voice/intent`
- `POST /v1/voice/booking/confirm`

## 2. Service-scoped APIs

### Identity Service
- `POST /internal/identity/otp/send`
- `POST /internal/identity/otp/verify`
- `POST /internal/identity/tokens/refresh`
- `POST /internal/identity/devices/register`

### Booking Service
- `POST /internal/bookings/quote`
- `POST /internal/bookings/create`
- `GET /internal/bookings/:id`

### Matching Service
- `POST /internal/matching/request`
- `POST /internal/matching/dispatch-wave`
- `POST /internal/matching/reassign`

### Trip Service
- `POST /internal/trips/:id/accept`
- `POST /internal/trips/:id/arrived`
- `POST /internal/trips/:id/start`
- `POST /internal/trips/:id/complete`

### Parcel and Hyperlocal Service
- `POST /internal/parcels/create`
- `POST /internal/parcels/:id/pickup-otp/verify`
- `POST /internal/parcels/:id/delivery-otp/verify`

### Car Sharing and Intercity Service
- `GET /internal/carshare/rides`
- `POST /internal/carshare/bookings`
- `GET /internal/intercity/routes`
- `POST /internal/intercity/bookings`

### Safety Service
- `POST /internal/safety/sos`
- `POST /internal/safety/route-deviation`
- `POST /internal/safety/shake-alert`

### Voice AI Service
- `POST /internal/voice/wake`
- `POST /internal/voice/stream`
- `POST /internal/voice/intent`
- `POST /internal/voice/action/execute`

## 3. Backward compatibility map (current to target)

- `/api/app/send-otp` -> `/v1/auth/otp/send`
- `/api/app/verify-otp` -> `/v1/auth/otp/verify`
- `/api/app/customer/book-ride` -> `/v1/bookings/create`
- `/api/app/driver/verify-pickup-otp` -> `/v1/trips/:id/otp/pickup/verify`
- `/api/app/driver/verify-delivery-otp` -> `/v1/trips/:id/otp/delivery/verify`
- `/api/app/customer/intercity-book` -> `/v1/bookings/create` with `serviceType=intercity`
- `/api/app/customer/car-sharing/book` -> `/v1/bookings/create` with `serviceType=car_sharing`

## 4. Realtime contracts

WebSocket channels:
- `trip:new_request`
- `trip:driver_assigned`
- `trip:status_update`
- `trip:completed`
- `safety:alert`
- `driver:location`

Event payload baseline:
- `eventId`
- `eventType`
- `timestamp`
- `tenantId`
- `correlationId`
- `body`
