import { log } from "./index";
import { db } from "./db";
import { sql } from "drizzle-orm";
const rawDb = db;
const rawSql = sql;

let admin: any = null;
let fcmInitialized = false;
let lastFcmError: string | null = null;

// ── Initialize Firebase Admin (env var only, no SMS fallback) ────────────────
async function initFirebaseAsync() {
  if (fcmInitialized) return;
  fcmInitialized = true;

  // Only use env var for service account
  let serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountJson) {
    try {
      const r = await rawDb.execute(rawSql`SELECT value FROM business_settings WHERE key_name='firebase_service_account' LIMIT 1`);
      const val = (r.rows[0] as any)?.value?.trim();
      if (val && val.startsWith("{")) serviceAccountJson = val;
    } catch (_) {}
  }

  if (!serviceAccountJson) {
    log("[FCM] Firebase service account not configured — push notifications disabled", "fcm");
    return;
  }

  try {
    const firebaseAdminModule = await import("firebase-admin");
    const firebaseAdmin: any = (firebaseAdminModule as any)?.default || firebaseAdminModule;
    // Avoid re-initializing if already done
    if (firebaseAdmin.apps.length === 0) {
      const serviceAccount = JSON.parse(serviceAccountJson);
      if (typeof serviceAccount.private_key === "string") {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
      }
      firebaseAdmin.initializeApp({
        credential: firebaseAdmin.credential.cert(serviceAccount),
      });
    }
    admin = firebaseAdmin;
    lastFcmError = null;
    log("[FCM] Firebase Admin initialized successfully", "fcm");
  } catch (e: any) {
    admin = null;
    lastFcmError = e?.message || "Firebase Admin initialization failed";
    log(`[FCM] Init failed: ${e.message}`, "fcm");
  }
}

// Sync wrapper — lazy init on first use
function initFirebase() {
  if (!fcmInitialized) {
    initFirebaseAsync().catch(() => {});
  }
}

// ── Get Firebase Admin instance (for token verification) ─────────────────────
export async function getFirebaseAdminAsync(): Promise<any> {
  await initFirebaseAsync();
  return admin;
}

export function getFirebaseAdmin(): any {
  initFirebase();
  return admin;
}

export function getLastFcmError(): string | null {
  return lastFcmError;
}

// ── Send single FCM notification ─────────────────────────────────────────────
// dataOnly=true → no `notification` key → Android wakes our background handler
// even when app is killed. REQUIRED for full-screen intent to work.
export async function sendFcmNotification(opts: {
  fcmToken: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  sound?: string;
  channelId?: string;
  dataOnly?: boolean;
}): Promise<boolean> {
  if (!admin) await initFirebaseAsync();
  if (!admin) return false;

  try {
    // Always embed title+body in data so our background handler can read them
    const dataPayload: Record<string, string> = {
      title: opts.title,
      body: opts.body,
      ...(opts.data || {}),
    };

    const message: any = {
      token: opts.fcmToken,
      data: dataPayload,
      android: {
        priority: "high" as const,
        directBootOk: true,
        // For non-alert messages only: let FCM show the system notification
        ...(opts.dataOnly ? {} : {
          notification: {
            sound: opts.sound || "trip_alert",
            channelId: opts.channelId || "trip_alerts",
            priority: "max" as const,
            defaultVibrateTimings: false,
            vibrateTimingsMillis: [0, 500, 200, 500, 200, 500],
          },
        }),
      },
      apns: {
        headers: { "apns-priority": "10" },
        payload: {
          aps: {
            sound: opts.dataOnly ? undefined : (opts.sound || "trip_alert.wav"),
            badge: 1,
            contentAvailable: true,
          },
        },
      },
    };

    // For non-dataOnly messages, include the notification key for system display
    if (!opts.dataOnly) {
      message.notification = { title: opts.title, body: opts.body };
    }

    await admin.messaging().send(message);
    lastFcmError = null;
    log(`[FCM] Sent notification title=${opts.title}${opts.dataOnly ? " dataOnly=true" : ""}`, "fcm");
    return true;
  } catch (e: any) {
    lastFcmError = e?.message || "FCM send failed";
    if (/invalid_grant|Invalid JWT Signature|certificate key file has been revoked/i.test(lastFcmError || "")) {
      admin = null;
      fcmInitialized = false;
    }
    log(`[FCM] Send failed: ${e.message}`, "fcm");
    return false;
  }
}

// ── Notification helpers ─────────────────────────────────────────────────────

/** 🔔 New ride alert to driver */
export async function notifyDriverNewRide(opts: {
  fcmToken: string | null;
  driverName: string;
  customerName: string;
  pickupAddress: string;
  destinationAddress?: string;
  estimatedFare: number;
  estimatedDistance?: number | string;
  tripId: string;
  vehicleCategoryId?: string | null;
  vehicleCategoryName?: string | null;
  timeoutMs?: number;
}) {
  if (!opts.fcmToken) return;
  return sendFcmNotification({
    fcmToken: opts.fcmToken,
    title: "🚗 New Ride Request!",
    body: `${opts.customerName} — ${opts.pickupAddress} — ₹${opts.estimatedFare}`,
    sound: "trip_alert",
    channelId: "trip_alerts_v2",
    dataOnly: true, // background handler shows full-screen intent
    data: {
      type: "new_trip",
      tripId: opts.tripId,
      customerName: opts.customerName,
      pickupAddress: opts.pickupAddress,
      destinationAddress: opts.destinationAddress || "",
      estimatedFare: String(opts.estimatedFare),
      estimatedDistance: String(opts.estimatedDistance ?? ""),
      vehicleCategoryId: opts.vehicleCategoryId || "",
      vehicleCategoryName: opts.vehicleCategoryName || "",
      vehicleCategory: opts.vehicleCategoryName || "",
      timeoutMs: String(opts.timeoutMs ?? 40000),
    },
  });
}

/** 📦 New parcel order — notify driver (for background wake-up) */
export async function notifyDriverNewParcel(opts: {
  fcmToken: string | null;
  pickupAddress: string;
  totalFare: number;
  orderId: string;
  vehicleCategory?: string;
}) {
  if (!opts.fcmToken) return;
  const label = (opts.vehicleCategory || 'bike_parcel').replace(/_/g, ' ');
  return sendFcmNotification({
    fcmToken: opts.fcmToken,
    title: "📦 New Parcel Delivery!",
    body: `${opts.pickupAddress} — ₹${opts.totalFare} — ${label}`,
    sound: "trip_alert",
    channelId: "trip_alerts_v2",
    dataOnly: true, // background handler shows full-screen intent
    data: {
      type: "new_parcel",
      orderId: opts.orderId,
      pickupAddress: opts.pickupAddress,
      totalFare: String(opts.totalFare),
      vehicleCategory: opts.vehicleCategory || 'bike_parcel',
    },
  });
}

/** ✅ Driver accepted — notify customer */
export async function notifyCustomerDriverAccepted(opts: {
  fcmToken: string | null;
  driverName: string;
  tripId: string;
}) {
  if (!opts.fcmToken) return;
  return sendFcmNotification({
    fcmToken: opts.fcmToken,
    title: "Driver Accepted Your Ride!",
    body: `${opts.driverName} is on the way to pick you up`,
    sound: "default",
    channelId: "trip_updates",
    data: {
      type: "trip_accepted",
      tripId: opts.tripId,
      driverName: opts.driverName,
    },
  });
}

/** 📍 Driver arrived at pickup */
export async function notifyCustomerDriverArrived(opts: {
  fcmToken: string | null;
  driverName: string;
  otp: string;
  tripId: string;
}) {
  if (!opts.fcmToken) return;
  return sendFcmNotification({
    fcmToken: opts.fcmToken,
    title: "🚗 Driver Arrived!",
    body: `${opts.driverName} is waiting. Your OTP: ${opts.otp}`,
    sound: "default",
    channelId: "trip_updates",
    data: {
      type: "driver_arrived",
      tripId: opts.tripId,
      otp: opts.otp,
    },
  });
}

/** ✅ Trip completed — notify customer */
export async function notifyCustomerTripCompleted(opts: {
  fcmToken: string | null;
  fare: number;
  tripId: string;
}) {
  if (!opts.fcmToken) return;
  return sendFcmNotification({
    fcmToken: opts.fcmToken,
    title: "Trip Completed!",
    body: `Fare: ₹${opts.fare}. Thank you for riding with JAGO Pro!`,
    sound: "default",
    channelId: "trip_updates",
    data: {
      type: "trip_completed",
      tripId: opts.tripId,
      fare: String(opts.fare),
    },
  });
}

/** ❌ Trip cancelled */
export async function notifyTripCancelled(opts: {
  fcmToken: string | null;
  cancelledBy: "driver" | "customer";
  tripId: string;
}) {
  if (!opts.fcmToken) return;
  const by = opts.cancelledBy === "driver" ? "Driver" : "Customer";
  return sendFcmNotification({
    fcmToken: opts.fcmToken,
    title: "Trip Cancelled",
    body: `${by} cancelled this trip`,
    sound: "default",
    channelId: "trip_updates",
    data: {
      type: "trip_cancelled",
      tripId: opts.tripId,
      cancelledBy: opts.cancelledBy,
    },
  });
}
