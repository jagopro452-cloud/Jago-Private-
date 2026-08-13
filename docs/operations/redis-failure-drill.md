# JAGO Redis Failure Drill

## Objective

Validate that runtime governance remains safe during Redis outage, reconnect, and stale cache conditions.

## Preconditions

- Runtime config snapshot exists in DB
- Active customer and driver sessions connected
- At least one active ride and one idle session available

## Drill Steps

1. Confirm baseline
   - `/api/app/runtime-config` returns current version
   - active clients are connected
   - runtime dashboard visible

2. Simulate Redis outage
   - stop Redis
   - record timestamp

3. Validate degraded mode
   - `/api/app/runtime-config` should fall back to DB snapshot
   - existing client cache should remain usable
   - no server crash
   - active ride continuity must remain intact

4. Perform admin runtime change during outage
   - verify safe failure or deferred propagation behavior
   - confirm audit visibility

5. Restore Redis
   - start Redis
   - confirm health returns
   - refresh runtime config
   - verify socket propagation resumes

6. Reconciliation
   - confirm latest runtime version on customer app
   - confirm latest runtime version on driver app
   - confirm active rides still safe

## Evidence

- Health check screenshot / logs
- Runtime version before outage
- Runtime version after recovery
- Socket reconnect logs
- Client screenshots after reconciliation

## Pass Criteria

- No crash during outage
- DB fallback works
- Last-known-good cache remains safe
- Redis recovery reconciles latest version
- Active rides unaffected
