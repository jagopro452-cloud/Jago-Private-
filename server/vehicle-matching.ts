import { db as rawDb } from "./db";
import { sql as rawSql } from "drizzle-orm";

export interface VehicleCategoryMeta {
  id: string;
  name: string;
  icon: string | null;
  vehicleType: string;
  serviceType: string;
  type: string;
  description: string;
  isCarpool: boolean;
}

export interface ResolvedBookingVehicleSelection {
  vehicleCategoryId: string | null;
  vehicleCategoryName: string | null;
  vehicleType: string | null;
  driverRoom: string | null;
  serviceType: string | null;
  typeMismatch: boolean;
}

export function normalizeVehicleKey(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeBookingVehicleType(value: string | null | undefined): string | null {
  const key = normalizeVehicleKey(value);
  if (!key) return null;

  if (key === "premium" || key === "premium_cab" || key === "luxury" || key === "prime_sedan") {
    return "premium";
  }

  if (key === "bike_parcel" || (key.includes("parcel") && key.includes("bike"))) return "bike_parcel";
  if (
    key === "auto_parcel" ||
    key === "mini_cargo_auto" ||
    (key.includes("parcel") && key.includes("auto"))
  ) {
    return "auto_parcel";
  }
  if (key === "tata_ace" || key === "mini_truck") return "mini_truck";
  if (key === "pickup_truck" || key === "bolero_pickup" || key === "bolero_cargo") return "pickup_truck";
  if (key === "tempo_407") return "tempo_407";

  if (
    key === "bike" ||
    key === "bike_ride" ||
    key === "motor_bike" ||
    key === "motorbike" ||
    key === "motor_cycle" ||
    key === "motorcycle" ||
    key === "two_wheeler" ||
    key === "two_wheel"
  ) {
    return "bike";
  }

  if (
    key === "auto" ||
    key === "auto_ride" ||
    key === "mini_auto" ||
    key === "rickshaw" ||
    key === "e_rickshaw" ||
    key === "three_wheeler" ||
    key === "three_wheel"
  ) {
    return "auto";
  }

  if (
    key === "car_pool_4" ||
    key === "car_pool_6" ||
    key === "pool_mini" ||
    key === "pool_sedan" ||
    key === "pool_suv" ||
    key === "carpool" ||
    key === "city_pool" ||
    key === "local_pool" ||
    key === "intercity_pool" ||
    key === "outstation_pool"
  ) {
    return key;
  }

  if (
    key === "car" ||
    key === "cab" ||
    key === "cab_ride" ||
    key === "mini" ||
    key === "mini_car" ||
    key === "sedan" ||
    key === "suv" ||
    key === "suv_xl"
  ) {
    return "car";
  }

  return key;
}

export function getDriverSocketRoomKey(meta: VehicleCategoryMeta | null): string | null {
  if (!meta) return null;
  return normalizeBookingVehicleType(meta.vehicleType || meta.name || meta.type);
}

export function getDriverDbVehicleType(vehicleType: string | null | undefined): string | null {
  const normalized = normalizeBookingVehicleType(vehicleType);
  if (normalized === "bike") return "motor_bike";
  if (normalized === "auto") return "auto";
  if (normalized === "car") return "car";
  if (normalized === "premium") return "car";
  return null;
}

function toVehicleCategoryMeta(row: any): VehicleCategoryMeta {
  return {
    id: row.id,
    name: row.name || "",
    icon: row.icon || null,
    vehicleType: normalizeVehicleKey(row.vehicle_type || row.name),
    serviceType: deriveServiceType(row),
    type: String(row.type || "").toLowerCase(),
    description: row.description || "",
    isCarpool: row.is_carpool === true || row.is_carpool === "true",
  };
}

function allowedKeysForRequestedVehicle(
  requestedVehicleType: string | null,
  requestedVehicleName: string | null | undefined,
): string[] {
  const normalizedType =
    normalizeBookingVehicleType(requestedVehicleType) ||
    normalizeBookingVehicleType(requestedVehicleName);

  switch (normalizedType) {
    case "bike":
      return ["bike"];
    case "auto":
      return ["auto"];
    case "premium":
      return ["premium", "sedan", "suv", "mini_car", "car"];
    case "car":
      if (normalizeVehicleKey(requestedVehicleName).includes("premium")) {
        return ["premium", "sedan", "suv", "mini_car", "car"];
      }
      return ["mini", "mini_car", "cab", "car", "sedan", "suv"];
    case "bike_parcel":
      return ["bike_parcel"];
    case "auto_parcel":
      return ["auto_parcel", "mini_cargo_auto"];
    case "mini_truck":
      return ["tata_ace", "mini_truck"];
    case "pickup_truck":
      return ["pickup_truck", "bolero_pickup", "bolero_cargo"];
    case "tempo_407":
      return ["tempo_407"];
    default:
      return normalizedType ? [normalizedType] : [];
  }
}

function scoreVehicleCandidate(
  meta: VehicleCategoryMeta,
  requestedVehicleType: string | null,
  requestedVehicleName: string | null | undefined,
  allowedKeys: Set<string>,
): number {
  const rowKey = normalizeVehicleKey(meta.vehicleType || meta.name);
  if (!allowedKeys.has(rowKey)) return -1;

  const requestedType =
    normalizeBookingVehicleType(requestedVehicleType) ||
    normalizeBookingVehicleType(requestedVehicleName);
  const requestedNameKey = normalizeVehicleKey(requestedVehicleName);
  const rowNameKey = normalizeVehicleKey(meta.name);

  let score = 100;

  if (requestedType === "bike" && rowKey === "bike") score += 60;
  if (requestedType === "auto" && rowKey === "auto") score += 60;
  if (requestedType === "premium" && rowKey === "premium") score += 85;
  if (requestedType === "car") {
    if (rowKey === "premium") score += requestedNameKey.includes("premium") ? 60 : 10;
    if (rowKey === "mini" || rowKey === "mini_car" || rowKey === "cab" || rowKey === "car") score += 40;
    if (rowKey === "sedan") score += 35;
    if (rowKey === "suv") score += 30;
  }
  if (requestedType === "bike_parcel" && rowKey === "bike_parcel") score += 80;
  if (requestedType === "auto_parcel" && (rowKey === "auto_parcel" || rowKey === "mini_cargo_auto")) score += 80;
  if (requestedType === "mini_truck" && (rowKey === "mini_truck" || rowKey === "tata_ace")) score += 80;
  if (requestedType === "pickup_truck" && rowKey === "pickup_truck") score += 80;
  if (requestedType === "tempo_407" && rowKey === "tempo_407") score += 80;

  if (!requestedNameKey) return score;

  if (requestedNameKey === rowNameKey || requestedNameKey === rowKey) score += 220;
  if (requestedNameKey.includes("premium") && rowNameKey.includes("premium")) score += 160;
  if (requestedNameKey.includes("bike") && rowNameKey.includes("bike")) score += 140;
  if (requestedNameKey.includes("auto") && rowNameKey.includes("auto")) score += 140;
  if (requestedNameKey.includes("cab") && (rowNameKey.includes("cab") || rowNameKey.includes("car"))) score += 120;
  if (requestedNameKey.includes("car") && rowNameKey.includes("car")) score += 110;
  if (requestedNameKey.includes("sedan") && rowNameKey.includes("sedan")) score += 140;
  if (requestedNameKey.includes("suv") && rowNameKey.includes("suv")) score += 140;
  if (requestedNameKey.includes("parcel") && rowNameKey.includes("parcel")) score += 150;
  if (requestedNameKey.includes("truck") && rowNameKey.includes("truck")) score += 150;
  if (requestedNameKey.includes("pickup") && rowNameKey.includes("pickup")) score += 150;
  if (requestedNameKey.includes("mini") && rowNameKey.includes("mini")) score += 90;

  return score;
}

async function findVehicleCategoryMetaByHint(params: {
  vehicleType?: string | null;
  vehicleCategoryName?: string | null;
}): Promise<VehicleCategoryMeta | null> {
  const inferredType =
    normalizeBookingVehicleType(params.vehicleType) ||
    normalizeBookingVehicleType(params.vehicleCategoryName);
  const allowedKeys = new Set(
    allowedKeysForRequestedVehicle(inferredType, params.vehicleCategoryName),
  );
  if (!allowedKeys.size) return null;

  const categories = await rawDb.execute(rawSql`
    SELECT
      id,
      name,
      icon,
      COALESCE(NULLIF(vehicle_type, ''), name) as vehicle_type,
      COALESCE(service_type, '') as service_type,
      COALESCE(type, '') as type,
      COALESCE(description, '') as description,
      COALESCE(is_carpool, false) as is_carpool
    FROM vehicle_categories
    WHERE is_active = true
  `).catch(() => ({ rows: [] as any[] }));

  let bestMeta: VehicleCategoryMeta | null = null;
  let bestScore = -1;
  for (const row of categories.rows as any[]) {
    const meta = toVehicleCategoryMeta(row);
    const score = scoreVehicleCandidate(
      meta,
      params.vehicleType || null,
      params.vehicleCategoryName,
      allowedKeys,
    );
    if (score > bestScore) {
      bestScore = score;
      bestMeta = meta;
    }
  }

  return bestScore >= 0 ? bestMeta : null;
}

export function uuidArraySql(ids: string[]) {
  const safeIds = ids.filter(Boolean);
  if (!safeIds.length) return rawSql.raw("ARRAY[]::uuid[]");
  return rawSql.raw(`ARRAY[${safeIds.map((id) => `'${id}'::uuid`).join(", ")}]`);
}
function deriveServiceType(row: any): string {
  const explicit = String(row.service_type || "").trim().toLowerCase();
  if (explicit) return explicit;
  if (row.is_carpool === true || row.is_carpool === "true") return "pool";
  const type = String(row.type || "").trim().toLowerCase();
  if (type === "parcel" || type === "cargo") return "parcel";
  const key = normalizeVehicleKey(row.vehicle_type || row.name);
  if (key.includes("parcel") || key.includes("truck") || key.includes("tempo") || key.includes("pickup")) {
    return "parcel";
  }
  if (key.includes("pool") || key.includes("carpool") || key.includes("share")) {
    return "pool";
  }
  return "ride";
}

function allowedVehicleKeys(meta: VehicleCategoryMeta): string[] {
  const key = normalizeVehicleKey(meta.vehicleType || meta.name);
  const serviceType = normalizeVehicleKey(meta.serviceType);

  if (serviceType === "parcel" || key.includes("parcel") || key.includes("truck") || key.includes("pickup") || key.includes("tempo")) {
    // Strict separation: parcel bookings must NEVER reach ride-only drivers.
    // Previously bike_parcel fell back to plain "bike" and auto_parcel fell
    // back to plain "auto", which meant a parcel booking would notify regular
    // ride drivers — confusing for them and against rider/pilot expectations.
    switch (key) {
      case "bike_parcel":
        return ["bike_parcel"];
      case "auto_parcel":
      case "mini_cargo_auto":
        return ["auto_parcel", "mini_cargo_auto"];
      case "tata_ace":
      case "mini_truck":
        return ["tata_ace", "mini_truck"];
      case "pickup_truck":
      case "bolero_pickup":
      case "bolero_cargo":
        return ["pickup_truck", "bolero_pickup", "bolero_cargo"];
      case "tempo_407":
        return ["tempo_407"];
      default:
        return [key];
    }
  }

  if (serviceType === "pool" || meta.isCarpool || key.includes("pool") || key.includes("carpool") || key.includes("share")) {
    switch (key) {
      case "car_pool_4":
      case "car_pool_6":
        return [key];
      case "pool_mini":
        return ["pool_mini"];
      case "pool_sedan":
        return ["pool_sedan"];
      case "pool_suv":
        return ["pool_suv"];
      case "carpool":
      case "city_pool":
      case "local_pool":
        return ["carpool", "city_pool", "local_pool", "car_pool_4", "car_pool_6"];
      case "intercity_pool":
        return ["intercity_pool", "car_pool_4", "car_pool_6"];
      case "outstation_pool":
        return ["outstation_pool", "car_pool_4", "car_pool_6", "pool_sedan", "pool_suv"];
      default:
        return [key];
    }
  }

  switch (key) {
    case "bike":
    case "bike_ride":
      return ["bike"];
    case "auto":
    case "auto_ride":
      return ["auto"];
    case "premium":
      return ["premium"];
    case "mini_car":
    case "car":
      return ["mini_car"];
    case "sedan":
      return ["sedan"];
    case "suv":
    case "suv_xl":
      return ["suv"];
    default:
      return [key];
  }
}

export async function getVehicleCategoryMeta(categoryId?: string | null): Promise<VehicleCategoryMeta | null> {
  if (!categoryId) return null;
  const result = await rawDb.execute(rawSql`
    SELECT
      id,
      name,
      icon,
      COALESCE(vehicle_type, '') as vehicle_type,
      COALESCE(service_type, '') as service_type,
      COALESCE(type, '') as type,
      COALESCE(description, '') as description,
      COALESCE(is_carpool, false) as is_carpool
    FROM vehicle_categories
    WHERE id = ${categoryId}::uuid
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));

  if (!result.rows.length) return null;
  return toVehicleCategoryMeta(result.rows[0] as any);
}

export async function getDriverSocketRoomKeyForCategoryId(categoryId?: string | null): Promise<string | null> {
  const meta = await getVehicleCategoryMeta(categoryId);
  return getDriverSocketRoomKey(meta);
}

export async function resolveBookingVehicleSelection(params: {
  vehicleCategoryId?: string | null;
  vehicleType?: string | null;
  vehicleCategoryName?: string | null;
}): Promise<ResolvedBookingVehicleSelection> {
  const inferredVehicleType =
    normalizeBookingVehicleType(params.vehicleType) ||
    normalizeBookingVehicleType(params.vehicleCategoryName);
  const meta =
    (await getVehicleCategoryMeta(params.vehicleCategoryId)) ||
    (await findVehicleCategoryMetaByHint({
      vehicleType: inferredVehicleType,
      vehicleCategoryName: params.vehicleCategoryName,
    }));
  const categoryVehicleType = getDriverSocketRoomKey(meta);
  const requestedVehicleType = inferredVehicleType;

  return {
    vehicleCategoryId: meta?.id ?? (params.vehicleCategoryId || null),
    vehicleCategoryName: meta?.name ?? null,
    vehicleType: categoryVehicleType || requestedVehicleType,
    driverRoom:
      categoryVehicleType || requestedVehicleType
        ? `drivers_${categoryVehicleType || requestedVehicleType}`
        : null,
    serviceType: meta?.serviceType ?? null,
    typeMismatch:
      Boolean(categoryVehicleType) &&
      Boolean(requestedVehicleType) &&
      categoryVehicleType !== requestedVehicleType,
  };
}

export async function getMatchingDriverCategoryIds(categoryId?: string | null): Promise<string[] | null> {
  const meta = await getVehicleCategoryMeta(categoryId);
  if (!meta) return categoryId ? [categoryId] : null;

  const allowedKeys = new Set(allowedVehicleKeys(meta));
  const categories = await rawDb.execute(rawSql`
    SELECT
      id,
      name,
      COALESCE(vehicle_type, '') as vehicle_type,
      COALESCE(service_type, '') as service_type,
      COALESCE(type, '') as type,
      COALESCE(is_carpool, false) as is_carpool
    FROM vehicle_categories
    WHERE is_active = true
  `).catch(() => ({ rows: [] as any[] }));

  const ids = (categories.rows as any[])
    .filter((row) => {
      const rawKey = normalizeVehicleKey(row.vehicle_type || row.name);
      const canonicalKey = normalizeBookingVehicleType(row.vehicle_type || row.name) || rawKey;
      return allowedKeys.has(rawKey) || allowedKeys.has(canonicalKey);
    })
    .map((row) => row.id as string);

  return ids.length ? ids : [meta.id];
}

export function getPlatformServiceKeyForCategory(meta: VehicleCategoryMeta | null): string | null {
  if (!meta) return null;
  const key = normalizeVehicleKey(meta.vehicleType || meta.name);

  if (meta.serviceType === "parcel") return "parcel_delivery";
  if (meta.serviceType === "pool" || meta.isCarpool || key.includes("pool") || key.includes("share")) {
    if (key.includes("outstation")) return "outstation_pool";
    if (key.includes("intercity")) return "intercity_pool";
    return "city_pool";
  }
  if (key === "bike") return "bike_ride";
  if (key === "auto") return "auto_ride";
  if (key === "premium") return "sedan";
  if (key === "mini_car" || key === "car" || key === "pool_mini") return "mini_car";
  if (key === "sedan" || key === "pool_sedan") return "sedan";
  if (key === "suv" || key === "pool_suv") return "suv";
  return "bike_ride";
}
