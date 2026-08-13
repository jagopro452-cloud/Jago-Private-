# JAGO Real Device Validation Matrix

## Device Classes

### Android

- Low-end Android 10/11
- Mid-range Android 12/13
- High-end Android 14/15

### iPhone

- Recent iOS version
- Previous stable iOS version

## Network Profiles

- Stable Wi-Fi
- 4G mobile data
- 5G mobile data
- Poor network / high latency
- Airplane mode on/off transition

## Customer App Scenarios

| Scenario | Expected Result | Evidence |
| --- | --- | --- |
| Launch with cached config | UI loads with last-known-good state | |
| Login | Session restored and runtime config loaded | |
| Background -> foreground | Config refresh and socket reconnect | |
| Offline -> online | Runtime state reconciles without stale UI | |
| Disable parcel from admin | Parcel entry hidden/blocked without app update | |
| Disable pool from admin | Pool entry hidden/blocked without app update | |
| Fare change from admin | New fare visible on next relevant flow | |
| Booking during config change | Truthful rejection/success with no stale state | |
| Socket disconnect | Reconnect and active flow recovery | |
| App kill and reopen | Cached config restore then fresh sync | |

## Driver App Scenarios

| Scenario | Expected Result | Evidence |
| --- | --- | --- |
| Launch with cached config | Runtime state restored safely | |
| Online -> reconnect | Online state restored correctly | |
| Active ride during reconnect | Ride continuity preserved | |
| Disable parcel from admin | Parcel request intake blocked safely | |
| Disable pool from admin | Pool visibility removed | |
| Queued parcel notification after disable | Request blocked with truthful notice | |
| Background tracking restore | Socket + runtime state recover | |
| App kill and reopen during trip | Trip recovery flow works | |
| Subscription visibility update | UI updates after runtime refresh | |

## Signoff

- Tester:
- Date:
- Build / Commit:
- Pass / Fail:
- Blocking Notes:
