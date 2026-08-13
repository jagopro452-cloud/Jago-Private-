import fs from "node:fs/promises";
import path from "node:path";
import type { AdminSession, MobileSession, VehicleCategory } from "./live-client";
import { runtime } from "./runtime";

export type SharedLiveActor = {
  label: string;
  phone: string;
  session: MobileSession;
};

export type SharedLiveSuiteState = {
  version: 1;
  envName: string;
  qaRunId: string;
  createdAt: string;
  bootstrapMode: "seed" | "fallback";
  admin: {
    session: AdminSession;
  };
  categories: {
    bike: VehicleCategory;
    auto: VehicleCategory;
    cab: VehicleCategory;
    pool: VehicleCategory | null;
  };
  actors: {
    customerPrimary: SharedLiveActor;
    customerSecondary: SharedLiveActor | null;
    driverBikePrimary: SharedLiveActor;
    driverBikeSecondary: SharedLiveActor;
    driverBikeTertiary: SharedLiveActor;
    driverBikeQuaternary: SharedLiveActor;
    driverAutoPrimary: SharedLiveActor | null;
    driverCabPrimary: SharedLiveActor;
  };
  artifacts: {
    tripIds: string[];
    parcelOrderIds: string[];
    outstationRideIds: string[];
    notes: string[];
    bookingEvents: Array<{
      id: string;
      customerPhone: string;
      kind: string;
      createdAt: string;
      releasedAt?: string;
    }>;
  };
};

const liveStateDir = path.resolve(process.cwd(), "test-results", ".live");
const liveStatePath = path.join(liveStateDir, "suite-state.json");
const adminStorageStatePath = path.join(liveStateDir, "admin-storage-state.json");

export function getLiveSuiteStatePath() {
  return liveStatePath;
}

export function getAdminStorageStatePath() {
  return adminStorageStatePath;
}

export async function ensureLiveStateDir() {
  await fs.mkdir(liveStateDir, { recursive: true });
}

export async function writeLiveSuiteState(state: SharedLiveSuiteState) {
  const normalized = normalizeLiveSuiteState(state);
  await ensureLiveStateDir();
  await fs.writeFile(liveStatePath, JSON.stringify(normalized, null, 2), "utf8");
  await fs.writeFile(adminStorageStatePath, JSON.stringify(createAdminStorageState(normalized.admin.session), null, 2), "utf8");
}

export async function readLiveSuiteState() {
  const raw = await fs.readFile(liveStatePath, "utf8");
  return normalizeLiveSuiteState(JSON.parse(raw) as SharedLiveSuiteState);
}

export async function requireLiveSuiteState() {
  try {
    return await readLiveSuiteState();
  } catch (error) {
    throw new Error(`Shared live suite state is missing. Run the live global setup first. ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function recordLiveArtifact(
  kind: keyof SharedLiveSuiteState["artifacts"],
  id: string,
) {
  if (!id) return;
  const state = await requireLiveSuiteState();
  const bucket = state.artifacts[kind];
  if (!bucket.includes(id)) {
    bucket.push(id);
    await writeLiveSuiteState(state);
  }
}

export async function recordLiveNote(note: string) {
  if (!note) return;
  const state = await requireLiveSuiteState();
  state.artifacts.notes.push(note);
  await writeLiveSuiteState(state);
}

export async function upsertLiveActor(
  actorKey: keyof SharedLiveSuiteState["actors"],
  actor: SharedLiveActor,
) {
  const state = await requireLiveSuiteState();
  state.actors[actorKey] = actor as any;
  await writeLiveSuiteState(state);
}

export async function updateLiveActorSession(phone: string, userType: string, session: MobileSession) {
  if (!phone || !userType) return;
  const state = await requireLiveSuiteState();
  let updated = false;

  for (const actor of Object.values(state.actors)) {
    if (!actor) continue;
    if (actor.phone !== phone) continue;
    if (actor.session.user.userType !== userType) continue;
    actor.session = session;
    updated = true;
  }

  if (updated) {
    await writeLiveSuiteState(state);
  }
}

export async function recordLiveBookingEvent(event: {
  id: string;
  customerPhone: string;
  kind: string;
  createdAt?: string;
}) {
  const state = await requireLiveSuiteState();
  const createdAt = event.createdAt || new Date().toISOString();
  const existing = state.artifacts.bookingEvents.find((item) => item.id === event.id);
  if (existing) {
    existing.customerPhone = event.customerPhone;
    existing.kind = event.kind;
    existing.createdAt = createdAt;
  } else {
    state.artifacts.bookingEvents.push({
      id: event.id,
      customerPhone: event.customerPhone,
      kind: event.kind,
      createdAt,
    });
  }
  await writeLiveSuiteState(state);
}

export async function markLiveBookingReleased(id: string) {
  if (!id) return;
  const state = await requireLiveSuiteState();
  const booking = state.artifacts.bookingEvents.find((item) => item.id === id);
  if (!booking) return;
  booking.releasedAt = new Date().toISOString();
  await writeLiveSuiteState(state);
}

export async function getRecentLiveBookingEvents(windowMs = 60 * 60 * 1000) {
  const state = await requireLiveSuiteState();
  const cutoff = Date.now() - windowMs;
  return state.artifacts.bookingEvents.filter((item) => new Date(item.createdAt).getTime() >= cutoff);
}

export async function clearLiveSuiteState() {
  await Promise.all([
    fs.rm(liveStatePath, { force: true }).catch(() => undefined),
    fs.rm(adminStorageStatePath, { force: true }).catch(() => undefined),
  ]);
}

export function createAdminStorageState(admin: AdminSession) {
  return {
    cookies: [],
    origins: [
      {
        origin: runtime.baseURL,
        localStorage: [
          {
            name: "jago-admin",
            value: JSON.stringify({
              ...admin.admin,
              admin: admin.admin,
              token: admin.token,
              expiresAt: admin.expiresAt,
            }),
          },
        ],
      },
    ],
  };
}

function normalizeLiveSuiteState(state: SharedLiveSuiteState) {
  return {
    ...state,
    artifacts: {
      tripIds: state.artifacts?.tripIds || [],
      parcelOrderIds: state.artifacts?.parcelOrderIds || [],
      outstationRideIds: state.artifacts?.outstationRideIds || [],
      notes: state.artifacts?.notes || [],
      bookingEvents: state.artifacts?.bookingEvents || [],
    },
  } satisfies SharedLiveSuiteState;
}
