# JAGO Pro Migration Roadmap (Non-Breaking)

## Baseline
Current platform is a modular monolith with strong functional breadth.

Key baseline modules:
- `server/routes.ts` for API lifecycle and business logic
- `server/ai.ts` for voice parsing, matching, demand, safety intelligence
- `server/socket.ts` for real-time updates
- `shared/schema.ts` as data model source

## Principles
- Keep app-facing APIs stable during extraction
- Introduce new services behind gateway facade
- Use outbox/event bus for safe async propagation
- Use feature flags for every behavioral change
- Canary rollouts with rollback switches

## Phase Plan

### Phase 0: Stabilize and Prepare (2-3 weeks)
- Add contract test suite for critical APIs:
  - OTP
  - booking and assignment
  - pickup OTP and delivery OTP
  - complete trip and settlements
  - intercity and car-sharing fares
- Add outbox table and event publisher worker
- Add idempotency keys on booking and payment endpoints
- Add trace IDs in API logs

Exit criteria:
- Existing features pass smoke and regression suite
- Event emission available for booking, trip, payment, safety

### Phase 1: Extract Realtime Core (3-4 weeks)
- Extract `location-service`
- Extract `matching-service`
- Keep existing socket event names unchanged

Exit criteria:
- Driver assignment latency and acceptance flow equal or better

### Phase 2: Extract Lifecycle and Safety (4-5 weeks)
- Extract `trip-service`
- Extract `safety-service`
- Add incident command center endpoints

Exit criteria:
- No OTP flow regressions
- SOS and route deviation alerts active in production

### Phase 3: Extract Pricing, Parcel, Intercity, Car Sharing (4-6 weeks)
- Extract `pricing-service`
- Extract `parcel-hyperlocal-service`
- Extract `carshare-intercity-service`

Exit criteria:
- Fare parity vs baseline
- Seat and passenger pricing behavior validated

### Phase 4: Voice AI and Intelligence Expansion (5-7 weeks)
- Deploy `ai-assistant-service`
- Add multilingual ASR and NLU improvements
- Integrate predictive booking and demand forecasting

Exit criteria:
- Voice booking conversion and confidence KPIs met

### Phase 5: UX Premium Upgrade and Native Track (ongoing)
- Upgrade current Flutter UX with premium interaction patterns
- Parallel native track (Kotlin and Swift) with shared BFF APIs

Exit criteria:
- No service downtime
- Feature parity maintained across clients

## Data Migration Strategy
- Start with shared PostgreSQL + service schema namespaces
- Move to database-per-service selectively for high-write domains
- CDC for analytics/lakehouse

## Risk Register
- Rate-limit side effects in OTP flows
- Event duplication in async pipelines
- Socket contract drifts between old/new services
- Fare rule divergence during pricing extraction

Mitigations:
- Idempotent consumers
- versioned event schemas
- strict contract tests
- shadow traffic validation

## KPI Targets
- Booking success rate > 99%
- Matching response < 1.5s P95
- Trip lifecycle errors < 0.2%
- Safety incident acknowledgment < 30s
- API 5xx < 0.1%
