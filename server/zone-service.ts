/**
 * Zone detection for service availability.
 * Admin Zone Setup polygons are the source of truth for where JAGO operates.
 */

import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";

export interface ZoneMatch {
  id: string;
  name: string;
  serviceType: string;
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** GeoJSON [lng, lat] ring ray-cast point-in-polygon */
function pointInPolygon(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi) / (yj - yi) + xi))) inside = !inside;
  }
  return inside;
}

/** Returns the active zone a lat/lng falls inside, or null when outside all zones. */
export async function getZoneAtLocation(lat: number, lng: number): Promise<ZoneMatch | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null;
  try {
    const zones = await rawDb.execute(rawSql`
      SELECT id, name, coordinates, latitude, longitude, radius_km, service_type
      FROM zones WHERE is_active = true
    `);

    for (const z of zones.rows as any[]) {
      if (!z.coordinates) continue;
      try {
        const geo = JSON.parse(z.coordinates);
        let inside = false;
        if (geo.type === "Polygon" && geo.coordinates?.[0]) {
          inside = pointInPolygon(lat, lng, geo.coordinates[0]);
        } else if (geo.type === "MultiPolygon") {
          for (const poly of geo.coordinates) {
            if (poly?.[0] && pointInPolygon(lat, lng, poly[0])) {
              inside = true;
              break;
            }
          }
        }
        if (inside) {
          return {
            id: String(z.id),
            name: String(z.name || "Service Zone"),
            serviceType: String(z.service_type || "both"),
          };
        }
      } catch { /* skip malformed polygon */ }
    }

    for (const z of zones.rows as any[]) {
      if (z.coordinates) continue;
      const cLat = Number(z.latitude);
      const cLng = Number(z.longitude);
      if (!cLat || !cLng) continue;
      const d = haversineKm(lat, lng, cLat, cLng);
      const r = Number(z.radius_km || 5);
      if (d <= r) {
        return {
          id: String(z.id),
          name: String(z.name || "Service Zone"),
          serviceType: String(z.service_type || "both"),
        };
      }
    }
  } catch { /* zones table unavailable */ }
  return null;
}

export async function isLocationServiceable(lat: number, lng: number): Promise<boolean> {
  const zone = await getZoneAtLocation(lat, lng);
  return zone !== null;
}

export async function detectZoneId(lat: number, lng: number): Promise<string | null> {
  const zone = await getZoneAtLocation(lat, lng);
  return zone?.id ?? null;
}

/** Filter platform service rows by zone service type (both | ride | parcel). */
export function serviceMatchesZoneType(serviceCategory: string, serviceKey: string, zoneServiceType: string): boolean {
  const zoneType = String(zoneServiceType || "both").toLowerCase();
  const category = String(serviceCategory || "").toLowerCase();
  const key = String(serviceKey || "").toLowerCase();

  if (zoneType === "both") return true;
  if (zoneType === "ride") {
    return category === "rides" || category === "carpool" || key.endsWith("_ride") || key.includes("pool");
  }
  if (zoneType === "parcel") {
    return category === "parcel" || key === "parcel_delivery" || key.includes("parcel");
  }
  return true;
}
