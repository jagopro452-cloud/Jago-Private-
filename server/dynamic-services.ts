/**
 * Dynamic Services & Parcel Vehicles Engine
 * 
 * Controls service visibility per city, parcel vehicle configs,
 * and provides the unified API for customer/driver apps.
 */

import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";
import { assertSchemaObjectsOrThrow } from "./schema-health";
import { getZoneAtLocation, serviceMatchesZoneType } from "./zone-service";

// ════════════════════════════════════════════════════════════════════════════
//  DB TABLE INIT
// ════════════════════════════════════════════════════════════════════════════

export async function initDynamicServicesTables(): Promise<void> {
  await assertSchemaObjectsOrThrow({
    tables: ["platform_services", "city_services", "parcel_vehicle_types", "city_parcel_vehicles"],
  });

  console.log("[DYNAMIC-SVC] Schema verified");
}

interface CityMatch {
  cityName: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

/**
 * Find the closest city for given coordinates.
 * Uses Haversine within the radius_km configured for each city.
 */
export async function detectCity(lat: number, lng: number): Promise<CityMatch | null> {
  try {
    const r = await rawDb.execute(rawSql`
      SELECT DISTINCT city_name, city_lat, city_lng, radius_km,
        (6371 * acos(
          cos(radians(${lat})) * cos(radians(city_lat)) *
          cos(radians(city_lng) - radians(${lng})) +
          sin(radians(${lat})) * sin(radians(city_lat))
        )) AS distance_km
      FROM city_services
      WHERE city_lat IS NOT NULL AND city_lng IS NOT NULL
      ORDER BY distance_km ASC
      LIMIT 1
    `);
    if (!r.rows.length) return null;
    const row = r.rows[0] as any;
    const dist = Number(row.distance_km) || 0;
    const radius = Number(row.radius_km) || 30;
    if (dist > radius) return null;
    return {
      cityName: row.city_name,
      lat: Number(row.city_lat),
      lng: Number(row.city_lng),
      radiusKm: radius,
    };
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  LOCATION-BASED SERVICES
// ════════════════════════════════════════════════════════════════════════════

export interface DynamicService {
  key: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  shortDescription: string;
  imageUrl: string;
  etaLabel: string;
  category: string;
  revenueModel: string;
}

export interface LocationServicesResult {
  services: DynamicService[];
  inZone: boolean;
  zoneId: string | null;
  zoneName: string | null;
  message: string | null;
}

/**
 * Get services available at a given location.
 * Only returns services when lat/lng is inside an active admin zone polygon.
 */
export async function getServicesForLocation(
  lat?: number, lng?: number
): Promise<LocationServicesResult> {
  const empty: LocationServicesResult = {
    services: [],
    inZone: false,
    zoneId: null,
    zoneName: null,
    message: "We are coming soon to your area. JAGO services are available only inside configured service zones.",
  };

  if (!lat || !lng || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ...empty, message: "Enable location to see services available in your area." };
  }

  const zone = await getZoneAtLocation(lat, lng);
  if (!zone) return empty;

  const r = await rawDb.execute(rawSql`
    SELECT service_key as key, service_name as name, icon, color,
      description, COALESCE(short_description, '') as short_description,
      COALESCE(image_url, '') as image_url, COALESCE(eta_label, '') as eta_label,
      service_category as category, revenue_model
    FROM platform_services
    WHERE service_status = 'active'
    ORDER BY sort_order ASC
  `);

  const services: DynamicService[] = (r.rows as any[])
    .filter(row => serviceMatchesZoneType(row.category, row.key, zone.serviceType))
    .map(row => ({
      key: row.key,
      name: row.name,
      icon: row.icon || '🚗',
      color: row.color || '#2D8CFF',
      description: row.description || '',
      shortDescription: row.short_description || '',
      imageUrl: row.image_url || '',
      etaLabel: row.eta_label || '',
      category: row.category || 'rides',
      revenueModel: row.revenue_model || 'commission',
    }));

  return {
    services,
    inZone: true,
    zoneId: zone.id,
    zoneName: zone.name,
    message: services.length ? null : "Services in this zone are being configured. Please check back soon.",
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  DYNAMIC PARCEL VEHICLES
// ════════════════════════════════════════════════════════════════════════════

export interface ParcelVehicleType {
  key: string;
  name: string;
  subtitle: string;
  icon: string;
  imageUrl: string;
  capacityLabel: string;
  maxWeightKg: number;
  suitableItems: string;
  accentColor: string;
  baseFare: number;
  perKm: number;
  perKg: number;
  loadCharge: number;
  etaMinutes: number;
}

/**
 * Get parcel vehicles available at a location.
 * City-specific filtering with ETA, falls back to globally active vehicles.
 */
export async function getParcelVehiclesForLocation(
  lat?: number, lng?: number
): Promise<{ vehicles: ParcelVehicleType[]; city: string | null; inZone: boolean }> {
  if (!lat || !lng) {
    return { vehicles: [], city: null, inZone: false };
  }

  const zone = await getZoneAtLocation(lat, lng);
  if (!zone || !serviceMatchesZoneType("parcel", "parcel_delivery", zone.serviceType)) {
    return { vehicles: [], city: null, inZone: false };
  }

  const r = await rawDb.execute(rawSql`
    SELECT vehicle_key as key, name, subtitle, icon,
      COALESCE(image_url, '') as image_url, capacity_label,
      max_weight_kg, suitable_items, accent_color,
      base_fare, per_km, per_kg, load_charge, 5 as eta_minutes
    FROM parcel_vehicle_types
    WHERE is_active = true
    ORDER BY sort_order ASC
  `);
  const vehicles: ParcelVehicleType[] = (r.rows as any[]).map(row => ({
    key: row.key,
    name: row.name,
    subtitle: row.subtitle || '',
    icon: row.icon || '📦',
    imageUrl: row.image_url || '',
    capacityLabel: row.capacity_label || '',
    maxWeightKg: Number(row.max_weight_kg) || 10,
    suitableItems: row.suitable_items || '',
    accentColor: row.accent_color || '#16A34A',
    baseFare: Number(row.base_fare) || 40,
    perKm: Number(row.per_km) || 12,
    perKg: Number(row.per_kg) || 4,
    loadCharge: Number(row.load_charge) || 0,
    etaMinutes: Number(row.eta_minutes) || 5,
  }));

  return { vehicles, city: zone.name, inZone: true };
}

/**
 * Recommend best vehicle for given weight/dimensions.
 */
export function recommendVehicle(
  vehicles: ParcelVehicleType[], weightKg: number
): ParcelVehicleType | null {
  // Find smallest vehicle that can carry the weight
  const sorted = [...vehicles].sort((a, b) => a.maxWeightKg - b.maxWeightKg);
  return sorted.find(v => v.maxWeightKg >= weightKg) || sorted[sorted.length - 1] || null;
}

// ════════════════════════════════════════════════════════════════════════════
//  DRIVER SERVICE ELIGIBILITY
// ════════════════════════════════════════════════════════════════════════════

export interface DriverServiceConfig {
  services: DynamicService[];
  parcelVehicles: ParcelVehicleType[];
}

/**
 * Get services a driver is eligible for based on their vehicle type.
 */
export async function getDriverEligibleServices(
  driverId: string
): Promise<DriverServiceConfig> {
  // Determine driver's vehicle type
  const driverR = await rawDb.execute(rawSql`
    SELECT vc.name as vehicle_name, vc.vehicle_type as vehicle_type_code
    FROM users u
    LEFT JOIN driver_details dd ON dd.user_id = u.id
    LEFT JOIN vehicle_categories vc ON vc.id = dd.vehicle_category_id
    WHERE u.id = ${driverId}::uuid
  `);

  const driver = driverR.rows[0] as any;
  if (!driver) return { services: [], parcelVehicles: [] };

  const vehicleName = (driver.vehicle_name || "").toLowerCase();
  const vehicleCode = (driver.vehicle_type_code || '').toLowerCase();

  // Get all active services
  const svcR = await rawDb.execute(rawSql`
    SELECT service_key as key, service_name as name, icon, color,
      description, COALESCE(short_description, '') as short_description,
      COALESCE(image_url, '') as image_url, COALESCE(eta_label, '') as eta_label,
      service_category as category, revenue_model
    FROM platform_services WHERE service_status = 'active'
    ORDER BY sort_order ASC
  `);

  // Determine eligible services based on vehicle
  const allServices = (svcR.rows as any[]).map(row => ({
    key: row.key, name: row.name, icon: row.icon || '🚗', color: row.color || '#2F80ED',
    description: row.description || '', shortDescription: row.short_description || '',
    imageUrl: row.image_url || '', etaLabel: row.eta_label || '',
    category: row.category || 'rides', revenueModel: row.revenue_model || 'commission',
  }));

  const eligibleServices: DynamicService[] = [];
  const eligibleParcelKeys: string[] = [];

  for (const svc of allServices) {
    const isParcelVehicle = vehicleName.includes('parcel') || vehicleName.includes('cargo')
      || vehicleName.includes('truck') || vehicleName.includes('delivery')
      || vehicleCode.includes('parcel') || vehicleCode.includes('cargo');
    if (svc.category === 'rides') {
      // Match ride service to vehicle type — never treat parcel vehicles as ride drivers.
      if (svc.key === 'bike_ride' && !isParcelVehicle && (vehicleName.includes('bike') || vehicleCode === 'bike')) {
        eligibleServices.push(svc);
      } else if (svc.key === 'auto_ride' && !isParcelVehicle && (vehicleName.includes('auto') || vehicleCode === 'auto')) {
        eligibleServices.push(svc);
      } else if (['mini_car', 'sedan', 'suv', 'cab'].includes(svc.key) &&
        !isParcelVehicle &&
        (vehicleName.includes('car') || vehicleName.includes('sedan') || vehicleName.includes('suv') ||
         vehicleName.includes('cab') || vehicleName.includes('premium') || vehicleName.includes('mini') ||
         vehicleCode === 'car' || vehicleCode === 'sedan' || vehicleCode === 'suv')) {
        eligibleServices.push(svc);
      }
    } else if (svc.category === 'parcel') {
      // Parcel services only for matching parcel-capable vehicles.
      if (isParcelVehicle || vehicleName.includes('truck') || vehicleName.includes('ace') || vehicleName.includes('bolero') || vehicleName.includes('tempo')) {
        eligibleServices.push(svc);
      }
      if (vehicleName.includes('bike') || vehicleCode === 'bike') {
        eligibleParcelKeys.push('bike_parcel');
      }
      if (vehicleName.includes('auto') || vehicleCode === 'auto') {
        eligibleParcelKeys.push('auto_parcel');
      }
      if (vehicleName.includes('truck') || vehicleName.includes('ace') || vehicleName.includes('bolero')) {
        eligibleParcelKeys.push('tata_ace', 'bolero_cargo', 'pickup_truck', 'tempo_407');
      }
    } else if (svc.category === 'carpool') {
      // Carpool available for car/sedan/suv
      if (vehicleName.includes('car') || vehicleName.includes('sedan') || vehicleName.includes('suv') ||
          vehicleCode === 'car' || vehicleCode === 'sedan' || vehicleCode === 'suv') {
        eligibleServices.push(svc);
      }
    }
  }

  // Get matching parcel vehicles
  let parcelVehicles: ParcelVehicleType[] = [];
  if (eligibleParcelKeys.length > 0) {
    const parcelKeyArray = rawSql.raw(
      `ARRAY[${eligibleParcelKeys.map((key) => `'${key.replace(/'/g, "''")}'`).join(",")}]::text[]`
    );
    const pvR = await rawDb.execute(rawSql`
      SELECT vehicle_key as key, name, subtitle, icon,
        COALESCE(image_url, '') as image_url, capacity_label,
        max_weight_kg, suitable_items, accent_color,
        base_fare, per_km, per_kg, load_charge, 5 as eta_minutes
      FROM parcel_vehicle_types
      WHERE is_active = true AND vehicle_key = ANY(${parcelKeyArray})
      ORDER BY sort_order ASC
    `);
    parcelVehicles = (pvR.rows as any[]).map(row => ({
      key: row.key, name: row.name, subtitle: row.subtitle || '', icon: row.icon || '📦',
      imageUrl: row.image_url || '', capacityLabel: row.capacity_label || '',
      maxWeightKg: Number(row.max_weight_kg) || 10, suitableItems: row.suitable_items || '',
      accentColor: row.accent_color || '#16A34A', baseFare: Number(row.base_fare) || 40,
      perKm: Number(row.per_km) || 12, perKg: Number(row.per_kg) || 4,
      loadCharge: Number(row.load_charge) || 0, etaMinutes: Number(row.eta_minutes) || 5,
    }));
  }

  return { services: eligibleServices, parcelVehicles };
}

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN: CITY SERVICE MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════

export async function getCitiesWithServices(): Promise<any[]> {
  try {
    const r = await rawDb.execute(rawSql`
      SELECT cs.city_name, cs.city_lat, cs.city_lng, cs.radius_km,
        json_agg(json_build_object(
          'service_key', cs.service_key,
          'is_active', cs.is_active,
          'service_name', COALESCE(ps.service_name, cs.service_key),
          'icon', COALESCE(ps.icon, '🚗')
        ) ORDER BY ps.sort_order) as services
      FROM city_services cs
      LEFT JOIN platform_services ps ON ps.service_key = cs.service_key
      GROUP BY cs.city_name, cs.city_lat, cs.city_lng, cs.radius_km
      ORDER BY cs.city_name
    `);
    return r.rows as any[];
  } catch {
    const r = await rawDb.execute(rawSql`
      SELECT city_name, city_lat, city_lng, radius_km,
        json_agg(json_build_object(
          'service_key', service_key,
          'is_active', is_active,
          'service_name', service_key,
          'icon', '🚗'
        ) ORDER BY service_key) as services
      FROM city_services
      GROUP BY city_name, city_lat, city_lng, radius_km
      ORDER BY city_name
    `);
    return r.rows as any[];
  }
}

export async function addCityService(
  cityName: string, cityLat: number, cityLng: number, serviceKey: string, radiusKm: number = 30
): Promise<void> {
  await rawDb.execute(rawSql`
    INSERT INTO city_services (city_name, city_lat, city_lng, service_key, radius_km, is_active)
    VALUES (${cityName}, ${cityLat}, ${cityLng}, ${serviceKey}, ${radiusKm}, true)
    ON CONFLICT (city_name, service_key) DO UPDATE SET is_active = true, updated_at = NOW()
  `);
}

export async function toggleCityService(
  cityName: string, serviceKey: string, isActive: boolean
): Promise<void> {
  await rawDb.execute(rawSql`
    UPDATE city_services SET is_active = ${isActive}, updated_at = NOW()
    WHERE city_name = ${cityName} AND service_key = ${serviceKey}
  `);
}

// ════════════════════════════════════════════════════════════════════════════
//  ADMIN: PARCEL VEHICLE MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════

export async function getAllParcelVehicles(): Promise<any[]> {
  const r = await rawDb.execute(rawSql`
    SELECT * FROM parcel_vehicle_types ORDER BY sort_order ASC
  `);
  return r.rows as any[];
}

export async function updateParcelVehicle(
  vehicleKey: string, updates: Record<string, any>
): Promise<void> {
  const fields: string[] = [];
  const { name, subtitle, icon, image_url, capacity_label, max_weight_kg,
    suitable_items, accent_color, base_fare, per_km, per_kg, load_charge,
    is_active, sort_order } = updates;

  // Build dynamic update
  await rawDb.execute(rawSql`
    UPDATE parcel_vehicle_types SET
      name = COALESCE(${name ?? null}, name),
      subtitle = COALESCE(${subtitle ?? null}, subtitle),
      icon = COALESCE(${icon ?? null}, icon),
      image_url = COALESCE(${image_url ?? null}, image_url),
      capacity_label = COALESCE(${capacity_label ?? null}, capacity_label),
      max_weight_kg = COALESCE(${max_weight_kg ?? null}, max_weight_kg),
      suitable_items = COALESCE(${suitable_items ?? null}, suitable_items),
      accent_color = COALESCE(${accent_color ?? null}, accent_color),
      base_fare = COALESCE(${base_fare ?? null}, base_fare),
      per_km = COALESCE(${per_km ?? null}, per_km),
      per_kg = COALESCE(${per_kg ?? null}, per_kg),
      load_charge = COALESCE(${load_charge ?? null}, load_charge),
      is_active = COALESCE(${is_active ?? null}, is_active),
      sort_order = COALESCE(${sort_order ?? null}, sort_order),
      updated_at = NOW()
    WHERE vehicle_key = ${vehicleKey}
  `);
}

export async function addParcelVehicle(data: Record<string, any>): Promise<any> {
  const r = await rawDb.execute(rawSql`
    INSERT INTO parcel_vehicle_types
      (vehicle_key, name, subtitle, icon, image_url, capacity_label, max_weight_kg,
       suitable_items, accent_color, base_fare, per_km, per_kg, load_charge, is_active, sort_order)
    VALUES
      (${data.vehicle_key}, ${data.name}, ${data.subtitle || ''}, ${data.icon || '📦'},
       ${data.image_url || ''}, ${data.capacity_label || ''}, ${data.max_weight_kg || 10},
       ${data.suitable_items || ''}, ${data.accent_color || '#16A34A'},
       ${data.base_fare || 40}, ${data.per_km || 12}, ${data.per_kg || 4},
       ${data.load_charge || 0}, ${data.is_active !== false}, ${data.sort_order || 99})
    RETURNING *
  `);
  return (r.rows as any[])[0];
}
