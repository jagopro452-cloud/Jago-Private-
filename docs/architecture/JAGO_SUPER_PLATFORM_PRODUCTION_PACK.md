# JAGO Pro Super Platform Production Pack

Date: 2026-03-06

## 1. Backend Architecture

### 1.1 Runtime topology

- API Gateway: `microservices/gateway-service`
- Matching Engine: `microservices/matching-service`
- Trip State Engine: `microservices/trip-service`
- Location Stream Service: `microservices/location-service`
- AI Assistant Service: `microservices/ai-assistant-service`
- Existing Modular Monolith (source of truth while migrating): `server/routes.ts`

### 1.2 Service responsibilities

- Gateway:
  - Unified booking entry points
  - Auth proxy and compatibility routing
  - Fleet-wide health aggregation
- Matching:
  - Driver ranking by distance/rating/acceptance/load
  - Acceptance deadline and dispatch state
  - Fraud signal hooks
- Trip:
  - Lifecycle state machine
  - OTP-gated start/complete transitions
- Location:
  - Driver location ingest
  - Nearby search (3-5 km)
  - Real-time stream snapshots (2-3 sec)
  - Demand zone feed for driver positioning
- AI Assistant:
  - Wake-word and NLP intent parse
  - Telugu-English voice pattern extraction
  - Booking action plan output

## 2. Unified Booking Engine

Unified booking endpoints:

- `POST /v1/bookings/estimate`
- `POST /v1/bookings`

Supported services:

- Bike rides
- Auto rides
- Car rides
- Parcel delivery
- Car sharing
- Intercity rides
- Hyperlocal delivery

Mapping strategy:

- Gateway routes unified requests to existing production APIs in monolith while migration is in progress.

## 3. Ride Flow (Production)

### 3.1 Customer flow

- Pickup auto-detection and map-based destination search in mobile apps
- Fare and ETA estimation before booking
- Ride request creation with service type

### 3.2 Driver dispatch

- Detect nearby drivers in 3-5 km ring
- Rank by:
  - distance
  - rating
  - acceptance reliability
  - active load
- Broadcast candidates and apply acceptance timer
- Auto-select best available driver

### 3.3 Live trip UX payload

Tracking APIs provide:

- driver photo
- driver rating
- vehicle number
- ETA minutes
- live location data
- SOS and call readiness

### 3.4 OTP checks

- Pickup OTP before trip start
- Delivery OTP for parcel/hyperlocal completion

## 4. Real-Time Infrastructure

Implemented now:

- Existing Socket.IO system in monolith: `server/socket.ts`
- Scalable location stream API in location service:
  - `GET /internal/location/stream` (SSE snapshots every 2-3 sec)
  - `POST /internal/location/driver/update`
  - `GET /internal/location/driver/nearby`

Scale roadmap:

- Introduce Redis adapter for cross-instance fanout
- Move location cache from memory to Redis Geo sets

## 5. AI Modules

### 5.1 Demand prediction and heat zones

- Demand zone feed endpoint:
  - `GET /internal/location/demand-zones`
- Integrate historical trip DB + traffic providers for model scoring in next phase

### 5.2 Smart driver positioning

Driver app can consume:

- demandScore
- surgeMultiplier
- recommendation text:
  - "Move to this zone to get more rides."

### 5.3 Voice assistant

- Wake word: "Hey JAGO Pro"
- Intent parser endpoint:
  - `POST /internal/voice/intent`
- Handles Telugu-English phrase style:
  - `<pickup> nundi <destination> ki bike kavali`

### 5.4 Fraud detection hooks

Matching service emits fraud signals:

- no-driver anomaly
- clustered-driver anomaly
- action recommendation (`review`, `challenge_otp`)

## 6. Security and Cyber Hardening

Implemented:

- Auth tokens for app users and admins
- bcrypt password checks
- Admin session TTL
- Admin 2FA support (`/api/admin/login/verify-2fa`)
- RBAC guards on sensitive admin endpoints
- API rate limiting
- SQL injection resistance via parameterized queries
- Ops endpoint key protection (`x-ops-key`)

## 7. Monitoring and Alerting

Implemented:

- Health: `GET /api/health`
- Ops readiness: `GET /api/ops/ready`
- Ops metrics: `GET /api/ops/metrics`
- Alert hook support: `ALERT_WEBHOOK_URL`
- Error correlation IDs and process-level exception alerts

Ops scripts:

- `scripts/ops/health-alert.cjs`
- `scripts/ops/backup-db.sh`
- `scripts/ops/restore-db.sh`

## 8. Database Schema Strategy

Current + hotfix coverage:

- Trip lifecycle and audit:
  - `trip_status`
  - `ride_events`
  - `admin_logs`
  - `ride_complaints`
- Admin security:
  - `admins.auth_token`
  - `admins.auth_token_expires_at`
  - `admins.last_login_at`
  - `admin_login_otp`

Reference target schema:

- `docs/architecture/JAGO_DATABASE_SCHEMA_TARGET.sql`

## 9. Mobile UI Screen Hierarchy

### 9.1 Customer app

- Home/Map screen
- Service chooser (Bike/Auto/Car/Parcel/Intercity/Sharing)
- Booking confirmation + fare breakdown
- Live tracking screen (driver card + ETA + map + SOS + call)
- Wallet and offers
- Trip history and support
- Voice booking screen

### 9.2 Driver app

- Driver dashboard (online/offline, earnings)
- Incoming trip request screen (timer)
- Trip execution screen (arrived/start/complete + OTP)
- Live navigation and rider contact
- Demand zone and surge insight screen
- Wallet/subscription/performance screens

## 10. Admin Dashboard Modules

- User management
- Driver verification and lifecycle
- Ride monitoring (active/history/cancelled)
- Parcel and car-sharing controls
- Surge and demand controls
- Fraud and complaint management
- Revenue and analytics dashboards
- Language/config/security settings

## 11. Cloud Deployment Configuration

Implemented deployment assets:

- Docker:
  - `deploy/docker/Dockerfile`
  - `deploy/docker/docker-compose.prod.yml`
- Nginx:
  - `deploy/nginx/jago.conf`
- Kubernetes:
  - `deploy/k8s/jago-api-deployment.yaml`
  - `deploy/k8s/jago-api-service.yaml`
  - `deploy/k8s/jago-api-hpa.yaml`

Environment separation:

- `.env.development.example`
- `.env.staging.example`
- `.env.production.example`

## 12. Performance and Scale Blueprint (Millions of users)

Required production scale path:

1. Keep gateway stateless and horizontally scalable
2. Move dispatch/trip/location in-memory state to Redis and durable DB writes
3. Use queue/event bus for trip and notification workflows
4. Enforce read/write DB split and caching
5. Deploy autoscaling policies (HPA + infra autoscaling)
6. Use distributed tracing and SLO-driven alerting

## 13. Current Readiness Status

- Core backend and security hardening: done
- Unified booking gateway layer: done
- Microservice execution scaffolds upgraded: done
- Monitoring/backup/deployment foundations: done
- Mobile release build readiness: pending toolchain fixes on build host

## 14. Immediate Next Phase

- Attach Redis adapter to location + dispatch runtime state
- Enable microservice traffic via feature flags per route group
- Add CI/CD pipelines for mobile builds and backend deploy gates
- Complete model-backed demand prediction (historical + traffic inputs)
