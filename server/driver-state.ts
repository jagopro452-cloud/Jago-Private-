import { db } from "./db";
import { sql } from "drizzle-orm";

const rawDb = db;
const rawSql = sql;

export type DriverState = "PENDING" | "DOC_SUBMITTED" | "VERIFIED" | "ACTIVE" | "BLOCKED";

const ALLOWED_DRIVER_TRANSITIONS: Record<DriverState, DriverState[]> = {
  PENDING: ["DOC_SUBMITTED", "BLOCKED"],
  DOC_SUBMITTED: ["VERIFIED", "BLOCKED"],
  VERIFIED: ["ACTIVE", "BLOCKED"],
  ACTIVE: ["BLOCKED"],
  BLOCKED: [],
};

export interface DriverStateMeta {
  actor?: string;
  actorId?: string | null;
  adminId?: string | null;
  note?: string | null;
  [key: string]: unknown;
}

export interface DriverStateRow {
  id: string;
  verification_status: string | null;
  vehicle_status: string | null;
  is_active: boolean | null;
  is_locked: boolean | null;
  rejection_note: string | null;
  state: DriverState;
}

function mapUserRowToDriverState(row: any): DriverState {
  if (row?.is_locked === true) return "BLOCKED";
  const verificationStatus = String(row?.verification_status || "pending").toLowerCase();
  if (verificationStatus === "approved" && row?.is_active === true) return "ACTIVE";
  if (verificationStatus === "approved" || verificationStatus === "verified") return "VERIFIED";
  if (verificationStatus === "under_review") return "DOC_SUBMITTED";
  return "PENDING";
}

export function assertTransition(current: DriverState, next: DriverState): void {
  if (!ALLOWED_DRIVER_TRANSITIONS[current].includes(next)) {
    throw new Error(`Invalid driver state transition: ${current} -> ${next}`);
  }
}

export function transitionDriverState(current: DriverState, next: DriverState): void {
  assertTransition(current, next);
}

export function activeDriverEligibilitySql(alias = "u") {
  return rawSql.raw(`${alias}.is_active = true AND ${alias}.is_locked = false AND ${alias}.verification_status IN ('approved', 'verified')`);
}

export async function logDriverEvent(driverId: string, event: string, meta: DriverStateMeta = {}): Promise<void> {
  await rawDb.execute(rawSql`
    INSERT INTO driver_events (driver_id, event, data, created_at)
    VALUES (${driverId}::uuid, ${event}, ${JSON.stringify(meta)}::jsonb, NOW())
  `);
}

export async function getDriver(driverId: string): Promise<DriverStateRow> {
  const result = await rawDb.execute(rawSql`
    SELECT id, verification_status, vehicle_status, is_active, is_locked, rejection_note
    FROM users
    WHERE id=${driverId}::uuid AND user_type='driver'
    LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) {
    throw new Error(`Driver not found: ${driverId}`);
  }
  return {
    ...row,
    state: mapUserRowToDriverState(row),
  } as DriverStateRow;
}

export async function getDriverState(driverId: string): Promise<DriverState> {
  const driver = await getDriver(driverId);
  return driver.state;
}

function buildDriverStateSetters(next: DriverState, note?: string | null) {
  switch (next) {
    case "PENDING":
      return [
        rawSql`verification_status='pending'`,
        rawSql`vehicle_status='pending'`,
        rawSql`is_active=false`,
        rawSql`is_locked=false`,
        rawSql`rejection_note=${note || null}`,
      ];
    case "DOC_SUBMITTED":
      return [
        rawSql`verification_status='under_review'`,
        rawSql`vehicle_status='under_review'`,
        rawSql`is_active=false`,
        rawSql`is_locked=false`,
        rawSql`rejection_note=${note || null}`,
      ];
    case "VERIFIED":
      return [
        rawSql`verification_status='verified'`,
        rawSql`vehicle_status='verified'`,
        rawSql`is_active=false`,
        rawSql`is_locked=false`,
        rawSql`rejection_note=${note || null}`,
      ];
    case "ACTIVE":
      return [
        rawSql`verification_status='approved'`,
        rawSql`vehicle_status='approved'`,
        rawSql`is_active=true`,
        rawSql`is_locked=false`,
        rawSql`rejection_note=${note || null}`,
      ];
    case "BLOCKED":
      return [
        rawSql`is_active=false`,
        rawSql`is_locked=true`,
        rawSql`rejection_note=${note || null}`,
      ];
  }
}

export async function updateDriverState(driverId: string, next: DriverState, meta: DriverStateMeta = {}): Promise<DriverStateRow> {
  const driver = await getDriver(driverId);
  assertTransition(driver.state, next);
  const setters = buildDriverStateSetters(next, typeof meta.note === "string" ? meta.note : null);
  await rawDb.execute(rawSql`
    UPDATE users
    SET ${rawSql.join([...setters, rawSql`updated_at=NOW()`], rawSql`, `)}
    WHERE id=${driverId}::uuid AND user_type='driver'
  `);
  await logDriverEvent(driverId, next, {
    ...meta,
    from: driver.state,
    to: next,
  });
  return getDriver(driverId);
}

export async function assertDriverTransition(driverId: string, next: DriverState): Promise<void> {
  const current = await getDriverState(driverId);
  assertTransition(current, next);
}
