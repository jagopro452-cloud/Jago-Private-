import { db } from "./db";
import { sql } from "drizzle-orm";
import { io } from "./socket";
import { sendFcmNotification } from "./fcm";

const rawDb = db;
const rawSql = sql;

interface NotifyOptions {
  roomPrefix?: "user:" | "trip:";
  title?: string;
  body?: string;
  dataOnly?: boolean;
  channelId?: string;
  dedupeKey?: string;
  silent?: boolean;
}

function logNotify(userId: string, event: string, _data: Record<string, any>, options: NotifyOptions): void {
  console.log("[NOTIFY]", {
    userId,
    event,
    dedupe: options.dedupeKey || null,
    silent: options.silent === true,
  });
}

export async function notifyUser(
  userId: string,
  event: string,
  data: Record<string, any>,
  options: NotifyOptions = {},
): Promise<void> {
  if (!userId) return;
  const roomName = `${options.roomPrefix || "user:"}${userId}`;
  try {
    io?.to(roomName).emit(event, data);
    if ((options.roomPrefix || "user:") === "user:") {
      io?.to(`user_${userId}`).emit(event, data);
    }
  } catch (error: any) {
    console.error(`[NOTIFY] Socket emit failed user=${userId} event=${event}:`, error?.message || error);
  }

  if (options.silent) {
    logNotify(userId, event, data, options);
    return;
  }

  const tokenR = await rawDb.execute(rawSql`
    SELECT fcm_token
    FROM user_devices
    WHERE user_id=${userId}::uuid AND fcm_token IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT 1
  `).catch(() => ({ rows: [] as any[] }));
  const fcmToken = (tokenR.rows[0] as any)?.fcm_token;
  if (!fcmToken) return;

  const delivered = await sendFcmNotification({
    fcmToken,
    title: options.title || event,
    body: options.body || JSON.stringify(data),
    dataOnly: options.dataOnly,
    channelId: options.channelId || "trip_updates",
    data: Object.fromEntries(
      Object.entries(data || {}).map(([key, value]) => [key, value == null ? "" : String(value)]),
    ),
  }).catch(() => false);
  if (!delivered) {
    console.error(`[NOTIFY] FCM delivery failed user=${userId} event=${event}`);
  }
  logNotify(userId, event, data, options);
}
