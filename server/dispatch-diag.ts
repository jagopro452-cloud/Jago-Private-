/**
 * Dispatch Diagnostic Service
 *
 * Surfaces why nearby drivers were included / excluded for a given trip.
 * Mirrors the filtering rules used in `findDriversInRadius()` (dispatch.ts)
 * but returns every nearby driver annotated with exclusion reasons instead
 * of silently dropping them — so admins can debug "no drivers found"
 * without tailing server logs.
 */

import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { resolveServiceType } from "./dispatch";

// Must stay in sync with DISPATCH_CONFIGS in dispatch.ts
const DEFAULT_RADIUS_STEPS: Record<string, number[]> = {
  bike:       [5, 8, 12, 15],
  auto:       [5, 8, 12, 15],
  cab:        [5, 8, 12, 15, 20],
  parcel:     [5, 8, 12],
  b2b_parcel: [5, 10, 15],
  carpool:    [5, 8, 12, 20],
  outstation: [5, 10, 15, 25],
};

export type ExclusionReason =
  | "vehicle_mismatch"
  | "offline"
  | "busy"
  | "gps_invalid"
  | "not_verified"
  | "inactive"
  | "locked"
  | "stale_location"
  | "outside_radius";

export interface DriverDiagEntry {
  driverId: string;
  fullName: string | null;
  distanceKm: number;
  status: "ELIGIBLE" | "EXCLUDED";
  reasons: ExclusionReason[];
  data?: {
    vehicle_category_id: string | null;
    vehicle_category_name?: string | null;
    is_online: boolean;
    dl_is_online: boolean;
    current_trip_id: string | null;
    verification_status: string | null;
    is_active: boolean;
    is_locked: boolean;
    lat: number;
    lng: number;
    location_updated_at: string | null;
    minutes_since_update: number | null;
  };
}

export interface DispatchDiagResult {
  tripId: string;
  tripStatus: string;
  tripType: string;
  serviceType: string;
  vehicleCategoryId: string | null;
  vehicleCategory: string | null;
  pickup: { lat: number; lng: number };
  radiusKm: number;
  driversChecked: number;
  driversEligible: number;
  summary: Record<string, number>;
  drivers: DriverDiagEntry[];
  simulatedDecision?: {
    wouldNotifyDriverId: string | null;
    reason: string;
  };
}

export interface DiagOptions {
  includeEligible?: boolean;
  includeRawData?: boolean;
  radiusKm?: number;
  simulate?: boolean;
}

export class TripNotFoundError extends Error {
  constructor(tripId: string) {
    super(`Trip ${tripId} not found`);
    this.name = "TripNotFoundError";
  }
}

/**
 * Run dispatch diagnostics for a given trip. Does not send sockets or FCM.
 */
export async function diagnoseDispatch(
  tripId: string,
  opts: DiagOptions = {}
): Promise<DispatchDiagResult> {
  const tripRes = await rawDb.execute(rawSql`
    SELECT
      t.id, t.current_status, t.trip_type, t.pickup_lat, t.pickup_lng,
      t.vehicle_category_id,
      vc.name AS vehicle_category_name
    FROM trip_requests t
    LEFT JOIN vehicle_categories vc ON vc.id = t.vehicle_category_id
    WHERE t.id = ${tripId}::uuid
    LIMIT 1
  `);

  if (!tripRes.rows.length) throw new TripNotFoundError(tripId);
  const trip = tripRes.rows[0] as any;

  const pickupLat = Number(trip.pickup_lat);
  const pickupLng = Number(trip.pickup_lng);
  if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng) ||
      (pickupLat === 0 && pickupLng === 0)) {
    throw new Error(`Trip ${tripId} has invalid pickup coordinates (${pickupLat},${pickupLng})`);
  }

  const serviceType = resolveServiceType(
    trip.trip_type,
    trip.vehicle_category_name || undefined
  );
  const radiusKm = opts.radiusKm ?? DEFAULT_RADIUS_STEPS[serviceType]?.[0] ?? 5;
  const isParcel = serviceType === "parcel" || serviceType === "b2b_parcel";

  // Haversine-equivalent planar approximation (same formula dispatch.ts uses)
  const nearby = await rawDb.execute(rawSql`
    SELECT
      u.id,
      u.full_name,
      u.is_active,
      u.is_locked,
      u.is_online,
      u.current_trip_id,
      u.verification_status,
      dl.is_online AS dl_is_online,
      dl.lat,
      dl.lng,
      dl.updated_at AS location_updated_at,
      dd.vehicle_category_id,
      vc.name AS vehicle_category_name,
      SQRT(
        POW((dl.lat - ${pickupLat}) * 111.32, 2) +
        POW((dl.lng - ${pickupLng}) * 111.32 * COS(RADIANS(${pickupLat})), 2)
      ) AS distance_km
    FROM users u
    JOIN driver_locations dl ON dl.driver_id = u.id
    LEFT JOIN driver_details dd ON dd.user_id = u.id
    LEFT JOIN vehicle_categories vc ON vc.id = dd.vehicle_category_id
    WHERE u.user_type = 'driver'
      AND SQRT(
        POW((dl.lat - ${pickupLat}) * 111.32, 2) +
        POW((dl.lng - ${pickupLng}) * 111.32 * COS(RADIANS(${pickupLat})), 2)
      ) <= ${radiusKm}
    ORDER BY distance_km ASC
  `);

  const drivers: DriverDiagEntry[] = [];
  const summary: Record<string, number> = {};
  const bump = (k: string) => { summary[k] = (summary[k] || 0) + 1; };

  for (const row of nearby.rows as any[]) {
    const reasons: ExclusionReason[] = [];

    if (!row.is_active) reasons.push("inactive");
    if (row.is_locked) reasons.push("locked");

    if (!row.dl_is_online) reasons.push("offline");
    if (row.current_trip_id) reasons.push("busy");
    if ((Number(row.lat) === 0 && Number(row.lng) === 0) ||
        row.lat == null || row.lng == null) reasons.push("gps_invalid");

    const wantedVc = trip.vehicle_category_id ? String(trip.vehicle_category_id) : null;
    const driverVc = row.vehicle_category_id ? String(row.vehicle_category_id) : null;
    if (wantedVc && driverVc !== wantedVc) reasons.push("vehicle_mismatch");

    // Parcel dispatch requires strict 'approved'; ride dispatch accepts approved/verified/pending
    const vs = String(row.verification_status || "");
    if (isParcel) {
      if (vs !== "approved") reasons.push("not_verified");
    } else {
      if (!["approved", "verified", "pending"].includes(vs)) reasons.push("not_verified");
    }

    // Stale location freshness differs by service:
    //   parcel (Porter-strict): >30 seconds old
    //   ride:                   >30 min (or >4h if marked online)
    const updatedAt = row.location_updated_at ? new Date(row.location_updated_at).getTime() : 0;
    const secsSince = updatedAt ? Math.round((Date.now() - updatedAt) / 1000) : null;
    const minsSince = secsSince != null ? Math.round(secsSince / 60) : null;
    const isStale = isParcel
      ? (secsSince != null && secsSince > 30)
      : (minsSince != null && ((minsSince > 30 && !row.is_online) || minsSince > 240));
    if (isStale) reasons.push("stale_location");

    const status: "ELIGIBLE" | "EXCLUDED" = reasons.length === 0 ? "ELIGIBLE" : "EXCLUDED";
    reasons.forEach(bump);

    const entry: DriverDiagEntry = {
      driverId: row.id,
      fullName: row.full_name || null,
      distanceKm: Number(Number(row.distance_km).toFixed(3)),
      status,
      reasons,
    };

    if (opts.includeRawData) {
      entry.data = {
        vehicle_category_id: driverVc,
        vehicle_category_name: row.vehicle_category_name || null,
        is_online: !!row.is_online,
        dl_is_online: !!row.dl_is_online,
        current_trip_id: row.current_trip_id || null,
        verification_status: row.verification_status || null,
        is_active: !!row.is_active,
        is_locked: !!row.is_locked,
        lat: Number(row.lat),
        lng: Number(row.lng),
        location_updated_at: row.location_updated_at
          ? new Date(row.location_updated_at).toISOString()
          : null,
        minutes_since_update: minsSince,
      };
    }

    drivers.push(entry);
  }

  const eligible = drivers.filter(d => d.status === "ELIGIBLE");
  const filtered = opts.includeEligible === false
    ? drivers.filter(d => d.status === "EXCLUDED")
    : drivers;

  const result: DispatchDiagResult = {
    tripId,
    tripStatus: trip.current_status || "unknown",
    tripType: trip.trip_type || "normal",
    serviceType,
    vehicleCategoryId: trip.vehicle_category_id || null,
    vehicleCategory: trip.vehicle_category_name || null,
    pickup: { lat: pickupLat, lng: pickupLng },
    radiusKm,
    driversChecked: drivers.length,
    driversEligible: eligible.length,
    summary,
    drivers: filtered,
  };

  if (opts.simulate) {
    const pick = eligible[0];
    result.simulatedDecision = pick
      ? {
          wouldNotifyDriverId: pick.driverId,
          reason: `closest eligible driver at ${pick.distanceKm}km`,
        }
      : {
          wouldNotifyDriverId: null,
          reason: drivers.length === 0
            ? `no drivers within ${radiusKm}km`
            : `all ${drivers.length} nearby drivers excluded`,
        };
  }

  console.log(
    `[DISPATCH_DIAG] tripId=${tripId} serviceType=${serviceType} ` +
    `radiusKm=${radiusKm} driversChecked=${drivers.length} ` +
    `driversEligible=${eligible.length}`
  );

  return result;
}
