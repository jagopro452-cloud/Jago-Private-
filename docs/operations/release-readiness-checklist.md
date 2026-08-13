# JAGO Release Readiness Checklist

This checklist is for the final pre-production hardening and release gate review.

## Runtime Governance

- [ ] Runtime snapshot loads successfully from `/api/app/runtime-config`
- [ ] Config precedence resolves correctly:
  - runtime override
  - city override
  - service override
  - vehicle override
  - global default
- [ ] Admin runtime changes create audit log entries
- [ ] Rollback restores previous effective values
- [ ] API enforcement matches UI/runtime visibility

## Customer App

- [ ] App launch with cached config works
- [ ] Login and logout preserve valid session state
- [ ] Socket reconnect refreshes runtime config
- [ ] Background -> foreground refresh works
- [ ] Offline -> online refresh works
- [ ] Parcel disable hides parcel entrypoints and blocks booking
- [ ] Pool disable hides pool entrypoints and blocks booking
- [ ] Fare change reflects without app update
- [ ] Booking during config change behaves truthfully
- [ ] Stale cache recovers after refresh

## Driver App

- [ ] Online/offline state restores after reconnect
- [ ] Parcel disable hides parcel visibility and blocks parcel intake
- [ ] Pool disable hides pool visibility
- [ ] Queued parcel/trip notifications respect runtime config
- [ ] Active ride continuity survives reconnect
- [ ] Background -> foreground recovers socket and config state
- [ ] Subscription visibility updates after config refresh

## Backend / Realtime

- [ ] Cache invalidation happens after admin mutation
- [ ] Redis snapshot refresh works
- [ ] Socket `config:updated` broadcast emits successfully
- [ ] Stale clients recover after reconnect
- [ ] New invalid operations are rejected safely
- [ ] Active rides are not broken by live config changes

## Redis Failure Drill

- [ ] Runtime snapshot falls back to DB if Redis unavailable
- [ ] Last-known-good config remains usable in clients
- [ ] Socket reconnect after Redis recovery does not corrupt state
- [ ] Recovery path restores latest runtime version

## Observability

- [ ] Backend error logging enabled
- [ ] Runtime config propagation logs visible
- [ ] Socket disconnect logs visible
- [ ] Redis health monitoring available
- [ ] Rollback failures alert correctly
- [ ] API latency metrics available

## Release Gate

- [ ] No open P0 issues
- [ ] No critical Flutter/runtime errors
- [ ] Real-device validation evidence attached
- [ ] Redis failure drill evidence attached
- [ ] Rollback drill evidence attached
- [ ] Production monitoring ready
- [ ] Rollback plan documented
