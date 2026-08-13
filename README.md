# JAGO Pro - India's Smart Mobility Platform

## Overview
JAGO is a comprehensive ride-sharing platform designed for the Indian market, featuring a full-stack Node.js/React admin panel and Flutter mobile applications for both drivers (JAGO Pro Pilot) and customers (JAGO). The platform aims to provide a robust, scalable, and feature-rich solution for urban mobility, covering various services like bike rides, auto rides, car rides, parcel delivery, cargo, and intercity travel. It is built for deployment on major app stores. The business vision is to capture a significant share of the Indian ride-hailing and logistics market by offering a localized and efficient service.

## User Preferences
I want iterative development.
I prefer detailed explanations.
Do not make changes to the folder `Z`.
Do not make changes to the file `Y`.

## System Architecture

### Technology Stack
- **Frontend (Admin Panel)**: React, TypeScript, Vite, TanStack Query v5, Wouter, custom Bootstrap CSS.
- **Backend**: Node.js, Express, Drizzle ORM, Socket.IO for real-time communication, bcrypt for password hashing, express-rate-limit for security.
- **Database**: PostgreSQL with UUID primary keys.
- **Mobile**: Flutter 3.22.3, Dart for both customer and driver applications.
- **UI/UX Design**: Rapido-style premium UI with #FF6B35 (JAGO orange), #060D1E (deep navy), #0D1B3E (surface), #FFD700 (gold). Both apps support full dark/light mode. Driver home has floating top bar, pulsing LIVE banner, gradient ONLINE/OFFLINE pill, performance stats. Customer home has greeting chip (Good Morning/etc pill), bold 24px name, orange fare in recent trips, gradient "Repeat →" buttons. Booking screen has gradient check badge (28px) on selected vehicle, dynamic options counter.
- **Current Build**: v1.0.25+25. Both APKs ~56-57MB. GitHub Release: https://github.com/jagopro452-cloud/jago/releases/tag/v1.0.25. Build script auto-resets Flutter git state before driver build. Changes in v1.0.25 (UI Polish): Customer splash full-screen orange gradient + logo only (no text). Driver splash navy bg + pilot logo + orange glow ring. Android native splashes: customer=orange, driver=dark navy. Customer home: "Book a Ride" section moved above recent trips, circles have white inner ring. Booking screen: vehicle icon always shows orange tint (not grey), fare text always orange. Recent trips "Repeat" button changed to orange outline style. Previous v1.0.24: Service icons enlarged 72px→80px, haptic feedback, Book Now deeper glow shadow.

### Core Features & Implementations
- **Driver Onboarding & Verification**: A 6-step registration flow for drivers including basic info, password, driving license details, vehicle details, vehicle documents, and a selfie. Documents are uploaded as base64 images. A verification system with pending and rejection screens, and an admin panel for document approval/rejection with FCM push notifications.
- **Revenue Models**: Drivers can choose between a Commission Model (15% per ride) or a Subscription Model (pay upfront, keep 100%). Subscription plans are configurable (e.g., 7-day, 15-day, 30-day).
- **Multi-Vehicle Selection**: Customer app displays all available vehicle options (Bike, Auto, Car, Parcel, Cargo, Intercity) with fare, distance, and ETA, allowing selection and automatic application of discounts.
- **Real-Time Tracking & Communication**: Socket.IO is used for real-time driver location updates, trip status, and online/offline events. WebRTC is integrated for call signaling between drivers and passengers.
- **Wallet & Payments**: Integrated with Razorpay for wallet recharges and ride payments. Security measures are in place to prevent duplicate payments.
- **Account Management**: Features for both customer and driver account deletion (soft deactivate or permanent delete). Admin panel includes comprehensive user management for drivers, customers, employees, and subscriptions.
- **Localization**: Supports multiple languages (en, te, hi, ta, kn, ml) with a robust localization service within the Flutter apps and an admin interface for managing app languages.
- **Security**: Implements bcrypt for admin password hashing, rate limiting, token-based authentication for mobile apps, input validation using Zod, and security headers.
- **Admin Panel**: Comprehensive dashboard with fleet map, heat map, zone management, trip management, promotions, user management, parcel attributes, B2B, vehicle management, fare management, finance, support, content, and business settings.

### AI Intelligence Layer (server/ai.ts)
- **AI Voice Booking NLP**: Enhanced intent parser detecting 5 intents (book_ride, send_parcel, find_drivers, check_status, cancel_ride) + 6 vehicle types + pickup/destination extraction with geocoding. Replaces basic keyword matching.
- **AI Driver Matching**: Intelligent multi-factor scoring (distance 40%, rating 25%, response speed 20%, completion rate 15%) replacing simple distance-only sorting. Used in book-ride, reject-trip, cancel-trip, and timeout-reassign flows.
- **AI Smart Suggestions**: Time-based, frequency-based, and saved-place suggestions for customers. Endpoint: GET /api/app/ai/suggestions.
- **AI Safety Monitor**: Real-time route deviation detection, abnormal stop detection, speed anomaly alerts — all processed in socket.ts driver:location handler and persisted to ai_safety_alerts table. SOS endpoint: POST /api/app/ai/sos.
- **Demand Heatmap**: Zone-level demand/supply analysis with surge multiplier calculation. Endpoint: GET /api/app/ai/demand-heatmap.
- **Driver Stats**: Automatic performance stats (total trips, completion rate, avg response time) refreshed on trip completion and periodically (10 min). Table: driver_stats.
- **DB Tables**: driver_stats, ai_safety_alerts, demand_predictions — auto-created via initAiTables() on server startup.

## External Dependencies
- **Payments**: Razorpay (for wallet recharge and ride payments).
- **OTP / Push**: Firebase is used for push notifications and OTP-related mobile flows. Legacy SMS providers are no longer part of the active production path.
- **Maps**: Google Maps API Key (for location services and navigation).
- **Real-time Communication**: Socket.IO (for live updates and WebRTC signaling).
- **Push Notifications**: Firebase Admin / FCM.
- **Payments**: Razorpay.
- **High Availability Socket Routing**: Redis via Socket.IO Redis adapter and presence cache.

## Production Launch

- Copy [.env.example](C:/Users/kiran/Downloads/jago-Updates-23-04-jago/jago-Updates-23-04-jago/jago-main-sync/jago_app-main/.env.example) to your deployment secret store and fill every real value.
- Run on Node `20.x`.
- Verify build health with `npm run check` and `npm run build`.
- Verify runtime health with `npm run smoke:core`.

## Migrations & Operational Notes

**Two migration locations exist by design — do not treat this as a mistake to "fix" by merging them:**
- `migrations/` (repo root) — Drizzle-kit tracked, numbered `0000_*.sql` upward, tracked via `migrations/meta/_journal.json`. This is where new schema changes should go.
- `server/migrations/` — an older, separately-numbered (`001_*.sql` upward) set with its own lightweight runner. Both are applied automatically at every boot (see boot log lines tagged `[migration]`), in the order shown above. Verified via a full replay against an empty database (all 14+ files apply cleanly, in order, idempotently) — this dual setup works today, it's just two systems, not one. If consolidating them is ever undertaken, do it as its own dedicated task, not as a drive-by change alongside a feature.

**`DB_POOL_MAX`** (`server/db.ts`) currently defaults to `25` in production, `15` in dev. Load-tested locally: 100 concurrent requests are healthy (p50 ~386ms); 500 concurrent requests succeed with zero errors but degrade to p50 ~5.5s / max ~7.6s, traced directly to pool exhaustion at this size. **Before any real rollout expected to see sustained triple-digit concurrent traffic, raise `DB_POOL_MAX` via the `DB_POOL_MAX` env var and re-run the same load test** — this is a config change, not a code change.

**Known dead code, confirmed unreachable, kept for now rather than deleted silently:**
- `server/local-pool-dispatch.ts` — superseded by `server/rolling-pool.ts`; never imported anywhere.
- `driver_kyc_documents` DB table + `POST /api/app/driver/kyc/upload` route (`server/routes.ts`) — a parallel KYC system never called by either Flutter app. The real, live KYC path is `driver_documents` + `POST /api/app/driver/upload-document`.
- Plain `documents` table (from `migrations/0000_baseline.sql`) — never queried by any server code.
- `completeTripAtomic()` in `server/revenue-engine.ts` — never called; the real trip-completion path is inline in `routes.ts`. Its only table dependency (`outbox_events`) exists (migration `0005`) but has no live writer as a result.

Decision: leave all four in place for now (zero functional risk — confirmed unreachable). Remove in a dedicated cleanup pass with its own review, not silently alongside unrelated work.
- Verify production readiness with `npm run smoke:prod` and `OPS_API_KEY` set.
