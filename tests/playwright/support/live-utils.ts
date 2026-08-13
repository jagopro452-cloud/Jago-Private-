import { expect } from "@playwright/test";
import { io, type Socket } from "socket.io-client";
import { createQaTag, runtime } from "./runtime";

export function connectLiveSocket(token: string, userId: string, userType: "customer" | "driver") {
  const socket = io(runtime.apiBaseURL, {
    transports: ["websocket", "polling"],
    path: "/socket.io",
    query: {
      userId,
      userType,
      token,
    },
    auth: {
      token,
    },
    extraHeaders: {
      Origin: runtime.baseURL,
    },
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: 2,
    timeout: 20_000,
  });
  socket.on("system:ping_request", (payload: { tripId?: string }) => {
    socket.emit("system:ping_response", { tripId: payload?.tripId });
  });
  socket.on("ping_request", (payload: { tripId?: string }) => {
    socket.emit("ping_response", { tripId: payload?.tripId });
  });
  return socket;
}

export async function waitForConnect(socket: Socket, timeoutMs = 20_000) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`socket connect timeout after ${timeoutMs}ms`)), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`socket ready timeout after ${timeoutMs}ms`)), timeoutMs);
    socket.once("socket:ready", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("disconnect", (reason) => {
      clearTimeout(timer);
      reject(new Error(`socket disconnected before ready: ${reason}`));
    });
  });
}

export async function waitForSocketEvent<T = any>(socket: Socket, eventName: string, timeoutMs = 20_000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for socket event ${eventName}`)), timeoutMs);
    socket.once(eventName, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

export async function waitForSocketEventAny<T = any>(socket: Socket, eventNames: string[], timeoutMs = 20_000) {
  return new Promise<{ eventName: string; payload: T }>((resolve, reject) => {
    const handlers = new Map<string, (payload: T) => void>();
    const cleanup = () => {
      clearTimeout(timer);
      for (const [eventName, handler] of handlers.entries()) {
        socket.off(eventName, handler);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for any socket event: ${eventNames.join(", ")}`));
    }, timeoutMs);

    for (const eventName of eventNames) {
      const handler = (payload: T) => {
        cleanup();
        resolve({ eventName, payload });
      };
      handlers.set(eventName, handler);
      socket.once(eventName, handler);
    }
  });
}

export async function expectSocketNoEvent(socket: Socket, eventName: string, durationMs = 3_000) {
  let received = false;
  const handler = () => {
    received = true;
  };
  socket.on(eventName, handler);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  socket.off(eventName, handler);
  expect(received, `Expected no ${eventName} event within ${durationMs}ms`).toBeFalsy();
}

export function extractTripId(body: any) {
  return body?.tripId
    || body?.id
    || body?.trip?.id
    || body?.data?.id
    || body?.booking?.id
    || body?.activeTrip?.id
    || body?.tripRequest?.id
    || null;
}

export function extractActiveTrip(body: any) {
  return body?.trip
    || body?.activeTrip
    || body?.data
    || body
    || null;
}

export function qaAddress(label: string) {
  return createQaTag(`Hyderabad QA ${label}`);
}

export function qaNote(label: string) {
  return createQaTag(label);
}
