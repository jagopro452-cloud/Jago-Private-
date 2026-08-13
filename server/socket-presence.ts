type PresenceRole = "driver" | "customer";

// Keep socket presence short-lived so a crashed pod cannot leave ghost sockets.
// Active sockets refresh this TTL from server/socket.ts heartbeat.
const SOCKET_PRESENCE_TTL_SEC = 180;

let redisClientPromise: Promise<any | null> | null = null;
let lastReconnectAttempt = 0;
const RECONNECT_COOLDOWN_MS = 5000;

function presenceKey(role: PresenceRole, userId: string) {
  return `socket:presence:${role}:${userId}`;
}

async function getRedisClient(): Promise<any | null> {
  if (redisClientPromise) return redisClientPromise;

  // Cooldown: without this, every socket connect/disconnect/heartbeat during a
  // Redis outage would open a fresh connection attempt — a thundering herd.
  if (Date.now() - lastReconnectAttempt < RECONNECT_COOLDOWN_MS) return null;
  lastReconnectAttempt = Date.now();

  redisClientPromise = (async () => {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return null;

    try {
      const { default: IORedis } = await import("ioredis");
      const client = new IORedis(redisUrl, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
      });
      // redisClientPromise memoizes the resolved client itself, so on any drop we
      // must clear it too — otherwise every future call keeps returning the same
      // dead client forever instead of reconnecting.
      client.on("error", () => { redisClientPromise = null; });
      client.on("end", () => { redisClientPromise = null; });
      await client.connect();
      return client;
    } catch {
      redisClientPromise = null;
      return null;
    }
  })();

  return redisClientPromise;
}

export async function addSocketPresence(role: PresenceRole, userId: string, socketId: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  try {
    await client.sadd(presenceKey(role, userId), socketId);
    await client.expire(presenceKey(role, userId), SOCKET_PRESENCE_TTL_SEC);
  } catch {
    // Presence caching must never break socket flows.
  }
}

export async function touchSocketPresence(role: PresenceRole, userId: string, socketId: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  try {
    const key = presenceKey(role, userId);
    const isKnownSocket = Number(await client.sismember(key, socketId)) === 1;
    if (!isKnownSocket) {
      await client.sadd(key, socketId);
    }
    await client.expire(key, SOCKET_PRESENCE_TTL_SEC);
  } catch {
    // Presence refresh must never break active sockets.
  }
}

export async function removeSocketPresence(role: PresenceRole, userId: string, socketId: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  try {
    const key = presenceKey(role, userId);
    await client.srem(key, socketId);
    const remaining = Number(await client.scard(key));
    if (remaining <= 0) {
      await client.del(key);
    } else {
      await client.expire(key, SOCKET_PRESENCE_TTL_SEC);
    }
  } catch {
    // Presence cleanup must never break disconnect flows.
  }
}

export async function hasSocketPresence(role: PresenceRole, userId: string): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false;
  try {
    return Number(await client.scard(presenceKey(role, userId))) > 0;
  } catch {
    return false;
  }
}
