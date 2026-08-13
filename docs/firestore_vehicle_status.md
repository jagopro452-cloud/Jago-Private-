# Firestore Vehicle Availability Schema

Collection: `vehicle_status`

Required documents:

```json
vehicle_status/bike
{
  "active": true,
  "name": "Bike",
  "icon": "bike",
  "updatedAt": "<server timestamp>",
  "updatedBy": "admin@example.com"
}
```

```json
vehicle_status/auto
{
  "active": true,
  "name": "Auto",
  "icon": "auto",
  "updatedAt": "<server timestamp>",
  "updatedBy": "admin@example.com"
}
```

```json
vehicle_status/cab
{
  "active": false,
  "name": "Cab",
  "icon": "car",
  "updatedAt": "<server timestamp>",
  "updatedBy": "admin@example.com"
}
```

```json
vehicle_status/premium
{
  "active": false,
  "name": "Premium",
  "icon": "premium",
  "updatedAt": "<server timestamp>",
  "updatedBy": "admin@example.com"
}
```

Activity logs are written under:

```text
vehicle_status/{vehicleKey}/activity_logs/{autoId}
```

Each log contains `message`, `vehicleKey`, `vehicleName`, `active`, `adminId`, `adminEmail`, and `createdAt`.

The admin API auto-creates missing vehicle documents using the defaults above when `/api/admin/vehicle-status` is opened.
